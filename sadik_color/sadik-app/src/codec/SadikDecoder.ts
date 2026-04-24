/**
 * SADIK Color Codec — TypeScript Decoder
 *
 * Parses a .bin packet stream (IFRAME + PFRAME delta+RLE) and emits RGB565
 * frames as Uint16Array(160*128).  Mirrors the Python decode.py reference and
 * the ESP32 codec_decode.cpp firmware logic byte-for-byte.
 *
 * Packet layout (little-endian):
 *   [u8 magic=0xC5][u8 type][u16 seq][u16 payload_len][u16 crc16-ccitt][payload...]
 *
 * IFRAME payload : raw RGB565 LE, 40960 bytes (160×128×2)
 * PFRAME payload : 40-byte dirty-tile bitmap (320 tiles, MSB-first) +
 *                  per-dirty-tile RLE blocks
 * RLE block      : [u8 run_count][run_count × (u8 run_len, u16 pixel_LE)]
 *                  sum of run_lens == 64 (one 8×8 tile)
 */

// ── Constants ────────────────────────────────────────────────────────────────
export const CODEC_MAGIC         = 0xC5;
export const CODEC_TYPE_IFRAME   = 0x01;
export const CODEC_TYPE_PFRAME   = 0x02;
export const CODEC_TYPE_ACK      = 0x03;
export const CODEC_TYPE_RESYNC   = 0x04;

export const CODEC_WIDTH         = 160;
export const CODEC_HEIGHT        = 128;
export const CODEC_FRAME_PIXELS  = CODEC_WIDTH * CODEC_HEIGHT;          // 20480
export const CODEC_FRAME_BYTES   = CODEC_FRAME_PIXELS * 2;              // 40960

export const CODEC_TILE_W        = 8;
export const CODEC_TILE_H        = 8;
export const CODEC_TILES_X       = CODEC_WIDTH  / CODEC_TILE_W;         // 20
export const CODEC_TILES_Y       = CODEC_HEIGHT / CODEC_TILE_H;         // 16
export const CODEC_TILE_COUNT    = CODEC_TILES_X * CODEC_TILES_Y;       // 320
export const CODEC_DIRTY_BYTES   = Math.ceil(CODEC_TILE_COUNT / 8);     // 40
export const CODEC_PIXELS_PER_TILE = CODEC_TILE_W * CODEC_TILE_H;      // 64
export const CODEC_HEADER_SIZE   = 8;  // magic+type+seq(2)+len(2)+crc(2)

// ── CRC16-CCITT ──────────────────────────────────────────────────────────────
function crc16Ccitt(buf: Uint8Array, offset: number, length: number): number {
  let crc = 0xFFFF;
  for (let i = offset; i < offset + length; i++) {
    crc ^= buf[i] << 8;
    for (let b = 0; b < 8; b++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc;
}

// ── Parsed packet ────────────────────────────────────────────────────────────
export interface DecodedPacket {
  type: number;
  seq:  number;
  payload: Uint8Array;
}

// ── Packet parser ────────────────────────────────────────────────────────────
export function parsePackets(data: Uint8Array): DecodedPacket[] {
  const packets: DecodedPacket[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;

  while (pos < data.length) {
    if (pos + CODEC_HEADER_SIZE > data.length) {
      throw new Error(`Truncated header at offset ${pos}`);
    }

    const magic      = data[pos];
    const ptype      = data[pos + 1];
    const seq        = view.getUint16(pos + 2, /*LE=*/true);
    const payloadLen = view.getUint16(pos + 4, /*LE=*/true);
    const crc        = view.getUint16(pos + 6, /*LE=*/true);

    if (magic !== CODEC_MAGIC) {
      throw new Error(`Bad magic 0x${magic.toString(16).toUpperCase()} at offset ${pos}`);
    }
    if (pos + CODEC_HEADER_SIZE + payloadLen > data.length) {
      throw new Error(`Truncated payload at offset ${pos}: need ${payloadLen} bytes`);
    }

    // CRC covers first 6 header bytes + payload
    const crcInput = new Uint8Array(6 + payloadLen);
    crcInput.set(data.subarray(pos, pos + 6), 0);
    crcInput.set(data.subarray(pos + CODEC_HEADER_SIZE, pos + CODEC_HEADER_SIZE + payloadLen), 6);
    const expectedCrc = crc16Ccitt(crcInput, 0, crcInput.length);

    if (expectedCrc !== crc) {
      throw new Error(
        `CRC mismatch seq=${seq} offset=${pos}: got 0x${crc.toString(16)} expected 0x${expectedCrc.toString(16)}`
      );
    }

    const payload = data.subarray(pos + CODEC_HEADER_SIZE, pos + CODEC_HEADER_SIZE + payloadLen);
    packets.push({ type: ptype, seq, payload });
    pos += CODEC_HEADER_SIZE + payloadLen;
  }

  return packets;
}

// ── IFRAME decoder ────────────────────────────────────────────────────────────
function decodeIframe(payload: Uint8Array): Uint16Array {
  if (payload.length !== CODEC_FRAME_BYTES) {
    throw new Error(`IFRAME payload size ${payload.length} != ${CODEC_FRAME_BYTES}`);
  }
  // Copy into a properly-aligned Uint16Array (little-endian pixels)
  const buf = new ArrayBuffer(CODEC_FRAME_BYTES);
  new Uint8Array(buf).set(payload);
  return new Uint16Array(buf);
}

// ── RLE tile decoder ──────────────────────────────────────────────────────────
function rleDecodeTile(
  payload: Uint8Array,
  view: DataView,
  payloadBase: number,
  offset: number
): { pixels: Uint16Array; newOffset: number } {
  const runCount = payload[offset]; offset++;
  const pixels = new Uint16Array(CODEC_PIXELS_PER_TILE);
  let pos = 0;

  for (let r = 0; r < runCount; r++) {
    const runLen = payload[offset]; offset++;
    const pixel  = view.getUint16(payloadBase + offset, /*LE=*/true); offset += 2;
    pixels.fill(pixel, pos, pos + runLen);
    pos += runLen;
  }

  if (pos !== CODEC_PIXELS_PER_TILE) {
    throw new Error(`RLE tile pixel count ${pos} != ${CODEC_PIXELS_PER_TILE}`);
  }
  return { pixels, newOffset: offset };
}

// ── PFRAME decoder ────────────────────────────────────────────────────────────
function decodePframe(payload: Uint8Array, prev: Uint16Array): Uint16Array {
  if (payload.length < CODEC_DIRTY_BYTES) {
    throw new Error('PFRAME payload too short for dirty bitmap');
  }

  // Need a DataView anchored at payload's underlying buffer+offset for getUint16
  const payloadBase = payload.byteOffset;
  const view = new DataView(payload.buffer);

  const curr = new Uint16Array(prev);  // copy of prev
  let offset = CODEC_DIRTY_BYTES;

  for (let tileIdx = 0; tileIdx < CODEC_TILE_COUNT; tileIdx++) {
    const byteIdx = Math.floor(tileIdx / 8);
    const bitIdx  = 7 - (tileIdx % 8);  // MSB-first within byte
    if (payload[byteIdx] & (1 << bitIdx)) {
      const ty   = Math.floor(tileIdx / CODEC_TILES_X);
      const tx   = tileIdx % CODEC_TILES_X;
      const row0 = ty * CODEC_TILE_H;
      const col0 = tx * CODEC_TILE_W;

      const { pixels, newOffset } = rleDecodeTile(payload, view, payloadBase, offset);
      offset = newOffset;

      // Write tile pixels into curr (row-major)
      for (let row = 0; row < CODEC_TILE_H; row++) {
        for (let col = 0; col < CODEC_TILE_W; col++) {
          curr[(row0 + row) * CODEC_WIDTH + (col0 + col)] = pixels[row * CODEC_TILE_W + col];
        }
      }
    }
  }

  if (offset !== payload.length) {
    throw new Error(`PFRAME payload not fully consumed: consumed ${offset}, total ${payload.length}`);
  }
  return curr;
}

// ── Main decoder ──────────────────────────────────────────────────────────────
/**
 * Decodes a SADIK .bin buffer into an array of RGB565 frames.
 * Each frame is a Uint16Array(160*128) in row-major order, little-endian pixels.
 */
export function decodeBin(data: Uint8Array): Uint16Array[] {
  const packets = parsePackets(data);

  if (!packets.length || packets[0].type !== CODEC_TYPE_IFRAME) {
    throw new Error('Stream must start with IFRAME');
  }

  const frames: Uint16Array[] = [];
  let prev: Uint16Array | null = null;

  for (const pkt of packets) {
    if (pkt.type === CODEC_TYPE_IFRAME) {
      const frame = decodeIframe(pkt.payload);
      frames.push(frame);
      prev = frame;
    } else if (pkt.type === CODEC_TYPE_PFRAME) {
      if (prev === null) throw new Error('PFRAME before any IFRAME');
      const frame = decodePframe(pkt.payload, prev);
      frames.push(frame);
      prev = frame;
    }
    // ACK / RESYNC — skip (not present in .bin files, only on wire)
  }

  return frames;
}
