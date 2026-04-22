#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseCppAnimation } = require('./convert-cpp-animation');

const ROOT = path.resolve(__dirname, '..');

const DIRS = {
  idle_variations: {
    input: path.join(ROOT, 'assets', 'raw_cpp', 'idle_variations'),
    output: path.join(ROOT, 'public', 'animations', 'idle_variations'),
    category: 'ambient',
  },
  core_character: {
    input: path.join(ROOT, 'assets', 'raw_cpp', 'core_character'),
    output: path.join(ROOT, 'public', 'animations', 'core_character'),
    category: 'core',
  },
  mods: {
    input: path.join(ROOT, 'assets', 'raw_cpp', 'mods'),
    output: path.join(ROOT, 'public', 'animations', 'mods'),
    category: 'core',
    namePrefix: 'mod_',
    // Intros (working, break) play once; *_text variants loop indefinitely.
    loopPolicy: (name) => name.endsWith('_text'),
  },
};

const MANIFEST_PATH = path.join(ROOT, 'public', 'animations', 'clips-manifest.json');
const DEFAULT_FPS = 12;

function getLoopPolicy(name) {
  return name === 'idle';
}

function scanCppFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.cpp'))
    .map((f) => path.join(dir, f));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function main() {
  let totalConverted = 0;
  let totalErrors = 0;
  const manifest = [];

  for (const [groupKey, cfg] of Object.entries(DIRS)) {
    const files = scanCppFiles(cfg.input);
    ensureDir(cfg.output);

    for (const filePath of files) {
      const baseName = path.basename(filePath, '.cpp');
      const outputPath = path.join(cfg.output, `${baseName}.json`);
      const loop = cfg.loopPolicy ? cfg.loopPolicy(baseName) : getLoopPolicy(baseName);
      const manifestName = (cfg.namePrefix || '') + baseName;

      try {
        const data = parseCppAnimation(filePath, { fps: DEFAULT_FPS, loop });
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

        const relSource = `${groupKey}/${baseName}.json`;
        manifest.push({
          name: manifestName,
          category: cfg.category,
          source: relSource,
          frameCount: data.frameCount,
          width: data.width,
          height: data.height,
          fps: DEFAULT_FPS,
          loop,
        });

        console.log(`  ✓ ${groupKey}/${baseName}.cpp → ${data.frameCount} frames`);
        totalConverted++;
      } catch (err) {
        console.error(`  ✗ ${groupKey}/${baseName}.cpp: ${err.message}`);
        totalErrors++;
      }
    }
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  if (totalConverted === 0 && totalErrors === 0) {
    console.log('\nNo .cpp files found. Add them to assets/raw_cpp/ and run again.');
    console.log('Created empty manifest at public/animations/clips-manifest.json');
  } else {
    console.log(`\nDone: ${totalConverted} converted, ${totalErrors} errors`);
    console.log(`Manifest written with ${manifest.length} entries → public/animations/clips-manifest.json`);
  }
}

main();
