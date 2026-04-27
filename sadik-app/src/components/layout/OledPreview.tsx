import React, { useRef, useEffect, useContext } from 'react';
import { AppContext } from '../../context/AppContext';

// 1.3 inch SH1106 OLED: 128×64 native pixels, active area ≈ 30×15 mm
// At ~96 DPI a 1.3″ diagonal ≈ 180×90 CSS px — close to real physical size
const DISPLAY_W = 180;
const DISPLAY_H = 90;

export default function OledPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const { frameBuffer, frameVersion, engineState, connectedDevice } = useContext(AppContext);

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
  }, [frameVersion, frameBuffer]);

  const isColor = connectedDevice?.variant === 'color';

  return (
    <div
      className="relative border border-border rounded-lg overflow-hidden bg-black oled-glow"
      style={{ width: `${DISPLAY_W}px`, height: `${DISPLAY_H}px` }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
      />
      {isColor && (
        <div
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            padding: '1px 5px',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.25)',
            background: 'rgba(0,0,0,0.45)',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.05em',
            lineHeight: 1,
          }}
        >
          <span
            style={{
              background: 'linear-gradient(90deg, #ff3b30 0%, #34c759 50%, #007aff 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            RGB
          </span>
        </div>
      )}
    </div>
  );
}
