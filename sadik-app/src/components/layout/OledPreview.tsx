import React, { useContext } from 'react';
import { AppContext } from '../../context/AppContext';

// color_v2 display dimensions (CSS px — scaled to fit sidebar)
// 320/170 ≈ 1.88:1 landscape — shown at 180px wide
const COLOR_V2_DIMS = { w: 180, h: 96, label: '320×170 RGB565' };

export default function OledPreview() {
  const { engineState, lastMissingClipEvent } = useContext(AppContext);

  const clipName = engineState.currentClipName ?? 'idle';
  const dims = COLOR_V2_DIMS;

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
      {/* Diagnostik overlay — NO_CLIP (debug only, auto-hides after 2.5s) */}
      {lastMissingClipEvent && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '2px 4px',
          background: 'rgba(0,0,0,0.75)',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
          color: '#ff6b00',
          textAlign: 'center',
          pointerEvents: 'none',
        }}>
          NO_CLIP:{lastMissingClipEvent.name}
        </div>
      )}
    </div>
  );
}
