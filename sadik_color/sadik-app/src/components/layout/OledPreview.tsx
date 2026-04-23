import React, { useRef, useEffect, useContext } from 'react';
import { AppContext } from '../../context/AppContext';

const DISPLAY_W = 240; // CSS display width — 160×1.5
const DISPLAY_H = 192; // CSS display height — 128×1.5
const FRAME_W = 160;
const FRAME_H = 128;

export default function OledPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const { frameBuffer, frameVersion, engineState } = useContext(AppContext);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = FRAME_W;
    canvas.height = FRAME_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    imageDataRef.current = ctx.createImageData(FRAME_W, FRAME_H);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || !imageDataRef.current) return;

    const imgData = imageDataRef.current;
    const px = imgData.data;
    const buf = frameBuffer;

    // Decode RGB565 LE → RGBA
    for (let i = 0; i < FRAME_W * FRAME_H; i++) {
      const lo = buf[i * 2];
      const hi = buf[i * 2 + 1];
      const pixel = (hi << 8) | lo;
      const r = ((pixel >> 11) & 0x1F) << 3;
      const g = ((pixel >> 5)  & 0x3F) << 2;
      const b =  (pixel        & 0x1F) << 3;
      px[i * 4]     = r;
      px[i * 4 + 1] = g;
      px[i * 4 + 2] = b;
      px[i * 4 + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
  }, [frameVersion, frameBuffer]);

  return (
    <div
      className="border border-border rounded-lg overflow-hidden bg-black oled-glow"
      style={{ width: `${DISPLAY_W}px`, height: `${DISPLAY_H}px` }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
      />
    </div>
  );
}
