/**
 * Scalable bitmap font with auto-fit for 128×64 OLED.
 * Each glyph: 5px wide × 7px tall, stored as 7 bytes (bits 7..3 = cols 0..4).
 *
 * Auto-fit picks the largest integer scale (1–4) that fits the full text.
 * Turkish special characters (İ,ı,Ş,ş,Ğ,ğ,Ü,ü,Ö,ö,Ç,ç) supported via hex code points.
 */

function row(...bits: number[]): number {
  let b = 0;
  for (let i = 0; i < 5; i++) b |= (bits[i] ? 1 : 0) << (7 - i);
  return b;
}

const FONT: Record<number, number[]> = {};

function defCP(cp: number, r0: number, r1: number, r2: number, r3: number, r4: number, r5: number, r6: number) {
  FONT[cp] = [r0, r1, r2, r3, r4, r5, r6];
}

function def(ch: string, r0: number, r1: number, r2: number, r3: number, r4: number, r5: number, r6: number) {
  defCP(ch.codePointAt(0)!, r0, r1, r2, r3, r4, r5, r6);
}

// Space
def(' ',
  row(0,0,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0),
  row(0,0,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0),
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

// a-z → same as uppercase for OLED
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
def("'", row(0,1,0,0,0), row(0,1,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0), row(0,0,0,0,0));

// ── Turkish special characters (hex code points for encoding safety) ─────────

// İ — 0x130 — capital I with dot above
defCP(0x130,
  row(0,1,0,0,0), row(0,0,0,0,0), row(1,1,1,0,0), row(0,1,0,0,0),
  row(0,1,0,0,0), row(1,1,1,0,0), row(0,0,0,0,0));

// ı — 0x131 — dotless i
defCP(0x131,
  row(0,0,0,0,0), row(0,0,0,0,0), row(0,1,0,0,0), row(0,1,0,0,0),
  row(0,1,0,0,0), row(1,1,1,0,0), row(0,0,0,0,0));

// Ş — 0x15E — S with cedilla
defCP(0x15E,
  row(0,1,1,1,0), row(1,0,0,0,0), row(0,1,1,0,0), row(0,0,0,1,0),
  row(1,1,1,0,0), row(0,1,0,0,0), row(0,0,0,0,0));

// ş — 0x15F
defCP(0x15F,
  row(0,0,0,0,0), row(0,1,1,1,0), row(1,0,0,0,0), row(0,1,1,0,0),
  row(0,0,0,1,0), row(1,1,1,0,0), row(0,1,0,0,0));

// Ğ — 0x11E — G with breve
defCP(0x11E,
  row(0,1,0,1,0), row(0,0,1,0,0), row(0,1,1,0,0), row(1,0,0,0,0),
  row(1,0,1,1,0), row(0,1,1,0,0), row(0,0,0,0,0));

// ğ — 0x11F
defCP(0x11F,
  row(0,1,0,1,0), row(0,0,1,0,0), row(0,1,1,1,0), row(1,0,0,1,0),
  row(0,1,1,1,0), row(0,0,0,1,0), row(0,1,1,0,0));

// Ü — 0xDC — U with diaeresis
defCP(0xDC,
  row(1,0,0,1,0), row(0,0,0,0,0), row(1,0,0,1,0), row(1,0,0,1,0),
  row(1,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));

// ü — 0xFC
defCP(0xFC,
  row(1,0,0,1,0), row(0,0,0,0,0), row(1,0,0,1,0), row(1,0,0,1,0),
  row(1,0,0,1,0), row(0,1,1,1,0), row(0,0,0,0,0));

// Ö — 0xD6 — O with diaeresis
defCP(0xD6,
  row(1,0,0,1,0), row(0,0,0,0,0), row(0,1,1,0,0), row(1,0,0,1,0),
  row(1,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));

// ö — 0xF6
defCP(0xF6,
  row(1,0,0,1,0), row(0,0,0,0,0), row(0,1,1,0,0), row(1,0,0,1,0),
  row(1,0,0,1,0), row(0,1,1,0,0), row(0,0,0,0,0));

// Ç — 0xC7 — C with cedilla
defCP(0xC7,
  row(0,1,1,0,0), row(1,0,0,1,0), row(1,0,0,0,0), row(1,0,0,0,0),
  row(0,1,1,0,0), row(0,1,0,0,0), row(0,0,0,0,0));

// ç — 0xE7
defCP(0xE7,
  row(0,0,0,0,0), row(0,1,1,0,0), row(1,0,0,0,0), row(1,0,0,0,0),
  row(0,1,1,0,0), row(0,1,0,0,0), row(0,0,0,0,0));

const CHAR_W = 5;
const CHAR_H = 7;
const CHAR_GAP = 1;

function getGlyph(cp: number): number[] {
  return FONT[cp] ?? FONT['?'.codePointAt(0)!] ?? [0, 0, 0, 0, 0, 0, 0];
}

function setPixel(buffer: Uint8Array, x: number, y: number): void {
  if (x < 0 || x >= 128 || y < 0 || y >= 64) return;
  const byteIndex = y * 16 + Math.floor(x / 8);
  const bitIndex = 7 - (x % 8);
  buffer[byteIndex] |= 1 << bitIndex;
}

/**
 * Find the largest integer scale (1–8) that fits text within 128×64.
 * For multi-line text, evaluates the widest line.
 */
function autoScale(text: string): number {
  const lines = text.split('\n');
  let maxLineChars = 0;
  for (const line of lines) {
    const n = [...line].length;
    if (n > maxLineChars) maxLineChars = n;
  }
  if (maxLineChars === 0) return 1;

  const lineCount = lines.length;

  // Try scales from 8 down to 1
  for (let s = 8; s >= 1; s--) {
    const charPxW = CHAR_W * s;
    const gapPxW = CHAR_GAP * s;
    const totalW = maxLineChars * charPxW + (maxLineChars - 1) * gapPxW;
    const lineH = CHAR_H * s;
    const lineGap = s; // gap between lines
    const totalH = lineCount * lineH + (lineCount - 1) * lineGap;
    if (totalW <= 128 && totalH <= 64) return s;
  }
  return 1;
}

export interface RenderTextOptions {
  x?: number;
  y?: number;
  fontSize?: 'small' | 'large' | 'auto';
  centered?: boolean;
}

/**
 * Render text onto a 1024-byte OLED frame buffer (128×64, horizontal, MSB-first).
 * fontSize='auto' (default) picks the largest scale that fits.
 */
export function renderTextToBuffer(
  buffer: Uint8Array,
  text: string,
  options: RenderTextOptions = {}
): void {
  const fontSize = options.fontSize ?? 'auto';
  const scale = fontSize === 'auto' ? autoScale(text)
              : fontSize === 'large' ? 2
              : 1;
  const centered = options.centered !== false;

  const charPxW = CHAR_W * scale;
  const gapPxW = CHAR_GAP * scale;
  const stepX = charPxW + gapPxW;
  const lineH = CHAR_H * scale;
  const lineGap = scale;

  const lines = text.split('\n');
  const totalH = lines.length * lineH + (lines.length - 1) * lineGap;

  let startY = options.y !== undefined ? options.y : Math.floor((64 - totalH) / 2);

  for (const line of lines) {
    const codePoints = [...line].map((c) => c.codePointAt(0)!);
    const lineW = codePoints.length * charPxW + (codePoints.length - 1) * gapPxW;
    let startX = options.x !== undefined ? options.x : centered ? Math.floor((128 - lineW) / 2) : 0;

    let cx = startX;
    for (const cp of codePoints) {
      const glyph = getGlyph(cp);
      for (let r = 0; r < CHAR_H; r++) {
        const rowByte = glyph[r];
        for (let col = 0; col < CHAR_W; col++) {
          const bit = (rowByte >> (7 - col)) & 1;
          if (bit) {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                setPixel(buffer, cx + col * scale + sx, startY + r * scale + sy);
              }
            }
          }
        }
      }
      cx += stepX;
    }
    startY += lineH + lineGap;
  }
}
