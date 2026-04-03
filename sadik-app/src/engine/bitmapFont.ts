/**
 * 5x7 bitmap font.
 * Each character: 7 bytes, each byte encodes 5 pixels (bits 7..3, MSB-left).
 * Pixel (col=0) is bit 7, pixel (col=4) is bit 3.
 */

// Helper: encode a row as a byte given 5 bit values (left to right)
function row(...bits: number[]): number {
  let b = 0;
  for (let i = 0; i < 5; i++) b |= (bits[i] ? 1 : 0) << (7 - i);
  return b;
}

// [charCode] = [7 bytes for rows 0-6]
const FONT: Record<number, number[]> = {};

function def(ch: string, r0: number, r1: number, r2: number, r3: number, r4: number, r5: number, r6: number) {
  FONT[ch.codePointAt(0)!] = [r0, r1, r2, r3, r4, r5, r6];
}

// Space
def(' ',
  row(0,0,0,0,0),
  row(0,0,0,0,0),
  row(0,0,0,0,0),
  row(0,0,0,0,0),
  row(0,0,0,0,0),
  row(0,0,0,0,0),
  row(0,0,0,0,0),
);

// A-Z
def('A', row(0,1,1,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,1,1,1,0), row(1,0,0,1,0), row(1,0,0,1,0), row(0,0,0,0,0));
def('B', row(1,1,1,0,0), row(1,0,0,1,0), row(1,1,1,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,1,1,0,0), row(0,0,0,0,0));
def('C', row(0,1,1,0,0), row(1,0,0,1,0), row(1,0,0,0,0), row(1,0,0,0,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));
def('D', row(1,1,0,0,0), row(1,0,1,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,0,1,0,0), row(1,1,0,0,0), row(0,0,0,0,0));
def('E', row(1,1,1,1,0), row(1,0,0,0,0), row(1,1,1,0,0), row(1,0,0,0,0), row(1,0,0,0,0), row(1,1,1,1,0), row(0,0,0,0,0));
def('F', row(1,1,1,1,0), row(1,0,0,0,0), row(1,1,1,0,0), row(1,0,0,0,0), row(1,0,0,0,0), row(1,0,0,0,0), row(0,0,0,0,0));
def('G', row(0,1,1,0,0), row(1,0,0,0,0), row(1,0,0,0,0), row(1,0,1,1,0), row(1,0,0,1,0), row(0,1,1,1,0), row(0,0,0,0,0));
def('H', row(1,0,0,1,0), row(1,0,0,1,0), row(1,1,1,1,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,0,0,1,0), row(0,0,0,0,0));
def('I', row(1,1,1,0,0), row(0,1,0,0,0), row(0,1,0,0,0), row(0,1,0,0,0), row(0,1,0,0,0), row(1,1,1,0,0), row(0,0,0,0,0));
def('J', row(0,0,1,1,0), row(0,0,0,1,0), row(0,0,0,1,0), row(0,0,0,1,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));
def('K', row(1,0,0,1,0), row(1,0,1,0,0), row(1,1,0,0,0), row(1,1,0,0,0), row(1,0,1,0,0), row(1,0,0,1,0), row(0,0,0,0,0));
def('L', row(1,0,0,0,0), row(1,0,0,0,0), row(1,0,0,0,0), row(1,0,0,0,0), row(1,0,0,0,0), row(1,1,1,1,0), row(0,0,0,0,0));
def('M', row(1,0,0,0,1), row(1,1,0,1,1), row(1,0,1,0,1), row(1,0,0,0,1), row(1,0,0,0,1), row(1,0,0,0,1), row(0,0,0,0,0));
def('N', row(1,0,0,1,0), row(1,1,0,1,0), row(1,0,1,1,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,0,0,1,0), row(0,0,0,0,0));
def('O', row(0,1,1,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));
def('P', row(1,1,1,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,1,1,0,0), row(1,0,0,0,0), row(1,0,0,0,0), row(0,0,0,0,0));
def('Q', row(0,1,1,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,0,1,1,0), row(0,1,1,0,0), row(0,0,0,1,0), row(0,0,0,0,0));
def('R', row(1,1,1,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,1,1,0,0), row(1,0,1,0,0), row(1,0,0,1,0), row(0,0,0,0,0));
def('S', row(0,1,1,1,0), row(1,0,0,0,0), row(0,1,0,0,0), row(0,0,1,0,0), row(0,0,0,1,0), row(1,1,1,0,0), row(0,0,0,0,0));
def('T', row(1,1,1,1,1), row(0,0,1,0,0), row(0,0,1,0,0), row(0,0,1,0,0), row(0,0,1,0,0), row(0,0,1,0,0), row(0,0,0,0,0));
def('U', row(1,0,0,1,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));
def('V', row(1,0,0,0,1), row(1,0,0,0,1), row(1,0,0,0,1), row(0,1,0,1,0), row(0,1,0,1,0), row(0,0,1,0,0), row(0,0,0,0,0));
def('W', row(1,0,0,0,1), row(1,0,0,0,1), row(1,0,1,0,1), row(1,0,1,0,1), row(1,1,0,1,1), row(1,0,0,0,1), row(0,0,0,0,0));
def('X', row(1,0,0,1,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,1,1,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(0,0,0,0,0));
def('Y', row(1,0,0,0,1), row(0,1,0,1,0), row(0,0,1,0,0), row(0,0,1,0,0), row(0,0,1,0,0), row(0,0,1,0,0), row(0,0,0,0,0));
def('Z', row(1,1,1,1,0), row(0,0,0,1,0), row(0,0,1,0,0), row(0,1,0,0,0), row(1,0,0,0,0), row(1,1,1,1,0), row(0,0,0,0,0));

// a-z (same as uppercase for simplicity on OLED)
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((ch) => {
  FONT[ch.toLowerCase().codePointAt(0)!] = FONT[ch.codePointAt(0)!];
});

// 0-9
def('0', row(0,1,1,0,0), row(1,0,0,1,0), row(1,0,1,1,0), row(1,1,0,1,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));
def('1', row(0,1,0,0,0), row(1,1,0,0,0), row(0,1,0,0,0), row(0,1,0,0,0), row(0,1,0,0,0), row(1,1,1,0,0), row(0,0,0,0,0));
def('2', row(0,1,1,0,0), row(1,0,0,1,0), row(0,0,0,1,0), row(0,0,1,0,0), row(0,1,0,0,0), row(1,1,1,1,0), row(0,0,0,0,0));
def('3', row(1,1,1,0,0), row(0,0,0,1,0), row(0,1,1,0,0), row(0,0,0,1,0), row(0,0,0,1,0), row(1,1,1,0,0), row(0,0,0,0,0));
def('4', row(0,0,1,1,0), row(0,1,0,1,0), row(1,0,0,1,0), row(1,1,1,1,0), row(0,0,0,1,0), row(0,0,0,1,0), row(0,0,0,0,0));
def('5', row(1,1,1,1,0), row(1,0,0,0,0), row(1,1,1,0,0), row(0,0,0,1,0), row(0,0,0,1,0), row(1,1,1,0,0), row(0,0,0,0,0));
def('6', row(0,1,1,0,0), row(1,0,0,0,0), row(1,1,1,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));
def('7', row(1,1,1,1,0), row(0,0,0,1,0), row(0,0,1,0,0), row(0,1,0,0,0), row(0,1,0,0,0), row(0,1,0,0,0), row(0,0,0,0,0));
def('8', row(0,1,1,0,0), row(1,0,0,1,0), row(0,1,1,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));
def('9', row(0,1,1,0,0), row(1,0,0,1,0), row(0,1,1,1,0), row(0,0,0,1,0), row(0,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));

// Punctuation
def(':', row(0,0,0,0,0), row(0,1,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0), row(0,1,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0));
def('.', row(0,0,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0), row(0,1,0,0,0), row(0,0,0,0,0));
def('-', row(0,0,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0), row(1,1,1,0,0), row(0,0,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0));
def('!', row(0,1,0,0,0), row(0,1,0,0,0), row(0,1,0,0,0), row(0,1,0,0,0), row(0,0,0,0,0), row(0,1,0,0,0), row(0,0,0,0,0));
def('?', row(0,1,1,0,0), row(1,0,0,1,0), row(0,0,0,1,0), row(0,0,1,0,0), row(0,0,0,0,0), row(0,0,1,0,0), row(0,0,0,0,0));

// Turkish special characters
// İ (capital I with dot above) — same shape as I
FONT[0x130] = FONT['I'.codePointAt(0)!];
// ı (dotless i) — like i without top dot
def('ı', row(0,0,0,0,0), row(0,1,0,0,0), row(0,1,0,0,0), row(0,1,0,0,0), row(0,1,0,0,0), row(1,1,1,0,0), row(0,0,0,0,0));
FONT[0x131] = FONT['ı'.codePointAt(0)!];
// Ş (S with cedilla)
def('Ş', row(0,1,1,1,0), row(1,0,0,0,0), row(0,1,1,0,0), row(0,0,0,1,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,1,0,0,0));
FONT[0x15E] = FONT['Ş'.codePointAt(0)!];
// ş
def('ş', row(0,0,0,0,0), row(0,1,1,1,0), row(1,0,0,0,0), row(0,1,1,1,0), row(0,0,0,1,0), row(1,1,1,0,0), row(0,1,0,0,0));
FONT[0x15F] = FONT['ş'.codePointAt(0)!];
// Ğ (G with breve)
def('Ğ', row(0,1,0,1,0), row(0,0,1,0,0), row(0,1,1,1,0), row(1,0,0,0,0), row(1,0,1,1,0), row(0,1,1,0,0), row(0,0,0,0,0));
FONT[0x11E] = FONT['Ğ'.codePointAt(0)!];
// ğ
def('ğ', row(0,1,0,1,0), row(0,0,1,0,0), row(0,1,1,1,0), row(1,0,0,1,0), row(0,1,1,1,0), row(0,0,0,1,0), row(0,1,1,0,0));
FONT[0x11F] = FONT['ğ'.codePointAt(0)!];
// Ü (U with umlaut)
def('Ü', row(1,0,0,1,0), row(0,0,0,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));
FONT[0xDC] = FONT['Ü'.codePointAt(0)!];
// ü
def('ü', row(1,0,0,1,0), row(0,0,0,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(1,0,0,1,0), row(0,1,1,1,0), row(0,0,0,0,0));
FONT[0xFC] = FONT['ü'.codePointAt(0)!];
// Ö (O with umlaut)
def('Ö', row(1,0,0,1,0), row(0,0,0,0,0), row(0,1,1,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));
FONT[0xD6] = FONT['Ö'.codePointAt(0)!];
// ö
def('ö', row(1,0,0,1,0), row(0,0,0,0,0), row(0,1,1,0,0), row(1,0,0,1,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));
FONT[0xF6] = FONT['ö'.codePointAt(0)!];
// Ç (C with cedilla)
def('Ç', row(0,1,1,0,0), row(1,0,0,1,0), row(1,0,0,0,0), row(1,0,0,0,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,1,0,0,0));
FONT[0xC7] = FONT['Ç'.codePointAt(0)!];
// ç
def('ç', row(0,0,0,0,0), row(0,1,1,0,0), row(1,0,0,1,0), row(1,0,0,0,0), row(1,0,0,1,0), row(0,1,1,0,0), row(0,1,0,0,0));
FONT[0xE7] = FONT['ç'.codePointAt(0)!];

const CHAR_W = 5; // glyph width
const CHAR_H = 7; // glyph height
const CHAR_GAP = 1; // pixels between characters

/** Get glyph data for a character (fallback to '?') */
function getGlyph(cp: number): number[] {
  return FONT[cp] ?? FONT['?'.codePointAt(0)!] ?? [0, 0, 0, 0, 0, 0, 0];
}

/** Measure pixel width of a string */
function measureText(text: string): number {
  const codePoints = [...text].map((c) => c.codePointAt(0)!);
  if (codePoints.length === 0) return 0;
  return codePoints.length * (CHAR_W + CHAR_GAP) - CHAR_GAP;
}

/** Set a single pixel in the 1024-byte OLED buffer (128x64, horizontal bytes, MSB first) */
function setPixel(buffer: Uint8Array, x: number, y: number): void {
  if (x < 0 || x >= 128 || y < 0 || y >= 64) return;
  const byteIndex = y * 16 + Math.floor(x / 8);
  const bitIndex = 7 - (x % 8);
  buffer[byteIndex] |= 1 << bitIndex;
}

export interface RenderTextOptions {
  x?: number;
  y?: number;
  fontSize?: 'small' | 'large';
  centered?: boolean;
}

/**
 * Render text onto a 1024-byte OLED frame buffer (128x64, horizontal, MSB-first).
 * Supports multi-line text via \n.
 */
export function renderTextToBuffer(
  buffer: Uint8Array,
  text: string,
  options: RenderTextOptions = {}
): void {
  const scale = options.fontSize === 'large' ? 2 : 1;
  const centered = options.centered !== false;

  const gW = (CHAR_W + CHAR_GAP) * scale;
  const gH = (CHAR_H + 1) * scale; // 1px line gap
  const linePad = scale;

  const lines = text.split('\n');
  const totalH = lines.length * gH - linePad;

  let startY = options.y !== undefined ? options.y : Math.floor((64 - totalH) / 2);

  for (const line of lines) {
    const lineW = measureText(line) * scale;
    let startX = options.x !== undefined ? options.x : centered ? Math.floor((128 - lineW) / 2) : 0;

    const codePoints = [...line].map((c) => c.codePointAt(0)!);
    let cx = startX;

    for (const cp of codePoints) {
      const glyph = getGlyph(cp);
      for (let row = 0; row < CHAR_H; row++) {
        const rowByte = glyph[row];
        for (let col = 0; col < CHAR_W; col++) {
          const bit = (rowByte >> (7 - col)) & 1;
          if (bit) {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                setPixel(buffer, cx + col * scale + sx, startY + row * scale + sy);
              }
            }
          }
        }
      }
      cx += gW;
    }
    startY += gH;
  }
}
