#!/usr/bin/env python3
"""
SADIK Color Codec Decoder (reference implementation)
Parses a .bin packet stream → list of (H*W,) uint16 RGB565 frame arrays.

Usage: python decode.py input.bin [--dump-frames outdir/]
  --dump-frames: optional, writes each frame as raw RGB565 .bin into outdir
"""
import argparse
import struct
import sys
from pathlib import Path
from typing import List, Tuple

import numpy as np

# ── Constants ────────────────────────────────────────────────────────────────
MAGIC           = 0xC5
TYPE_IFRAME     = 0x01
TYPE_PFRAME     = 0x02
TYPE_ACK        = 0x03
TYPE_RESYNC     = 0x04

WIDTH           = 160
HEIGHT          = 128
FRAME_BYTES     = WIDTH * HEIGHT * 2  # 40960

TILE_W          = 8
TILE_H          = 8
TILES_X         = WIDTH  // TILE_W   # 20
TILES_Y         = HEIGHT // TILE_H   # 16
TILE_COUNT      = TILES_X * TILES_Y  # 320
DIRTY_BYTES     = (TILE_COUNT + 7) // 8  # 40
PIXELS_PER_TILE = TILE_W * TILE_H    # 64

CRC_POLY = 0x1021
CRC_INIT = 0xFFFF
HEADER_SIZE = 8


# ── CRC16-CCITT ──────────────────────────────────────────────────────────────
def crc16_ccitt(data: bytes) -> int:
    crc = CRC_INIT
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ CRC_POLY) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc


# ── Packet parser ─────────────────────────────────────────────────────────────
def parse_packets(data: bytes) -> List[Tuple[int, int, bytes]]:
    """
    Returns list of (type, seq, payload) tuples.
    Raises ValueError on magic/CRC mismatch.
    """
    pkts = []
    pos = 0
    n = len(data)
    while pos < n:
        if pos + HEADER_SIZE > n:
            raise ValueError(f"Truncated header at offset {pos}")
        magic, ptype, seq, plen, crc = struct.unpack_from('<BBHHH', data, pos)
        if magic != MAGIC:
            raise ValueError(f"Bad magic 0x{magic:02X} at offset {pos}, expected 0x{MAGIC:02X}")
        if pos + HEADER_SIZE + plen > n:
            raise ValueError(f"Truncated payload at offset {pos}: need {plen} bytes")
        payload = data[pos + HEADER_SIZE : pos + HEADER_SIZE + plen]
        # Verify CRC (covers header bytes 0-5 + payload)
        header_no_crc = data[pos:pos+6]
        expected_crc = crc16_ccitt(header_no_crc + payload)
        if expected_crc != crc:
            raise ValueError(
                f"CRC mismatch at pkt seq={seq} offset={pos}: "
                f"got 0x{crc:04X} expected 0x{expected_crc:04X}"
            )
        pkts.append((ptype, seq, payload))
        pos += HEADER_SIZE + plen
    return pkts


# ── IFRAME decoder ────────────────────────────────────────────────────────────
def decode_iframe(payload: bytes) -> np.ndarray:
    if len(payload) != FRAME_BYTES:
        raise ValueError(f"IFRAME payload size {len(payload)} != {FRAME_BYTES}")
    return np.frombuffer(payload, dtype='<u2').copy()


# ── RLE tile decoder ──────────────────────────────────────────────────────────
def rle_decode_tile(data: bytes, offset: int) -> Tuple[np.ndarray, int]:
    """
    Decodes one RLE tile block starting at data[offset].
    Returns (pixels array shape (64,) uint16, new_offset).
    """
    rle_count = data[offset]; offset += 1
    pixels = np.zeros(PIXELS_PER_TILE, dtype=np.uint16)
    pos = 0
    for _ in range(rle_count):
        run_len = data[offset]; offset += 1
        pixel   = struct.unpack_from('<H', data, offset)[0]; offset += 2
        pixels[pos:pos+run_len] = pixel
        pos += run_len
    if pos != PIXELS_PER_TILE:
        raise ValueError(f"RLE tile pixel count {pos} != {PIXELS_PER_TILE}")
    return pixels, offset


# ── PFRAME decoder ────────────────────────────────────────────────────────────
def decode_pframe(payload: bytes, prev: np.ndarray) -> np.ndarray:
    if len(payload) < DIRTY_BYTES:
        raise ValueError("PFRAME payload too short for dirty bitmap")
    dirty_bitmap = payload[:DIRTY_BYTES]
    offset = DIRTY_BYTES

    curr = prev.copy().reshape(HEIGHT, WIDTH)
    for tile_idx in range(TILE_COUNT):
        byte_idx = tile_idx // 8
        bit_idx  = 7 - (tile_idx % 8)
        if dirty_bitmap[byte_idx] & (1 << bit_idx):
            ty = tile_idx // TILES_X
            tx = tile_idx  % TILES_X
            tile_pixels, offset = rle_decode_tile(payload, offset)
            row0 = ty * TILE_H
            col0 = tx * TILE_W
            curr[row0:row0+TILE_H, col0:col0+TILE_W] = tile_pixels.reshape(TILE_H, TILE_W)

    if offset != len(payload):
        raise ValueError(
            f"PFRAME payload not fully consumed: consumed {offset}, total {len(payload)}"
        )
    return curr.flatten()


# ── Main decoder ──────────────────────────────────────────────────────────────
def decode(bin_path: str, dump_dir: str | None = None) -> List[np.ndarray]:
    """
    Decodes .bin → list of (H*W,) uint16 RGB565 frame arrays.
    Optionally dumps raw frames to dump_dir.
    """
    data = Path(bin_path).read_bytes()
    pkts = parse_packets(data)

    if not pkts or pkts[0][0] != TYPE_IFRAME:
        raise ValueError("Stream must start with IFRAME")

    frames = []
    prev = None

    for ptype, seq, payload in pkts:
        if ptype == TYPE_IFRAME:
            frame = decode_iframe(payload)
        elif ptype == TYPE_PFRAME:
            if prev is None:
                raise ValueError("PFRAME before any IFRAME")
            frame = decode_pframe(payload, prev)
        else:
            continue  # ACK/RESYNC — skip

        frames.append(frame)
        prev = frame

    if dump_dir:
        out = Path(dump_dir)
        out.mkdir(parents=True, exist_ok=True)
        for i, f in enumerate(frames):
            (out / f"frame_{i:05d}.bin").write_bytes(f.astype('<u2').tobytes())
        print(f"Dumped {len(frames)} frames to {dump_dir}")

    return frames


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='SADIK Color .bin decoder')
    parser.add_argument('input',  help='Input .bin file')
    parser.add_argument('--dump-frames', metavar='DIR', default=None,
                        help='Directory to dump raw RGB565 frames')
    args = parser.parse_args()
    frames = decode(args.input, args.dump_frames)
    print(f"Decoded {len(frames)} frames from {args.input}")
