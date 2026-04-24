import asyncio
import logging
import struct
import time
from pathlib import Path
from collections import deque
from typing import Optional, Callable
import serial
import serial.tools.list_ports

logger = logging.getLogger(__name__)

# ── Codec packet constants (mirrors tools/codec/stream_to_device.py) ─────────
_MAGIC        = 0xC5
_TYPE_IFRAME  = 0x01
_TYPE_PFRAME  = 0x02
_TYPE_ACK     = 0x03
_TYPE_RESYNC  = 0x04
_HEADER_SIZE  = 8   # magic(1)+type(1)+seq(2)+len(2)+crc(2)
_CRC_POLY     = 0x1021
_CRC_INIT     = 0xFFFF
_DEFAULT_WINDOW  = 2
_DEFAULT_TIMEOUT = 1.500   # seconds — matches standalone streamer
_MAX_RETRIES     = 3


def _crc16_ccitt(data: bytes) -> int:
    crc = _CRC_INIT
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ _CRC_POLY) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def _parse_header(data: bytes):
    """Parse 8-byte header → (type, seq, payload_len, crc) or None."""
    if len(data) < _HEADER_SIZE:
        return None
    magic, ptype, seq, plen, crc = struct.unpack_from('<BBHHH', data, 0)
    if magic != _MAGIC:
        return None
    return ptype, seq, plen, crc


def _read_packets(bin_data: bytes) -> list:
    """Parse .bin → list of (type, seq, raw_bytes)."""
    packets: list = []
    offset = 0
    n = len(bin_data)
    while offset < n:
        if offset + _HEADER_SIZE > n:
            break
        if bin_data[offset] != _MAGIC:
            offset += 1
            continue
        hdr = _parse_header(bin_data[offset:offset + _HEADER_SIZE])
        if hdr is None:
            offset += 1
            continue
        ptype, seq, plen, crc = hdr
        total = _HEADER_SIZE + plen
        if offset + total > n:
            break
        packets.append((ptype, seq, bin_data[offset:offset + total]))
        offset += total
    return packets

# Keywords indicating likely USB-serial adapters / dev boards
_SADIK_KEYWORDS = [
    "cp210", "cp2102", "ch340", "ch9102", "silicon labs",
    "usb serial", "usb uart", "uart bridge", "esp32", "esp",
    "devkit", "ftdi", "prolific",
]


class SerialService:
    """
    Single owner of the serial port.

    Two write call types, both protected by _lock:
      sendCommand(text)      — short, atomic.  Acquires lock, writes, returns.
      streamCodec(bin_path)  — long-running.   Acquires lock for the whole clip.

    Mutex policy for commands arriving mid-stream:
      Commands are queued in _pending_commands (asyncio.Queue).  The streamer
      flushes the queue AFTER the current clip finishes, NOT at frame boundaries.
      Frame-boundary injection would require draining the ACK reader, switching
      serial mode, then re-establishing codec context — not safe without firmware
      cooperation.  Queued commands are emitted with a WARNING so hardware-test
      observers can see the delay.  If this proves unacceptable in practice,
      revisit after firmware adds a "pause codec / inject command" mechanism.
    """

    def __init__(self):
        self._serial: Optional[serial.Serial] = None
        self._lock = asyncio.Lock()
        self._active_port: Optional[str] = None
        self._pending_commands: asyncio.Queue = asyncio.Queue()
        self._streaming = False       # True while streamCodec holds the lock
        self._abort_stream = False    # Set to True to end a looping stream

    @property
    def is_connected(self) -> bool:
        return self._serial is not None and self._serial.is_open

    def list_ports(self) -> list[dict]:
        ports = []
        for p in serial.tools.list_ports.comports():
            ports.append({"port": p.device, "description": p.description, "hwid": p.hwid})
        return ports

    def _rank_ports(self) -> tuple[list, list]:
        """Return (preferred_ports, other_ports) where preferred match SADIK keyword heuristics."""
        all_ports = list(serial.tools.list_ports.comports())
        preferred = []
        others = []
        for p in all_ports:
            desc = (p.description or "").lower()
            hwid = (p.hwid or "").lower()
            if any(kw in desc or kw in hwid for kw in _SADIK_KEYWORDS):
                preferred.append(p.device)
            else:
                others.append(p.device)
        return preferred, others

    def _find_esp32_port(self) -> Optional[str]:
        preferred, others = self._rank_ports()
        if preferred:
            return preferred[0]
        if others:
            return others[0]
        return None

    def _try_open_and_verify_sync(self, port: str, baudrate: int) -> Optional[serial.Serial]:
        """Open port, send PING, wait for PONG/SADIK:READY.
        Returns an open serial.Serial if verified, None otherwise.
        Caller owns the returned object and must close it when done.

        Hard budget: ~1.5 s total (0.2 s settle + 1.0 s response window).
        write_timeout ensures s.write() never blocks indefinitely.
        """
        s = None
        try:
            logger.debug(f"Trying port {port}")
            # write_timeout prevents s.write() from blocking indefinitely
            s = serial.Serial(port, baudrate, timeout=1.0, write_timeout=1.0)
            logger.debug(f"Opened port {port}")
            time.sleep(0.2)  # brief settle — reduced from 0.3 s
            s.reset_input_buffer()
            logger.debug(f"Sending PING to {port}")
            s.write(b"PING\n")
            s.flush()
            deadline = time.monotonic() + 1.0
            while time.monotonic() < deadline:
                if s.in_waiting > 0:
                    line = s.readline().decode("utf-8", errors="replace").strip()
                    if line in ("PONG", "SADIK:READY") or line.startswith("STATUS"):
                        logger.info(f"Verification success on {port}: got '{line}'")
                        return s  # verified — caller takes ownership
                time.sleep(0.05)
            logger.debug(f"Verification fail on {port}: no SADIK response within deadline")
        except Exception as e:
            logger.debug(f"Port {port} open/verify failed: {e}")
        # Verification failed — close cleanly
        logger.debug(f"Closing failed port {port}")
        try:
            if s and s.is_open:
                s.close()
        except Exception:
            pass
        return None

    async def auto_detect_and_connect(
        self,
        baudrate: int = 460800,
        retries: int = 1,
        retry_delay: float = 2.0,
    ) -> dict:
        """Scan all serial ports, verify SADIK device via PING/PONG protocol,
        and keep the connection open on first match.

        retries=3 at startup covers the ~2-3 s ESP32 needs to boot before its
        serial interface responds to PING.  Manual connect passes retries=1.

        Returns a dict with: connected, port, method, message, scanned_ports,
        matched_ports, error.
        """
        async with self._lock:
            # Already connected and healthy — skip redundant scan
            if self.is_connected:
                port = self._active_port or "unknown"
                logger.info(f"Auto-detect: already connected on {port}")
                return {
                    "connected": True,
                    "port": port,
                    "method": "auto",
                    "message": f"SADIK cihazı zaten bağlı ({port}).",
                    "scanned_ports": 0,
                    "matched_ports": [],
                    "error": None,
                }

            loop = asyncio.get_event_loop()
            last_scanned = 0

            for attempt in range(1, retries + 1):
                preferred, others = await loop.run_in_executor(None, self._rank_ports)
                all_candidates = preferred + others
                last_scanned = len(all_candidates)

                logger.info(
                    f"Auto-detect: attempt {attempt}/{retries} — scanning {last_scanned} port(s). "
                    f"Preferred: {preferred}, Fallback: {others}"
                )

                for port in all_candidates:
                    # Hard per-port timeout: if the executor thread stalls (e.g. on a
                    # Bluetooth COM port or ghost port whose Serial() constructor blocks),
                    # we time out from the async side and move on.  The stalled thread
                    # will eventually complete on its own and its result is discarded.
                    try:
                        verified_serial = await asyncio.wait_for(
                            loop.run_in_executor(
                                None, self._try_open_and_verify_sync, port, baudrate
                            ),
                            timeout=2.0,
                        )
                    except asyncio.TimeoutError:
                        logger.warning(f"Auto-detect: port {port} verification timed out — skipping")
                        verified_serial = None
                    if verified_serial is not None:
                        self._serial = verified_serial
                        self._active_port = port
                        logger.info(f"Auto-connect success: {port}")
                        return {
                            "connected": True,
                            "port": port,
                            "method": "auto",
                            "message": f"SADIK cihazı otomatik bağlandı ({port}).",
                            "scanned_ports": last_scanned,
                            "matched_ports": [port],
                            "error": None,
                        }

                if attempt < retries:
                    logger.info(
                        f"Auto-detect: attempt {attempt}/{retries} — no device found, "
                        f"retrying in {retry_delay:.0f}s"
                    )
                    await asyncio.sleep(retry_delay)

            logger.info("Auto-detect: no SADIK device found on any port")
            return {
                "connected": False,
                "port": None,
                "method": "auto",
                "message": "SADIK cihazı otomatik olarak algılanamadı.",
                "scanned_ports": last_scanned,
                "matched_ports": [],
                "error": "No SADIK device responded to PING on any available port.",
            }

    async def open(self, port: str, baudrate: int = 460800) -> bool:
        loop = asyncio.get_event_loop()
        try:
            if port == "auto":
                port = self._find_esp32_port()
                if not port:
                    logger.error("No serial port found for auto detection")
                    return False

            def _open():
                return serial.Serial(port, baudrate, timeout=1, write_timeout=1)

            self._serial = await loop.run_in_executor(None, _open)
            self._active_port = port
            logger.info(f"Serial opened on {port} at {baudrate}")
            return True
        except Exception as e:
            logger.error(f"Failed to open serial: {e}")
            self._serial = None
            self._active_port = None
            return False

    async def close(self):
        if self._serial and self._serial.is_open:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._serial.close)
            self._serial = None
            self._active_port = None
            logger.info("Serial closed")

    async def send(self, command: str) -> bool:
        """Send a short text command.

        If a codec stream is in progress, the command is queued and will be
        delivered after the clip finishes.  Callers receive True immediately
        (the command will eventually be sent) rather than blocking.
        """
        if not self.is_connected:
            return False
        if self._streaming:
            logger.warning(
                f"Serial: codec stream in progress — queuing command: {command!r}"
            )
            await self._pending_commands.put(command)
            return True
        async with self._lock:
            return await self._send_raw(command)

    async def _send_raw(self, command: str) -> bool:
        """Write a text command with no lock checks. Caller must hold _lock."""
        loop = asyncio.get_event_loop()
        try:
            data = (command + "\n").encode("utf-8")
            await loop.run_in_executor(None, self._serial.write, data)
            return True
        except Exception as e:
            logger.error(f"Serial send error: {e}")
            return False

    async def read_line(self) -> Optional[str]:
        if not self.is_connected:
            return None
        loop = asyncio.get_event_loop()
        try:
            def _read():
                if self._serial.in_waiting > 0:
                    return self._serial.readline().decode("utf-8", errors="replace").strip()
                return None
            return await loop.run_in_executor(None, _read)
        except Exception as e:
            logger.error(f"Serial read error: {e}")
            return None

    async def send_frame_binary(self, frame_bytes: bytes, read_timeout: float = 0.25) -> tuple[bool, Optional[str]]:
        """Write b'FRAME:' + 40960 raw bytes + b'\\n' and wait for OK:FRAME ack."""
        if not self.is_connected:
            return False, None

        async with self._lock:
            loop = asyncio.get_event_loop()

            def _exchange() -> Optional[str]:
                self._serial.reset_input_buffer()
                self._serial.write(b"FRAME:" + frame_bytes + b"\n")
                self._serial.flush()

                deadline = time.monotonic() + read_timeout
                while time.monotonic() < deadline:
                    try:
                        raw = self._serial.readline()
                    except Exception as e:
                        logger.error(f"Serial readline error: {e}")
                        return None
                    if not raw:
                        continue
                    line = raw.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    if line.startswith("DEBUG:") or line.startswith("EVENT:"):
                        continue
                    if line.startswith("OK:") or line.startswith("ERR:"):
                        return line
                return None

            try:
                response = await loop.run_in_executor(None, _exchange)
                return True, response
            except Exception as e:
                logger.error(f"Serial send_frame_binary error: {e}")
                return True, None

    async def send_and_read(self, command: str, read_timeout: float = 2.0) -> tuple[bool, Optional[str]]:
        """Send a command and wait for the first meaningful response line.

        Acquires the instance lock so commands are fully serialised — no two
        exchanges can overlap.  This prevents mixed responses when brightness
        and sleep-timeout commands are applied in quick succession.

        Per-exchange flow:
          1. Reset the RX buffer to discard stale bytes (EVENT: lines, etc.)
          2. Write the command and flush the TX buffer.
          3. Read lines one at a time; skip DEBUG: / EVENT: / empty lines.
          4. Return the first OK: / ERR: / STATUS: / PONG line, or None on timeout.
        """
        if not self.is_connected:
            return False, None

        async with self._lock:
            loop = asyncio.get_event_loop()

            def _exchange() -> Optional[str]:
                # 1. Drain any stale input that arrived since the last command.
                self._serial.reset_input_buffer()
                # 2. Write command and flush the OS TX buffer immediately.
                self._serial.write((command + "\n").encode("utf-8"))
                self._serial.flush()

                deadline = time.monotonic() + read_timeout
                while time.monotonic() < deadline:
                    try:
                        raw = self._serial.readline()
                    except Exception as e:
                        logger.error(f"Serial readline error: {e}")
                        return None
                    # readline() returns b"" when the per-character timeout
                    # elapses without a newline — just retry until deadline.
                    if not raw:
                        continue
                    line = raw.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    # Skip async firmware noise — these are never command responses.
                    if line.startswith("DEBUG:") or line.startswith("EVENT:"):
                        logger.debug("Serial skipped line: %r", line)
                        continue
                    # Accept the first proper response token.
                    if (line.startswith("OK:") or
                            line.startswith("ERR:") or
                            line.startswith("STATUS:") or
                            line == "PONG"):
                        logger.debug("Serial response: %r", line)
                        return line
                    # Unrecognised line — log and keep reading.
                    logger.debug("Serial unknown line: %r", line)
                return None

            try:
                response = await loop.run_in_executor(None, _exchange)
                return True, response
            except Exception as e:
                logger.error(f"Serial send_and_read error: {e}")
                return True, None


    async def streamCodec(
        self,
        bin_path: str,
        loop: bool = False,
        on_done: Optional[Callable] = None,
    ) -> None:
        """
        Long-running codec stream.  Acquires _lock for the entire clip duration.

        Args:
            bin_path: Absolute path to a .bin codec file.
            loop:     If True, replay the clip indefinitely until stopCodec() is called.
            on_done:  Optional async callback invoked after streaming ends.

        Mutex policy: see class docstring.  Commands that arrive via send() while
        _streaming is True are queued and flushed here after the clip ends.
        """
        if not self.is_connected:
            logger.warning("streamCodec: not connected, skipping")
            return

        bin_data = Path(bin_path).read_bytes()
        packets   = _read_packets(bin_data)
        if not packets:
            logger.warning(f"streamCodec: no packets in {bin_path}")
            return

        iframe_count  = sum(1 for p in packets if p[0] == _TYPE_IFRAME)
        pframe_count  = sum(1 for p in packets if p[0] == _TYPE_PFRAME)
        total_bytes   = sum(len(p[2]) for p in packets)
        logger.info(
            f"streamCodec: {Path(bin_path).name}  "
            f"packets={len(packets)} (I={iframe_count} P={pframe_count})  "
            f"bytes={total_bytes:,}  loop={loop}"
        )

        async with self._lock:
            self._streaming = True
            self._abort_stream = False
            try:
                iteration = 0
                while True:
                    iteration += 1
                    loop_tag = f" (loop #{iteration})" if loop else ""
                    logger.info(f"streamCodec: streaming {len(packets)} packets{loop_tag}")
                    t0 = time.monotonic()
                    sent, acked, resyncs = await self._run_codec_stream(packets)
                    elapsed = time.monotonic() - t0
                    fps_approx = len(packets) / elapsed if elapsed > 0 else 0
                    logger.info(
                        f"streamCodec: done sent={sent} acked={acked} "
                        f"resyncs={resyncs} time={elapsed:.2f}s ≈{fps_approx:.1f}fps"
                    )
                    if self._abort_stream or not loop:
                        break
            finally:
                self._streaming = False

            # Flush any commands that arrived while the stream held the lock
            flushed = 0
            while not self._pending_commands.empty():
                cmd = self._pending_commands.get_nowait()
                logger.info(f"streamCodec: flushing queued command: {cmd!r}")
                await self._send_raw(cmd)
                flushed += 1
            if flushed:
                logger.info(f"streamCodec: flushed {flushed} queued command(s)")

        if on_done:
            if asyncio.iscoroutinefunction(on_done):
                await on_done()
            else:
                on_done()

    def stopCodec(self) -> None:
        """Signal an in-flight streamCodec loop to stop after the current clip ends."""
        self._abort_stream = True

    async def _run_codec_stream(self, packets: list) -> tuple[int, int, int]:
        """
        Inner sliding-window streamer (sync-in-executor).  Returns (sent, acked, resyncs).
        Runs in a thread executor so the ACK read loop (blocking serial.read) doesn't
        stall the asyncio event loop.
        """
        loop = asyncio.get_event_loop()

        def _stream_sync() -> tuple[int, int, int]:
            ser = self._serial
            import queue as _queue
            event_q: _queue.Queue = _queue.Queue()

            # ── Inline ACK reader (thread-safe via event_q) ─────────────────────
            buf = bytearray()

            def _read_acks():
                nonlocal buf
                while True:
                    try:
                        data = ser.read(ser.in_waiting or 1)
                    except serial.SerialException:
                        break
                    if not data:
                        if self._abort_stream:
                            break
                        continue
                    buf.extend(data)
                    # process buf
                    while len(buf) >= 1:
                        if buf[0] == _MAGIC:
                            if len(buf) < _HEADER_SIZE:
                                break
                            hdr = _parse_header(bytes(buf[:_HEADER_SIZE]))
                            if hdr is None:
                                buf.pop(0)
                                continue
                            ptype, seq, plen, crc = hdr
                            total = _HEADER_SIZE + plen
                            if len(buf) < total:
                                break
                            raw = bytes(buf[:total])
                            del buf[:total]
                            calc_crc = _crc16_ccitt(raw[:6] + raw[_HEADER_SIZE:])
                            if calc_crc != crc:
                                continue
                            if ptype == _TYPE_ACK:
                                event_q.put(('ack', seq))
                            elif ptype == _TYPE_RESYNC:
                                event_q.put(('resync',))
                        else:
                            nl = buf.find(b'\n')
                            if nl == -1:
                                if len(buf) > 512:
                                    buf.clear()
                                break
                            line = bytes(buf[:nl]).decode('utf-8', errors='replace').strip()
                            del buf[:nl + 1]
                            if line:
                                event_q.put(('text', line))
                    if self._abort_stream:
                        break

            import threading as _threading
            ack_thread = _threading.Thread(target=_read_acks, daemon=True)
            ack_thread.start()

            total_pkts  = len(packets)
            send_idx    = 0
            in_flight   = deque()
            frames_sent = 0
            frames_acked = 0
            resync_count = 0

            try:
                while (send_idx < total_pkts or in_flight) and not self._abort_stream:
                    while send_idx < total_pkts and len(in_flight) < _DEFAULT_WINDOW:
                        ptype, seq, raw = packets[send_idx]
                        ser.write(raw)
                        frames_sent += 1
                        in_flight.append((seq, time.monotonic(), 0, send_idx))
                        send_idx += 1

                    if not in_flight:
                        break

                    oldest_seq, send_time, retries, pkt_idx = in_flight[0]
                    remaining = _DEFAULT_TIMEOUT - (time.monotonic() - send_time)

                    try:
                        event = event_q.get(timeout=max(0.001, remaining))
                    except Exception:
                        event = None

                    if event is not None:
                        kind = event[0]
                        if kind == 'ack':
                            ack_seq = event[1]
                            new_if = deque()
                            for entry in in_flight:
                                if entry[0] == ack_seq:
                                    frames_acked += 1
                                else:
                                    new_if.append(entry)
                            in_flight = new_if
                        elif kind == 'resync':
                            logger.info("streamCodec: RESYNC from firmware — skip to next IFRAME")
                            resync_count += 1
                            in_flight.clear()
                            next_if = next(
                                (i for i in range(send_idx, total_pkts) if packets[i][0] == _TYPE_IFRAME),
                                -1,
                            )
                            if next_if == -1:
                                break
                            send_idx = next_if
                        elif kind == 'text':
                            logger.debug(f"[fw] {event[1]}")
                    else:
                        now = time.monotonic()
                        if now - in_flight[0][1] >= _DEFAULT_TIMEOUT:
                            seq_r, _, retries, pkt_idx_r = in_flight.popleft()
                            if retries >= _MAX_RETRIES:
                                logger.warning(f"streamCodec: TIMEOUT seq={seq_r} — skip to IFRAME")
                                in_flight.clear()
                                next_if = next(
                                    (i for i in range(send_idx, total_pkts) if packets[i][0] == _TYPE_IFRAME),
                                    -1,
                                )
                                if next_if == -1:
                                    break
                                send_idx = next_if
                            else:
                                _, _, raw_r = packets[pkt_idx_r]
                                ser.write(raw_r)
                                frames_sent += 1
                                in_flight.appendleft((seq_r, time.monotonic(), retries + 1, pkt_idx_r))
            finally:
                self._abort_stream = True   # signal ACK thread to stop
                ack_thread.join(timeout=1.0)
                self._abort_stream = False  # reset for next call

            return frames_sent, frames_acked, resync_count

        return await loop.run_in_executor(None, _stream_sync)


serial_service = SerialService()
