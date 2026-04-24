#!/usr/bin/env node
/**
 * SADIK Color — Build Codec Assets
 *
 * Iterates all mp4 clips declared in clips-manifest.json and runs the Python
 * encoder to produce .bin files under sadik_color/assets/codec/.
 *
 * Idempotent: skips a clip when the .bin is newer than the .mp4 source.
 *
 * Usage:
 *   node tools/build-codec-assets.mjs [--force] [--keyframe-interval 48]
 *
 * Options:
 *   --force               Re-encode all clips, ignoring mtime
 *   --keyframe-interval N Override keyframe interval (default: 48)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');                                   // sadik_color/
const MANIFEST_SRC = join(ROOT, 'sadik-app', 'public', 'animations', 'personas', 'sadik', 'clips-manifest.json');
const MP4_DIR      = join(ROOT, 'assets', 'mp4');
const CODEC_DIR    = join(ROOT, 'assets', 'codec');
const ENCODER      = join(__dir, 'codec', 'encode.py');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args         = process.argv.slice(2);
const force        = args.includes('--force');
const kiIdx        = args.indexOf('--keyframe-interval');
const kiArg        = kiIdx >= 0 ? parseInt(args[kiIdx + 1], 10) : 48;
const keyframeInterval = Number.isFinite(kiArg) ? kiArg : 48;

// ── Helpers ───────────────────────────────────────────────────────────────────
function mtimeSafe(p) {
  try { return statSync(p).mtimeMs; } catch { return 0; }
}

function encodeClip(mp4Path, binPath) {
  const result = spawnSync(
    'python',
    [ENCODER, mp4Path, binPath, '--keyframe-interval', String(keyframeInterval)],
    { encoding: 'utf8', stdio: 'pipe' }
  );
  if (result.status !== 0) {
    throw new Error(`Encoder failed for ${basename(mp4Path)}:\n${result.stderr}`);
  }
  return result.stdout;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Ensure output dir exists
  mkdirSync(CODEC_DIR, { recursive: true });

  // Load manifest
  const manifest = JSON.parse(await readFile(MANIFEST_SRC, 'utf8'));

  let encoded = 0;
  let skipped = 0;
  let failed  = 0;
  const updatedManifest = [];

  for (const clip of manifest) {
    const mp4Rel   = clip.source;                      // e.g. "mp4/idle.mp4"
    const mp4Name  = basename(mp4Rel, '.mp4');         // "idle"
    const mp4Path  = join(MP4_DIR, basename(mp4Rel));  // absolute mp4 path
    const binName  = `${mp4Name}.bin`;
    const binPath  = join(CODEC_DIR, binName);
    const codecSrc = `codec/${binName}`;               // relative from assets/

    // Check if mp4 exists
    if (!existsSync(mp4Path)) {
      console.warn(`  [SKIP] mp4 not found: ${mp4Path}`);
      // Keep existing entry, add codecSource only if bin exists
      updatedManifest.push({
        ...clip,
        ...(existsSync(binPath) ? { codecSource: codecSrc } : {}),
      });
      skipped++;
      continue;
    }

    const mp4Mtime = mtimeSafe(mp4Path);
    const binMtime = mtimeSafe(binPath);
    const needsEncode = force || binMtime < mp4Mtime;

    if (!needsEncode) {
      console.log(`  [SKIP] ${clip.name} — .bin up to date`);
      skipped++;
    } else {
      process.stdout.write(`  [ENC]  ${clip.name} (${basename(mp4Path)}) → ${binName} ... `);
      try {
        encodeClip(mp4Path, binPath);
        console.log('done');
        encoded++;
      } catch (err) {
        console.error(`FAILED\n${err.message}`);
        failed++;
        // Keep entry without codecSource on failure
        updatedManifest.push({ ...clip });
        continue;
      }
    }

    // Add / update codecSource
    updatedManifest.push({
      ...clip,
      codecSource: codecSrc,
    });
  }

  // Write updated manifest back
  await writeFile(MANIFEST_SRC, JSON.stringify(updatedManifest, null, 2) + '\n', 'utf8');

  // Also update dist copy if it exists
  const MANIFEST_DIST = join(ROOT, 'sadik-app', 'dist', 'animations', 'personas', 'sadik', 'clips-manifest.json');
  if (existsSync(MANIFEST_DIST)) {
    await writeFile(MANIFEST_DIST, JSON.stringify(updatedManifest, null, 2) + '\n', 'utf8');
    console.log(`\n  Updated dist manifest: ${MANIFEST_DIST}`);
  }

  console.log('\n─────────────────────────────────────────────────');
  console.log(`  Clips encoded : ${encoded}`);
  console.log(`  Clips skipped : ${skipped}`);
  console.log(`  Clips failed  : ${failed}`);
  console.log(`  Codec dir     : ${CODEC_DIR}`);
  console.log(`  Manifest      : ${MANIFEST_SRC}`);
  console.log('─────────────────────────────────────────────────\n');

  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
