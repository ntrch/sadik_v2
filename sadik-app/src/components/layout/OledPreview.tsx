import React, { useRef, useEffect, useContext } from 'react';
import { AppContext } from '../../context/AppContext';

// 1.3 inch SH1106 OLED: 128×64 native pixels, active area ≈ 30×15 mm
// At ~96 DPI a 1.3″ diagonal ≈ 180×90 CSS px — close to real physical size
const DISPLAY_W = 180;
const DISPLAY_H = 90;

// Color display dimensions (CSS px — scaled to fit sidebar)
const COLOR_DIMS: Record<'color' | 'color_v2', { w: number; h: number; label: string }> = {
  color:    { w: 180, h: 112, label: '160×128 RGB565' },
  color_v2: { w: 180, h: 96,  label: '320×170 RGB565' },  // 320/170 ≈ 1.88:1 landscape
};

export default function OledPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const { frameBuffer, frameVersion, engineState, connectedDevice } = useContext(AppContext);

  const variant = connectedDevice?.variant ?? null;
  const isColor = variant === 'color' || variant === 'color_v2';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    imageDataRef.current = ctx.createImageData(128, 64);
  }, []);

  useEffect(() => {
    // For color variants, we don't render the mono frame buffer — firmware handles display
    if (isColor) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || !imageDataRef.current) return;

    const imgData = imageDataRef.current;
    const px = imgData.data;
    const buf = frameBuffer;

    for (let row = 0; row < 64; row++) {
      for (let col = 0; col < 128; col++) {
        const byteIndex = row * 16 + Math.floor(col / 8);
        const bitIndex = 7 - (col % 8);
        const on = (buf[byteIndex] >> bitIndex) & 1;
        const pixelBase = (row * 128 + col) * 4;
        const v = on ? 255 : 0;
        px[pixelBase] = v;
        px[pixelBase + 1] = v;
        px[pixelBase + 2] = v;
        px[pixelBase + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }, [frameVersion, frameBuffer, isColor]);

  // ── Color variant preview (color or color_v2) ────────────────────────────────
  if (isColor && (variant === 'color' || variant === 'color_v2')) {
    const dims = COLOR_DIMS[variant];
    const clipName = engineState.currentClipName ?? 'idle';
    return (
      <div
        className="relative border border-border rounded-lg overflow-hidden oled-glow"
        style={{
          width: `${dims.w}px`,
          height: `${dims.h}px`,
          background: 'linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 100%)',
        }}
      >
        {/* Simulated color TFT content */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 4,
        }}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            background: 'linear-gradient(90deg, #ff3b30 0%, #34c759 50%, #007aff 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            {dims.label}
          </span>
          <span style={{
            fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.05em',
          }}>
            {clipName}
          </span>
        </div>
        {/* RGB badge */}
        <div style={{
          position: 'absolute', top: 4, right: 4,
          padding: '1px 5px', borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.25)',
          background: 'rgba(0,0,0,0.45)',
          fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', lineHeight: 1,
        }}>
          <span style={{
            background: 'linear-gradient(90deg, #ff3b30 0%, #34c759 50%, #007aff 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            RGB
          </span>
        </div>
      </div>
    );
  }

  // ── Mini (mono OLED) preview ──────────────────────────────────────────────────
  return (
    <div
      className="relative border border-border rounded-lg overflow-hidden bg-black oled-glow"
      style={{ width: `${DISPLAY_W}px`, height: `${DISPLAY_H}px` }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
      />
    </div>
  );
}
