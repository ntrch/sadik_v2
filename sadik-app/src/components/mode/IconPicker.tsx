import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ICON_CATEGORIES } from '../../utils/modeIcons';

interface Props {
  anchorRef: React.RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  currentIcon?: string | null;
  color: string;
  onSelect: (iconKey: string) => void;
}

/**
 * Portal-based icon picker popup. Renders a scrollable grid of lucide icons
 * grouped by category. Matches the navbar line-icon aesthetic.
 */
export default function IconPicker({ anchorRef, open, onClose, currentIcon, color, onSelect }: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (open && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const popupWidth = 300;
      let left = rect.left;
      if (left + popupWidth > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - popupWidth - 8);
      }
      setPos({ top: rect.bottom + 4, left });
    } else {
      setPos(null);
    }
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', key);
    };
  }, [open, onClose]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-[1000] bg-bg-card border border-border rounded-btn shadow-card p-3"
      style={{ top: pos.top, left: pos.left, width: 300, maxHeight: 360, overflowY: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {ICON_CATEGORIES.map((cat) => (
        <div key={cat.name} className="mb-3 last:mb-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 px-0.5">
            {cat.name}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cat.icons.map(({ key, Icon }) => {
              const selected = key === currentIcon;
              return (
                <button
                  key={key}
                  onClick={(e) => { e.stopPropagation(); onSelect(key); onClose(); }}
                  title={key}
                  className="w-9 h-9 rounded-btn flex items-center justify-center transition-colors border"
                  style={
                    selected
                      ? { backgroundColor: `${color}33`, borderColor: color, color }
                      : { backgroundColor: 'transparent', borderColor: 'transparent', color: 'var(--color-text-muted, #94a3b8)' }
                  }
                  onMouseEnter={(e) => {
                    if (!selected) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseLeave={(e) => {
                    if (!selected) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <Icon size={16} />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>,
    document.body
  );
}
