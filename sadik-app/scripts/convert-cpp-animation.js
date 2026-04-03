#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Parse a .cpp file containing PROGMEM bitmap arrays into a JSON animation object.
 * @param {string} filePath - Absolute or relative path to .cpp file
 * @param {object} [options]
 * @param {number} [options.fps=12]
 * @param {boolean} [options.loop=false]
 * @returns {{ name, width, height, frameCount, fps, loop, frames }}
 */
function parseCppAnimation(filePath, options = {}) {
  const fps = options.fps !== undefined ? options.fps : 12;
  const loop = options.loop !== undefined ? options.loop : false;

  const src = fs.readFileSync(filePath, 'utf8');
  const basename = path.basename(filePath, path.extname(filePath));

  // Match both:
  //   const unsigned char epd_bitmap_NAME [] PROGMEM = { ... };
  //   const unsigned char NAME [] PROGMEM = { ... };
  //   (also without PROGMEM)
  const arrayRegex =
    /const\s+unsigned\s+char\s+([\w]+)\s*\[\s*\]\s*(?:PROGMEM\s*)?\s*=\s*\{([^}]+)\}\s*;/g;

  const rawFrames = [];
  let match;
  while ((match = arrayRegex.exec(src)) !== null) {
    const arrayName = match[1];
    const body = match[2];

    // Parse hex and decimal byte values
    const bytes = [];
    const tokenRegex = /0x([0-9a-fA-F]{1,2})|(\d+)/g;
    let tok;
    while ((tok = tokenRegex.exec(body)) !== null) {
      if (tok[1] !== undefined) {
        bytes.push(parseInt(tok[1], 16));
      } else {
        const dec = parseInt(tok[2], 10);
        if (dec >= 0 && dec <= 255) bytes.push(dec);
      }
    }

    rawFrames.push({ name: arrayName, bytes });
  }

  if (rawFrames.length === 0) {
    throw new Error(`No PROGMEM arrays found in ${filePath}`);
  }

  // Sort by numeric suffix: epd_bitmap_0, epd_bitmap_1, ..., epd_bitmap_10
  rawFrames.sort((a, b) => {
    const numA = parseInt((a.name.match(/(\d+)$/) || ['0', '0'])[1], 10);
    const numB = parseInt((b.name.match(/(\d+)$/) || ['0', '0'])[1], 10);
    return numA - numB;
  });

  // Validate frame sizes
  const frames = rawFrames.map((f, i) => {
    if (f.bytes.length !== 1024) {
      console.warn(
        `  Warning: frame ${i} (${f.name}) has ${f.bytes.length} bytes (expected 1024)`
      );
    }
    return f.bytes;
  });

  return {
    name: basename,
    width: 128,
    height: 64,
    frameCount: frames.length,
    fps,
    loop,
    frames,
  };
}

module.exports = { parseCppAnimation };

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node convert-cpp-animation.js <input.cpp> <output.json>');
    process.exit(1);
  }
  const [input, output] = args;
  try {
    const result = parseCppAnimation(path.resolve(input));
    fs.writeFileSync(path.resolve(output), JSON.stringify(result, null, 2));
    console.log(
      `Converted ${result.frameCount} frames from "${path.basename(input)}" → "${path.basename(output)}"`
    );
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}
