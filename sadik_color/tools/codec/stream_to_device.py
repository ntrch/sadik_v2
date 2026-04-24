#!/usr/bin/env python3
"""
stream_to_device.py — SADIK Color Sprint-2 F3.2
Standalone host streamer: reads a .bin codec packet stream and sends it to
the ESP32 firmware over serial with a window-2 sliding-window flow-control
protocol.

Usage:
    python stream_to_device.py FILE.bin PORT [--baud BAUD] [--window 2]
                                            [--timeout-ms 150] [--loop]

Examples:
    python stream_to_device.py idle.bin COM3
    python stream_to_device.py idle.bin /dev/ttyUSB0 --baud 921600 --loop
    python stream_to_device.py idle.bin COM3 --loop --window 2

Protocol recap (codec_format.h):
  Packet: [0xC5][type u8][seq u16][len u16][crc16 u16][payload]
  Type 0x01 IFRAME, 0x02 PFRAME, 0x03 ACK (fw→host), 0x04 RESYNC (fw→host)

Flow control:
  - Maintain an in-flight window of size `window` (default 2).
  - Send up to `window` packets without waiting for ACK.
  - Timeout 150 ms per in-flight packet → resend that packet (up to 3 retries).
  - On RESYNC from firmware → skip to next IFRAME, reset window.
  - ACK packet from firmware is binary: [0xC5][0x03][seq_lo][seq_hi][0][0][crc_lo][crc_hi]
"""

import argparse
import struct
import sys
import time
import threading
import queue
from pathlib import Path
from collections import deque

import serial  # pyserial

# ── Constants ────────────────────────────────────────────────────────────────
MAGIC        = 0xC5
TYPE_IFRAME  = 0x01
TYPE_PFRAME  = 0x02
TYPE_ACK     = 0x03
TYPE_RESYNC  = 0x04
HEADER_SIZE  = 8   # magic(1)+type(1)+seq(2)+len(2)+crc(2)

CRC_POLY     = 0x1021
CRC_INIT     = 0xFFFF

DEFAULT_BAUD    = 921600
DEFAULT_WINDOW  = 2
DEFAULT_TIMEOUT = 0.150  # seconds
MAX_RETRIES     = 3


# ── CRC16-CCITT ──────────────────────────────────────────────────────────────
def crc16_ccitt(data: bytes) -> int:
    crc = CRC_INIT
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ CRC_POLY) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


# ── Packet parser ─────────────────────────────────────────────────────────────
def parse_packet_header(data: bytes):
    """Parse an 8-byte header. Returns (type, seq, payload_len, crc) or None."""
    if len(data) < HEADER_SIZE:
        return None
    magic, ptype, seq, plen, crc = struct.unpack_from('<BBHHH', data, 0)
    if magic != MAGIC:
        return None
    return ptype, seq, plen, crc


# ── .bin stream reader ────────────────────────────────────────────────────────
def read_packets(bin_data: bytes):
    """
    Parse the .bin packet stream into a list of (type, seq, raw_packet_bytes).
    raw_packet_bytes includes the full header + payload.
    """
    packets = []
    offset = 0
    n = len(bin_data)
    while offset < n:
        if offset + HEADER_SIZE > n:
            break
        magic = bin_data[offset]
        if magic != MAGIC:
            # Hunt for next magic byte
            offset += 1
            continue
        hdr = parse_packet_header(bin_data[offset:offset + HEADER_SIZE])
        if hdr is None:
            offset += 1
            continue
        ptype, seq, plen, crc = hdr
        total = HEADER_SIZE + plen
        if offset + total > n:
            print(f"  WARNING: truncated packet at offset {offset} (need {total}, have {n - offset})")
            break
        raw = bin_data[offset: offset + total]
        packets.append((ptype, seq, raw))
        offset += total
    return packets


def find_next_iframe(packets, start_idx: int) -> int:
    """Return index of next IFRAME at or after start_idx, or -1 if none."""
    for i in range(start_idx, len(packets)):
        if packets[i][0] == TYPE_IFRAME:
            return i
    return -1


# ── ACK reader (runs in background thread) ────────────────────────────────────
class AckReader(threading.Thread):
    """
    Background thread that reads binary ACK / RESYNC packets from the serial
    port and puts them into an event queue.
    Event format: ('ack', seq) or ('resync',) or ('text', line_str).
    """

    def __init__(self, ser: serial.Serial, event_q: queue.Queue):
        super().__init__(daemon=True)
        self._ser     = ser
        self._q       = event_q
        self._running = True
        self._buf     = bytearray()

    def stop(self):
        self._running = False

    def run(self):
        while self._running:
            try:
                data = self._ser.read(self._ser.in_waiting or 1)
            except serial.SerialException:
                break
            if not data:
                continue
            self._buf.extend(data)
            self._process()

    def _process(self):
        while len(self._buf) >= 1:
            # Look for CODEC magic
            if self._buf[0] == MAGIC:
                if len(self._buf) < HEADER_SIZE:
                    break  # wait for more bytes
                hdr = parse_packet_header(bytes(self._buf[:HEADER_SIZE]))
                if hdr is None:
                    self._buf.pop(0)
                    continue
                ptype, seq, plen, crc = hdr
                total = HEADER_SIZE + plen
                if len(self._buf) < total:
                    break  # wait
                raw = bytes(self._buf[:total])
                del self._buf[:total]
                # Validate CRC
                calc_crc = crc16_ccitt(raw[:6] + raw[HEADER_SIZE:])
                if calc_crc != crc:
                    print(f"  [ack-reader] CRC mismatch on reply type=0x{ptype:02X} seq={seq}")
                    continue
                if ptype == TYPE_ACK:
                    self._q.put(('ack', seq))
                elif ptype == TYPE_RESYNC:
                    self._q.put(('resync',))
                else:
                    pass  # ignore unknown reply types
            else:
                # Might be a text line (CODEC:... DEBUG:... OK:... etc.)
                # Accumulate until '\n'
                nl = self._buf.find(b'\n')
                if nl == -1:
                    if len(self._buf) > 512:
                        # Overflow guard: discard
                        self._buf.clear()
                    break
                line = bytes(self._buf[:nl]).decode('utf-8', errors='replace').strip()
                del self._buf[:nl + 1]
                if line:
                    self._q.put(('text', line))


# ── Streamer ──────────────────────────────────────────────────────────────────
def stream(packets, ser: serial.Serial, window: int, timeout_s: float, verbose: bool):
    """
    Stream packet list to device with sliding-window flow control.
    Returns (frames_sent, frames_acked, resync_count).
    """
    event_q    = queue.Queue()
    ack_reader = AckReader(ser, event_q)
    ack_reader.start()

    total       = len(packets)
    send_idx    = 0   # next packet index to send
    acked_seq   = set()
    in_flight   = deque()  # (seq, send_time, retry_count, pkt_idx)

    frames_sent   = 0
    frames_acked  = 0
    resync_count  = 0

    def send_packet(idx):
        nonlocal frames_sent
        ptype, seq, raw = packets[idx]
        ser.write(raw)
        frames_sent += 1
        if verbose:
            tag = "IFRAME" if ptype == TYPE_IFRAME else "PFRAME"
            print(f"  → [{tag}] seq={seq} len={len(raw)} idx={idx}/{total}")

    try:
        while send_idx < total or in_flight:
            # ── Fill window ──────────────────────────────────────────────────
            while send_idx < total and len(in_flight) < window:
                ptype, seq, raw = packets[send_idx]
                send_packet(send_idx)
                in_flight.append((seq, time.monotonic(), 0, send_idx))
                send_idx += 1

            if not in_flight:
                break

            # ── Wait for ACK with timeout ────────────────────────────────────
            oldest_seq, send_time, retries, pkt_idx = in_flight[0]
            remaining = timeout_s - (time.monotonic() - send_time)

            try:
                event = event_q.get(timeout=max(0.001, remaining))
            except queue.Empty:
                event = None

            if event is not None:
                kind = event[0]
                if kind == 'ack':
                    ack_seq = event[1]
                    # Remove all in-flight packets up to and including ack_seq
                    # (cumulative ACK: anything <= ack_seq is implicitly acked)
                    while in_flight and in_flight[0][0] == ack_seq:
                        in_flight.popleft()
                        frames_acked += 1
                        if verbose:
                            print(f"  ← ACK seq={ack_seq}")
                    # Also remove if seq is in middle of window
                    # (non-cumulative: remove exact match)
                    new_if = deque()
                    for entry in in_flight:
                        if entry[0] == ack_seq:
                            frames_acked += 1
                            if verbose:
                                print(f"  ← ACK seq={ack_seq} (window)")
                        else:
                            new_if.append(entry)
                    in_flight = new_if

                elif kind == 'resync':
                    print(f"  ← RESYNC from firmware — skipping to next IFRAME")
                    resync_count += 1
                    in_flight.clear()
                    next_if = find_next_iframe(packets, send_idx)
                    if next_if == -1:
                        print("  No more IFRAMEs — ending stream")
                        break
                    send_idx = next_if

                elif kind == 'text':
                    print(f"  [fw] {event[1]}")

            else:
                # Timeout — check oldest in-flight
                now = time.monotonic()
                elapsed = now - in_flight[0][1]
                if elapsed >= timeout_s:
                    seq_to_retry, _, retries, pkt_idx_r = in_flight.popleft()
                    if retries >= MAX_RETRIES:
                        print(f"  TIMEOUT seq={seq_to_retry} after {MAX_RETRIES} retries — "
                              f"skipping to next IFRAME")
                        # Drain window
                        in_flight.clear()
                        next_if = find_next_iframe(packets, send_idx)
                        if next_if == -1:
                            print("  No more IFRAMEs — ending stream")
                            break
                        send_idx = next_if
                    else:
                        print(f"  TIMEOUT seq={seq_to_retry} — retry {retries + 1}/{MAX_RETRIES}")
                        # Resend
                        ptype_r, seq_r, raw_r = packets[pkt_idx_r]
                        ser.write(raw_r)
                        frames_sent += 1
                        in_flight.appendleft((seq_to_retry, time.monotonic(), retries + 1, pkt_idx_r))

    finally:
        ack_reader.stop()

    return frames_sent, frames_acked, resync_count


# ── Loopback / self-test mode (no serial, pure Python decode) ─────────────────
def self_test(packets):
    """
    Feed all packets through a Python-side decoder to verify round-trip
    integrity.  This does NOT require hardware.
    Returns True if all packets pass CRC verification.
    """
    print("\n  [self-test] Verifying CRC for all packets in stream...")
    ok = 0
    fail = 0
    for ptype, seq, raw in packets:
        if len(raw) < HEADER_SIZE:
            fail += 1
            continue
        stored_crc = struct.unpack_from('<H', raw, 6)[0]
        payload = raw[HEADER_SIZE:]
        calc_crc = crc16_ccitt(raw[:6] + payload)
        if calc_crc == stored_crc:
            ok += 1
        else:
            print(f"    CRC FAIL seq={seq} type=0x{ptype:02X} "
                  f"stored=0x{stored_crc:04X} calc=0x{calc_crc:04X}")
            fail += 1
    print(f"  [self-test] {ok} OK, {fail} FAIL out of {len(packets)} packets")
    return fail == 0


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description='SADIK Color — stream .bin codec file to ESP32 over serial'
    )
    parser.add_argument('file',  help='.bin packet stream produced by encode.py')
    parser.add_argument('port',  nargs='?', default=None,
                        help='Serial port (e.g. COM3 or /dev/ttyUSB0). '
                             'Omit to run self-test (CRC verification) only.')
    parser.add_argument('--baud',       type=int,   default=DEFAULT_BAUD,
                        help=f'Baud rate (default {DEFAULT_BAUD})')
    parser.add_argument('--window',     type=int,   default=DEFAULT_WINDOW,
                        help=f'Sliding window size (default {DEFAULT_WINDOW})')
    parser.add_argument('--timeout-ms', type=int,   default=int(DEFAULT_TIMEOUT * 1000),
                        dest='timeout_ms',
                        help=f'ACK timeout ms (default {int(DEFAULT_TIMEOUT*1000)})')
    parser.add_argument('--loop',       action='store_true',
                        help='Loop the stream indefinitely')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Log every packet send/ack')
    args = parser.parse_args()

    bin_path = Path(args.file)
    if not bin_path.exists():
        print(f"ERROR: file not found: {bin_path}", file=sys.stderr)
        sys.exit(1)

    bin_data = bin_path.read_bytes()
    packets  = read_packets(bin_data)

    if not packets:
        print("ERROR: no packets found in file", file=sys.stderr)
        sys.exit(1)

    # Count stats
    iframe_count  = sum(1 for p in packets if p[0] == TYPE_IFRAME)
    pframe_count  = sum(1 for p in packets if p[0] == TYPE_PFRAME)
    total_bytes   = sum(len(p[2]) for p in packets)
    print(f"Loaded: {bin_path.name}")
    print(f"  Packets: {len(packets)}  (IFRAMEs: {iframe_count}, PFRAMEs: {pframe_count})")
    print(f"  Total wire bytes: {total_bytes:,}")

    # Always run self-test first
    ok = self_test(packets)
    if not ok:
        print("ERROR: CRC verification failed — .bin file may be corrupt", file=sys.stderr)
        sys.exit(1)

    if args.port is None:
        print("\nNo serial port specified — self-test only mode. All packets verified OK.")
        return

    timeout_s = args.timeout_ms / 1000.0
    print(f"\nConnecting to {args.port} @ {args.baud} baud ...")

    try:
        ser = serial.Serial(
            port=args.port,
            baudrate=args.baud,
            timeout=0.05,       # short read timeout for the ack reader
            write_timeout=2.0,
        )
    except serial.SerialException as e:
        print(f"ERROR: could not open serial port: {e}", file=sys.stderr)
        sys.exit(1)

    # Brief settle — ESP32 may reset on DTR toggle
    time.sleep(0.5)
    ser.reset_input_buffer()
    print(f"Connected.  Window={args.window}  Timeout={args.timeout_ms}ms")

    iteration = 0
    try:
        while True:
            iteration += 1
            loop_tag = f" (loop #{iteration})" if args.loop else ""
            print(f"\nStreaming {len(packets)} packets{loop_tag} ...")
            t0 = time.monotonic()
            sent, acked, resyncs = stream(
                packets, ser,
                window=args.window,
                timeout_s=timeout_s,
                verbose=args.verbose,
            )
            elapsed = time.monotonic() - t0
            fps_approx = len(packets) / elapsed if elapsed > 0 else 0
            print(f"Done: sent={sent} acked={acked} resyncs={resyncs} "
                  f"time={elapsed:.2f}s ≈{fps_approx:.1f} fps")
            if not args.loop:
                break
    except KeyboardInterrupt:
        print("\nInterrupted by user.")
    finally:
        ser.close()


if __name__ == '__main__':
    main()
