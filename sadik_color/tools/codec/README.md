# SADIK Color Codec — Reference

## Packet Format

All multi-byte fields are **little-endian**.

```
Offset  Size  Field
0       1     magic = 0xC5
1       1     type  (0x01 IFRAME | 0x02 PFRAME | 0x03 ACK | 0x04 RESYNC)
2       2     seq   (u16, wraps at 65535)
4       2     payload_len (u16, bytes following this header)
6       2     crc16-ccitt (over bytes 0-5 + payload)
8       N     payload
```

CRC16-CCITT: poly=0x1021, init=0xFFFF, no input/output reflection (big-endian bit order).
CRC covers: `[magic, type, seq_lo, seq_hi, len_lo, len_hi]` + `payload`.

## Packet Types

### 0x01 IFRAME
- Payload: raw RGB565, 40960 bytes (160×128 × 2 bytes/pixel, row-major, LE pixels)
- Sent every 48 frames (2 sec @ 24fps) as keyframe, and on stream start

### 0x02 PFRAME
- Payload layout:
  1. **Dirty bitmap** — 40 bytes (320 bits, one per tile, MSB-first within each byte)
  2. **Tile data** — for each set bit in order (tile index 0..319):
     - RLE block for 64 pixels: `[u8 rle_count] [rle_count × (u8 run_len, u16 pixel_LE)]`
     - `run_len` in range 1..64; sum of run_lens in block == 64
- Tile grid: 20 columns × 16 rows of 8×8 pixel tiles
- Tile index = row * 20 + col
- Tile is dirty if **any** pixel differs from previous frame

### 0x03 ACK
- Payload: `[u16 seq]` — acknowledges packet with that sequence number
- Sent by receiver (ESP32) after each IFRAME/PFRAME

### 0x04 RESYNC
- Payload: empty (len=0)
- Sent by receiver to request a new IFRAME

## Stream Layout

```
[IFRAME pkt] [PFRAME pkt] ... [PFRAME pkt] [IFRAME pkt] ...
```

- First packet in stream is always an IFRAME (seq=0)
- No file header — stream is a raw concatenation of packets

## Dimensions

| Constant            | Value |
|---------------------|-------|
| Width               | 160 px |
| Height              | 128 px |
| Frame bytes (RGB565)| 40960 |
| Tile size           | 8×8 px |
| Tiles per row       | 20 |
| Tile rows           | 16 |
| Total tiles         | 320 |
| Dirty bitmap bytes  | 40 |
| Keyframe interval   | 48 frames |

## Files

| File              | Purpose                              |
|-------------------|--------------------------------------|
| `codec_format.h`  | C constants for ESP32 firmware       |
| `codec_format.ts` | TS constants for Electron preview    |
| `encode.py`       | mp4 → .bin encoder                   |
| `decode.py`       | .bin → RGB565 frames decoder         |
| `test_roundtrip.py` | Encoder+decoder bit-exact validation |
