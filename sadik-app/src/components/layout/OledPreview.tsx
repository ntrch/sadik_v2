import React, { useRef, useEffect, useContext } from 'react';
import { AppContext } from '../../context/AppContext';

export default function OledPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const { frameBuffer, frameVersion, engineState } = useContext(AppContext);

  // Initialize canvas once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    imageDataRef.current = ctx.createImageData(128, 64);
  }, []);

  // Repaint whenever frameVersion changes
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

  const { playbackMode, currentClipName, currentFrameIndex, totalFrames } = engineState;
  const clipLabel =
    playbackMode === 'text'
      ? 'metin modu'
      : playbackMode === 'idle'
      ? 'bekleme'
      : currentClipName ?? '—';

  return (
    <div className="mb-3">
      <p className="text-xs text-text-muted mb-2 font-medium tracking-wide uppercase">Ekran Önizleme</p>
      <div
        className="border rounded-btn overflow-hidden bg-black"
        style={{ aspectRatio: '2/1', borderColor: '#1e2a4a' }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 px-0.5">
        <span className="text-[10px] text-text-muted truncate max-w-[70%]">{clipLabel}</span>
        {totalFrames > 0 && (
          <span className="text-[10px] text-text-muted">
            {currentFrameIndex + 1}/{totalFrames}
          </span>
        )}
      </div>
    </div>
  );
}
