#!/usr/bin/env python3
"""
SADIK Color Codec Encoder
Usage: python encode.py input.mp4 output.bin [--keyframe-interval 48] [--target-fps 24]

Converts an mp4 to a SADIK .bin packet stream:
  - IFRAME (type 0x01): raw RGB565 40960 bytes, every N frames
  - PFRAME (type 0x02): dirty-tile bitmap + per-tile RLE

Deps: numpy, imageio, imageio-ffmpeg, Pillow (pip install imageio imageio-ffmpeg Pillow)
"""
import argparse
import struct
import sys
from pathlib import Path

import imageio.v3 as iio
import imageio
import numpy as np

# ── Constants ──────────────────────────────────────────────────────────────
MAGIC           = 0xC5
TYPE_IFRAME     = 0x01
TYPE_PFRAME     = 0x02

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


# ── CRC16-CCITT ─────────────────────────────────────────────────────────────
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


# ── Packet builder ───────────────────────────────────────────────────────────
def build_packet(ptype: int, seq: int, payload: bytes) -> bytes:
    header_no_crc = struct.pack('<BBHH', MAGIC, ptype, seq, len(payload))
    crc = crc16_ccitt(header_no_crc + payload)
    header = header_no_crc + struct.pack('<H', crc)
    return header + payload


# ── RGB888 → RGB565 ─────────────────────────────────────────────────────────
def rgb888_to_rgb565_le(frame_rgb: np.ndarray) -> np.ndarray:
    """
    frame_rgb: (H, W, 3) uint8 numpy array
    Returns: (H*W,) uint16 array of little-endian RGB565 pixels
    """
    r = frame_rgb[:, :, 0].astype(np.uint16)
    g = frame_rgb[:, :, 1].astype(np.uint16)
    b = frame_rgb[:, :, 2].astype(np.uint16)
    rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
    return rgb565.flatten()


# ── Tile RLE encoder ──────────────────────────────────────────────────────────
def rle_encode_tile(pixels: np.ndarray) -> bytes:
    """
    pixels: (64,) uint16 array — one tile's pixels
    Returns RLE block: [u8 rle_count] [rle_count × (u8 run_len, u16 pixel_LE)]
    run_len in 1..64; sum of run_lens == 64.
    """
    runs = []
    i = 0
    n = len(pixels)
    while i < n:
        val = pixels[i]
        j = i + 1
        while j < n and pixels[j] == val and (j - i) < 64:
            j += 1
        runs.append((j - i, int(val)))
        i = j

    out = bytearray()
    out.append(len(runs))
    for run_len, pixel in runs:
        out.append(run_len)
        out += struct.pack('<H', pixel)
    return bytes(out)


# ── IFRAME payload ────────────────────────────────────────────────────────────
def encode_iframe(pixels: np.ndarray) -> bytes:
    """pixels: (H*W,) uint16 array"""
    return pixels.astype('<u2').tobytes()


# ── PFRAME payload ────────────────────────────────────────────────────────────
def encode_pframe(curr: np.ndarray, prev: np.ndarray) -> bytes:
    """
    curr, prev: (H*W,) uint16 arrays
    Returns PFRAME payload bytes.
    """
    curr_2d = curr.reshape(HEIGHT, WIDTH)
    prev_2d = prev.reshape(HEIGHT, WIDTH)

    dirty_bitmap = bytearray(DIRTY_BYTES)
    tile_data = bytearray()

    for ty in range(TILES_Y):
        for tx in range(TILES_X):
            tile_idx = ty * TILES_X + tx
            row0 = ty * TILE_H
            col0 = tx * TILE_W
            curr_tile = curr_2d[row0:row0+TILE_H, col0:col0+TILE_W].flatten()
            prev_tile = prev_2d[row0:row0+TILE_H, col0:col0+TILE_W].flatten()

            if not np.array_equal(curr_tile, prev_tile):
                # Mark dirty
                byte_idx = tile_idx // 8
                bit_idx  = 7 - (tile_idx % 8)  # MSB-first within byte
                dirty_bitmap[byte_idx] |= (1 << bit_idx)
                tile_data += rle_encode_tile(curr_tile)

    return bytes(dirty_bitmap) + bytes(tile_data)


# ── Main encoder ─────────────────────────────────────────────────────────────
def encode(input_path: str, output_path: str, keyframe_interval: int = 48, target_fps: int = 24):
    input_p  = Path(input_path)
    output_p = Path(output_path)

    if not input_p.exists():
        print(f"ERROR: input not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Encoding: {input_p.name} -> {output_p.name}  (keyframe every {keyframe_interval} frames)")

    # Detect source fps from metadata; fall back to writing all frames if unavailable.
    source_fps = 0
    try:
        meta = imageio.v3.immeta(str(input_p), plugin="pyav")
        source_fps = float(meta.get("fps", 0) or 0)
    except Exception as e:
        pass
    if source_fps <= 0:
        try:
            meta = imageio.v3.immeta(str(input_p))
            source_fps = float(meta.get("fps", 0) or 0)
        except Exception:
            pass

    if source_fps <= 0:
        print(f"WARN: could not detect source fps for {input_p.name} — writing all frames (no downsample)", file=sys.stderr)
        step = 1
    else:
        step = max(1, round(source_fps / target_fps))

    # Read all frames via imageio-ffmpeg
    all_frames = list(iio.imiter(str(input_p)))
    frames_rgb = all_frames[::step]

    print(f"  source_fps={source_fps:.2f} target_fps={target_fps} step={step} output_frames={len(frames_rgb)}")

    if not frames_rgb:
        print("ERROR: no frames extracted", file=sys.stderr)
        sys.exit(1)

    # Resize / convert each frame to 160×128 RGB565
    from PIL import Image as PILImage

    pixels_list = []
    for frame in frames_rgb:
        img = PILImage.fromarray(frame, 'RGB')
        if img.size != (WIDTH, HEIGHT):
            img = img.resize((WIDTH, HEIGHT), PILImage.LANCZOS)
        arr = np.array(img, dtype=np.uint8)
        pixels_list.append(rgb888_to_rgb565_le(arr))

    total_frames = len(pixels_list)
    print(f"  Frames extracted: {total_frames}")

    packets = bytearray()
    seq = 0
    iframe_count = 0
    pframe_sizes = []
    total_raw = total_frames * FRAME_BYTES

    prev_pixels = None

    for i, pixels in enumerate(pixels_list):
        is_keyframe = (i % keyframe_interval == 0) or (prev_pixels is None)

        if is_keyframe:
            payload = encode_iframe(pixels)
            pkt = build_packet(TYPE_IFRAME, seq & 0xFFFF, payload)
            iframe_count += 1
        else:
            payload = encode_pframe(pixels, prev_pixels)
            pkt = build_packet(TYPE_PFRAME, seq & 0xFFFF, payload)
            pframe_sizes.append(len(payload))

        packets += pkt
        seq += 1
        prev_pixels = pixels

    output_p.write_bytes(bytes(packets))

    # ── Stats ──────────────────────────────────────────────────────────────
    total_encoded = len(packets)
    pframe_count = total_frames - iframe_count
    ratio = total_raw / total_encoded if total_encoded else 0

    print("\n  --- Stats -------------------------------------------")
    print(f"  Total packets     : {total_frames}")
    print(f"  IFRAMEs           : {iframe_count}")
    print(f"  PFRAMEs           : {pframe_count}")
    if pframe_sizes:
        print(f"  PFRAME avg size   : {int(sum(pframe_sizes)/len(pframe_sizes)):,} bytes")
        print(f"  PFRAME max size   : {max(pframe_sizes):,} bytes")
        print(f"  PFRAME min size   : {min(pframe_sizes):,} bytes")
    print(f"  Raw total         : {total_raw:,} bytes")
    print(f"  Encoded total     : {total_encoded:,} bytes")
    print(f"  Compression ratio : {ratio:.2f}x")
    print(f"  Output            : {output_p}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='SADIK Color mp4 → .bin encoder')
    parser.add_argument('input',  help='Input .mp4 file')
    parser.add_argument('output', help='Output .bin file')
    parser.add_argument('--keyframe-interval', type=int, default=48,
                        help='IFRAME every N frames (default: 48)')
    parser.add_argument('--target-fps', type=int, default=24,
                        help='Target playback FPS; source frames are downsampled to match (default: 24)')
    args = parser.parse_args()
    encode(args.input, args.output, args.keyframe_interval, args.target_fps)
