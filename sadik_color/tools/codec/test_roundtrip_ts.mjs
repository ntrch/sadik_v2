/**
 * SADIK Color Codec — TypeScript Decoder Round-trip Test (Node.js ESM)
 *
 * Workflow:
 *   1. Run Python encoder on idle.bin (already produced in tools/codec/) — or
 *      produce a fresh .bin from blink.mp4 via subprocess.
 *   2. Dump reference frames via Python decode.py into a temp dir.
 *   3. Decode the same .bin with the TS SadikDecoder logic (inlined here as
 *      plain JS — mirrors SadikDecoder.ts exactly, no build step needed).
 *   4. Assert byte-exact equality for every frame.
 *
 * Run:  node test_roundtrip_ts.mjs [path/to/clip.bin] [path/to/clip.mp4]
 *
 * If no arguments: uses idle.bin + derives reference frames from Python decode.py.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Codec constants (mirror SadikDecoder.ts) ──────────────────────────────────
const CODEC_MAGIC           = 0xC5;
const CODEC_TYPE_IFRAME     = 0x01;
const CODEC_TYPE_PFRAME     = 0x02;
const CODEC_FRAME_BYTES     = 160 * 128 * 2;   // 40960
const CODEC_DIRTY_BYTES     = 40;               // 320 tiles / 8
const CODEC_TILE_COUNT      = 320;
const CODEC_TILES_X         = 20;
const CODEC_TILE_W          = 8;
const CODEC_TILE_H          = 8;
const CODEC_WIDTH           = 160;
const CODEC_PIXELS_PER_TILE = 64;
const CODEC_HEADER_SIZE     = 8;

// ── CRC16-CCITT ───────────────────────────────────────────────────────────────
function crc16Ccitt(buf, offset, length) {
  let crc = 0xFFFF;
  for (let i = offset; i < offset + length; i++) {
    crc ^= buf[i] << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc;
}

// ── Packet parser ─────────────────────────────────────────────────────────────
function parsePackets(data) {
  const packets = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  while (pos < data.length) {
    if (pos + CODEC_HEADER_SIZE > data.length) throw new Error(`Truncated header at ${pos}`);
    const magic      = data[pos];
    const ptype      = data[pos + 1];
    const seq        = view.getUint16(pos + 2, true);
    const payloadLen = view.getUint16(pos + 4, true);
    const crc        = view.getUint16(pos + 6, true);
    if (magic !== CODEC_MAGIC) throw new Error(`Bad magic 0x${magic.toString(16)} at ${pos}`);
    if (pos + CODEC_HEADER_SIZE + payloadLen > data.length) throw new Error(`Truncated payload at ${pos}`);
    const crcInput = new Uint8Array(6 + payloadLen);
    crcInput.set(data.subarray(pos, pos + 6), 0);
    crcInput.set(data.subarray(pos + CODEC_HEADER_SIZE, pos + CODEC_HEADER_SIZE + payloadLen), 6);
    const expected = crc16Ccitt(crcInput, 0, crcInput.length);
    if (expected !== crc) throw new Error(`CRC mismatch seq=${seq}: got 0x${crc.toString(16)} expected 0x${expected.toString(16)}`);
    packets.push({ type: ptype, seq, payload: data.subarray(pos + CODEC_HEADER_SIZE, pos + CODEC_HEADER_SIZE + payloadLen) });
    pos += CODEC_HEADER_SIZE + payloadLen;
  }
  return packets;
}

// ── IFRAME decoder ────────────────────────────────────────────────────────────
function decodeIframe(payload) {
  if (payload.length !== CODEC_FRAME_BYTES) throw new Error(`IFRAME size ${payload.length}`);
  const buf = new ArrayBuffer(CODEC_FRAME_BYTES);
  new Uint8Array(buf).set(payload);
  return new Uint16Array(buf);
}

// ── RLE tile decoder ──────────────────────────────────────────────────────────
function rleDecodeTile(payload, view, payloadBase, offset) {
  const runCount = payload[offset++];
  const pixels = new Uint16Array(CODEC_PIXELS_PER_TILE);
  let pos = 0;
  for (let r = 0; r < runCount; r++) {
    const runLen = payload[offset++];
    const pixel  = view.getUint16(payloadBase + offset, true); offset += 2;
    pixels.fill(pixel, pos, pos + runLen);
    pos += runLen;
  }
  if (pos !== CODEC_PIXELS_PER_TILE) throw new Error(`RLE tile count ${pos} != 64`);
  return { pixels, newOffset: offset };
}

// ── PFRAME decoder ────────────────────────────────────────────────────────────
function decodePframe(payload, prev) {
  if (payload.length < CODEC_DIRTY_BYTES) throw new Error('PFRAME too short');
  const payloadBase = payload.byteOffset;
  const view = new DataView(payload.buffer);
  const curr = new Uint16Array(prev);
  let offset = CODEC_DIRTY_BYTES;
  for (let tileIdx = 0; tileIdx < CODEC_TILE_COUNT; tileIdx++) {
    const byteIdx = Math.floor(tileIdx / 8);
    const bitIdx  = 7 - (tileIdx % 8);
    if (payload[byteIdx] & (1 << bitIdx)) {
      const ty   = Math.floor(tileIdx / CODEC_TILES_X);
      const tx   = tileIdx % CODEC_TILES_X;
      const row0 = ty * CODEC_TILE_H;
      const col0 = tx * CODEC_TILE_W;
      const { pixels, newOffset } = rleDecodeTile(payload, view, payloadBase, offset);
      offset = newOffset;
      for (let row = 0; row < CODEC_TILE_H; row++) {
        for (let col = 0; col < CODEC_TILE_W; col++) {
          curr[(row0 + row) * CODEC_WIDTH + (col0 + col)] = pixels[row * CODEC_TILE_W + col];
        }
      }
    }
  }
  if (offset !== payload.length) throw new Error(`PFRAME not fully consumed: ${offset} / ${payload.length}`);
  return curr;
}

// ── Main decoder ──────────────────────────────────────────────────────────────
function decodeBin(data) {
  const packets = parsePackets(data);
  if (!packets.length || packets[0].type !== CODEC_TYPE_IFRAME) throw new Error('Stream must start with IFRAME');
  const frames = [];
  let prev = null;
  for (const pkt of packets) {
    if (pkt.type === CODEC_TYPE_IFRAME) {
      const f = decodeIframe(pkt.payload); frames.push(f); prev = f;
    } else if (pkt.type === CODEC_TYPE_PFRAME) {
      if (!prev) throw new Error('PFRAME before IFRAME');
      const f = decodePframe(pkt.payload, prev); frames.push(f); prev = f;
    }
  }
  return frames;
}

// ── Test runner ────────────────────────────────────────────────────────────────
function runTest(binPath, refDumpDir) {
  console.log('='.repeat(60));
  console.log(`TS Decoder Round-trip Test`);
  console.log(`  .bin : ${binPath}`);
  console.log('='.repeat(60));

  // 1. Decode with TS logic
  console.log('\n[1/3] Decoding .bin with TS decoder...');
  const binData = new Uint8Array(readFileSync(binPath));
  const tsFrames = decodeBin(binData);
  console.log(`  Decoded ${tsFrames.length} frames`);

  // 2. Dump reference frames via Python decode.py
  console.log('\n[2/3] Dumping reference frames via Python decode.py...');
  const tmpDir = mkdtempSync(join(tmpdir(), 'sadik_ref_'));
  try {
    const pyDecoder = join(__dir, 'decode.py');
    const result = spawnSync('python', [pyDecoder, binPath, '--dump-frames', tmpDir], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`Python decode.py failed:\n${result.stderr}`);
    }
    console.log(`  ${result.stdout.trim()}`);

    // 3. Load reference frames
    console.log('\n[3/3] Comparing frames byte-exact...');
    const refFiles = readdirSync(tmpDir).filter(f => f.startsWith('frame_') && f.endsWith('.bin')).sort();
    const refFrames = refFiles.map(f => new Uint16Array(readFileSync(join(tmpDir, f)).buffer));

    if (tsFrames.length !== refFrames.length) {
      throw new Error(`Frame count mismatch: TS=${tsFrames.length} Python=${refFrames.length}`);
    }

    let mismatches = 0;
    const details = [];
    for (let i = 0; i < tsFrames.length; i++) {
      const ts  = new Uint8Array(tsFrames[i].buffer);
      const ref = new Uint8Array(refFrames[i].buffer);
      if (ts.length !== ref.length) {
        details.push(`frame ${i}: byte length mismatch ${ts.length} vs ${ref.length}`);
        mismatches++;
        continue;
      }
      let diffPixels = 0;
      for (let b = 0; b < ts.length; b++) {
        if (ts[b] !== ref[b]) diffPixels++;
      }
      if (diffPixels > 0) {
        details.push(`frame ${i}: ${diffPixels} byte(s) differ`);
        mismatches++;
      }
    }

    const binStat = readFileSync(binPath);
    const rawTotal = tsFrames.length * CODEC_FRAME_BYTES;
    const ratio = rawTotal / binStat.length;

    console.log('\n  --- Stats ---------------------------------------------------');
    console.log(`  Frames checked    : ${tsFrames.length}`);
    console.log(`  .bin size         : ${binStat.length.toLocaleString()} bytes`);
    console.log(`  Raw equivalent    : ${rawTotal.toLocaleString()} bytes`);
    console.log(`  Compression ratio : ${ratio.toFixed(2)}x`);
    console.log(`  Frame mismatches  : ${mismatches} / ${tsFrames.length}`);

    if (mismatches === 0) {
      console.log(`\n  PASS — bit-exact round-trip (${tsFrames.length} frames)\n`);
      return true;
    } else {
      console.log(`\n  FAIL — ${mismatches} frames differ`);
      details.slice(0, 10).forEach(d => console.log(`    ${d}`));
      if (details.length > 10) console.log(`    ... and ${details.length - 10} more`);
      console.log();
      return false;
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Entry point ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const binPath = resolve(args[0] ?? join(__dir, 'idle.bin'));

const ok = runTest(binPath);
process.exit(ok ? 0 : 1);
