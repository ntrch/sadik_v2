// Copies sadik_color/assets/codec/*.bin into sadik-firmware/data/clips/ and writes manifest.json. Run before `pio run -t uploadfs`. Usage: node sadik_color/tools/build-clip-image.mjs

import { readdir, copyFile, mkdir, stat, unlink, readFile, writeFile } from 'node:fs/promises';
import { join, basename, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Repo root is two levels up from sadik_color/tools/
const REPO_ROOT = resolve(__dirname, '../..');

const SRC_DIR = join(REPO_ROOT, 'sadik_color', 'assets', 'codec');
const DEST_DIR = join(REPO_ROOT, 'sadik_color', 'sadik-firmware', 'data', 'clips');
const MANIFEST_PATH = join(REPO_ROOT, 'sadik_color', 'sadik-firmware', 'data', 'manifest.json');
const MASTER_MANIFEST_PATH = join(
  REPO_ROOT,
  'sadik_color',
  'sadik-app',
  'public',
  'animations',
  'personas',
  'sadik',
  'clips-manifest.json'
);

async function main() {
  // Verify source directory exists
  try {
    await stat(SRC_DIR);
  } catch {
    console.error(`[build-clip-image] ERROR: source dir not found: ${SRC_DIR}`);
    process.exit(1);
  }

  // Load master manifest
  let masterEntries = [];
  try {
    const raw = await readFile(MASTER_MANIFEST_PATH, 'utf-8');
    masterEntries = JSON.parse(raw);
    if (!Array.isArray(masterEntries)) throw new Error('clips-manifest.json root is not an array');
  } catch (err) {
    console.error(`[build-clip-image] ERROR: failed to load master manifest: ${err.message}`);
    process.exit(1);
  }

  // Build lookup: codecSource basename → master entry
  // Master uses "codec/<filename>" as codecSource
  const masterByFilename = new Map();
  for (const entry of masterEntries) {
    if (entry.codecSource) {
      const filename = basename(entry.codecSource); // e.g. "blink.bin"
      masterByFilename.set(filename, entry);
    }
  }

  // Enumerate source .bin files
  let srcFiles;
  try {
    const entries = await readdir(SRC_DIR);
    srcFiles = entries.filter(f => extname(f).toLowerCase() === '.bin').sort();
  } catch (err) {
    console.error(`[build-clip-image] ERROR: cannot read source dir: ${err.message}`);
    process.exit(1);
  }

  if (srcFiles.length === 0) {
    console.error(`[build-clip-image] ERROR: no .bin files found in ${SRC_DIR}`);
    process.exit(1);
  }

  // Ensure dest directory exists
  await mkdir(DEST_DIR, { recursive: true });

  // Clean sync: remove orphan .bin files in dest not present in source
  const srcSet = new Set(srcFiles);
  let destFiles = [];
  try {
    const entries = await readdir(DEST_DIR);
    destFiles = entries.filter(f => extname(f).toLowerCase() === '.bin');
  } catch {
    // Dest was just created — nothing to clean
  }
  for (const orphan of destFiles) {
    if (!srcSet.has(orphan)) {
      await unlink(join(DEST_DIR, orphan));
    }
  }

  // Copy each .bin and build manifest entries
  const clips = [];
  let totalBytes = 0;

  for (const filename of srcFiles) {
    const srcPath = join(SRC_DIR, filename);
    const destPath = join(DEST_DIR, filename);

    await copyFile(srcPath, destPath);

    const { size } = await stat(destPath);
    totalBytes += size;

    const name = basename(filename, '.bin');
    const master = masterByFilename.get(filename);
    const loop = master?.loop ?? false;
    const fps = master?.fps ?? 24;

    clips.push({ name, bytes: size, loop, fps });
  }

  // Sort alphabetically by name
  clips.sort((a, b) => a.name.localeCompare(b.name));

  // Write manifest.json
  const manifest = {
    version: 1,
    generated: new Date().toISOString(),
    clips,
  };

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  console.log(
    `[build-clip-image] ${clips.length} clips, ${totalBytes} bytes total → data/clips/`
  );
}

main();
