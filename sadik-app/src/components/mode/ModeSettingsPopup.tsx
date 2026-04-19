import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, BellOff, Trash2 } from 'lucide-react';
import { ICON_CATEGORIES } from '../../utils/modeIcons';
import { PALETTE } from '../../utils/modeColors';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DraftState {
  name: string;
  color: string;
  iconKey: string;
  dnd: boolean;
}

type PopupMode =
  | {
      kind: 'preset';
      key: string;
      label: string;
      color: string;
      iconKey: string;
      dnd: boolean;
      onApply: () => void;
      onColorChange: (c: string) => void;
      onIconChange: (k: string) => void;
      onDndChange: (d: boolean) => void;
    }
  | {
      kind: 'custom';
      name: string;
      color: string;
      iconKey: string;
      dnd: boolean;
      onApply: () => void;
      onDelete: () => void;
      onColorChange: (c: string) => void;
      onIconChange: (k: string) => void;
      onDndChange: (d: boolean) => void;
    }
  | {
      kind: 'create';
      initialColor: string;
      onApplyDraft: (d: DraftState) => void;
      onSaveDraft: (d: DraftState) => void;
    };

interface Props {
  anchorRef: React.RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  mode: PopupMode;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ModeSettingsPopup({ anchorRef, open, onClose, mode }: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Draft state for 'create' kind
  const [draft, setDraft] = useState<DraftState>({
    name: '',
    color: mode.kind === 'create' ? mode.initialColor : '#fb923c',
    iconKey: 'briefcase',
    dnd: false,
  });

  // Reset draft when popup opens in create mode
  useEffect(() => {
    if (open && mode.kind === 'create') {
      setDraft({ name: '', color: mode.initialColor, iconKey: 'briefcase', dnd: false });
      // Autofocus name field
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode.kind]);

  // Position popup below anchor
  useEffect(() => {
    if (open && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const popupWidth = 340;
      let left = rect.left;
      if (left + popupWidth > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - popupWidth - 8);
      }
      let top = rect.bottom + 6;
      // Ensure it fits vertically (rough check)
      if (top + 480 > window.innerHeight - 8) {
        top = Math.max(8, rect.top - 486);
      }
      setPos({ top, left });
    } else {
      setPos(null);
    }
  }, [open, anchorRef]);

  // Click-outside + Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [open, onClose]);

  if (!open || !pos) return null;

  // ── Derived values ───────────────────────────────────────────────────────────
  const isCreate = mode.kind === 'create';
  const isCustom = mode.kind === 'custom';
  const isPreset = mode.kind === 'preset';

  const currentColor = isCreate ? draft.color : (mode as any).color as string;
  const currentIconKey = isCreate ? draft.iconKey : ((mode as any).iconKey as string) ?? 'briefcase';
  const currentDnd = isCreate ? draft.dnd : (mode as any).dnd as boolean;
  const title = isCreate ? 'Yeni Mod' : 'Mod Ayarları';

  // Mutation helpers that work for all kinds
  const handleColorChange = (c: string) => {
    if (isCreate) {
      setDraft((d) => ({ ...d, color: c }));
    } else if (mode.kind === 'preset' || mode.kind === 'custom') {
      mode.onColorChange(c);
    }
  };

  const handleIconChange = (k: string) => {
    if (isCreate) {
      setDraft((d) => ({ ...d, iconKey: k }));
    } else if (mode.kind === 'preset' || mode.kind === 'custom') {
      mode.onIconChange(k);
    }
  };

  const handleDndChange = (d: boolean) => {
    if (isCreate) {
      setDraft((prev) => ({ ...prev, dnd: d }));
    } else if (mode.kind === 'preset' || mode.kind === 'custom') {
      mode.onDndChange(d);
    }
  };

  const handleApply = () => {
    if (isCreate) {
      mode.onApplyDraft(draft);
    } else {
      (mode as any).onApply();
    }
    onClose();
  };

  const handleSave = () => {
    if (isCreate) {
      mode.onSaveDraft(draft);
      onClose();
    }
  };

  const handleDelete = () => {
    if (mode.kind === 'custom') {
      mode.onDelete();
      onClose();
    }
  };

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-[1000] bg-bg-card border border-border rounded-card shadow-card flex flex-col"
      style={{ top: pos.top, left: pos.left, width: 340, maxHeight: 480 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-btn flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">

        {/* Name field */}
        {isCreate && (
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">
              Ad
            </label>
            <input
              ref={nameInputRef}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApply(); } }}
              placeholder="Mod adı..."
              className="w-full bg-bg-input border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary placeholder-text-muted outline-none focus:border-border-focus transition-colors"
            />
          </div>
        )}

        {isCustom && (
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">
              Ad
            </label>
            <div
              className="w-full bg-bg-input border border-border rounded-btn px-3 py-1.5 text-xs text-text-muted select-none"
            >
              {(mode as any).name}
            </div>
          </div>
        )}

        {isPreset && (
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">
              Ad
            </label>
            <div className="w-full bg-bg-input border border-border rounded-btn px-3 py-1.5 text-xs text-text-muted select-none">
              {(mode as any).label}
            </div>
          </div>
        )}

        {/* Icon grid */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">
            İkon
          </label>
          <div className="space-y-2 max-h-[160px] overflow-y-auto pr-0.5">
            {ICON_CATEGORIES.map((cat) => (
              <div key={cat.name}>
                <div className="text-[9px] font-semibold uppercase tracking-wider text-text-muted mb-1 px-0.5">
                  {cat.name}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {cat.icons.map(({ key, Icon }) => {
                    const selected = key === currentIconKey;
                    return (
                      <button
                        key={key}
                        onClick={() => handleIconChange(key)}
                        title={key}
                        className="w-9 h-9 rounded-btn flex items-center justify-center transition-colors border"
                        style={
                          selected
                            ? { backgroundColor: `${currentColor}33`, borderColor: currentColor, color: currentColor }
                            : { backgroundColor: 'transparent', borderColor: 'transparent', color: 'var(--color-text-muted, #94a3b8)' }
                        }
                        onMouseEnter={(e) => {
                          if (!selected) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                        }}
                        onMouseLeave={(e) => {
                          if (!selected) e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <Icon size={15} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Color row */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">
            Renk
          </label>
          <div className="flex items-center gap-2">
            {/* Native color input swatch */}
            <label
              title="Renk seç"
              className="relative w-8 h-8 rounded-btn border border-border flex-shrink-0 cursor-pointer overflow-hidden"
              style={{ backgroundColor: currentColor }}
            >
              <input
                type="color"
                value={currentColor}
                onChange={(e) => handleColorChange(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </label>
            {/* Palette swatches */}
            <div className="flex flex-wrap gap-1 flex-1">
              {PALETTE.map((c) => {
                const active = c.toLowerCase() === currentColor.toLowerCase();
                return (
                  <button
                    key={c}
                    onClick={() => handleColorChange(c)}
                    title={c}
                    className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 flex-shrink-0"
                    style={{
                      backgroundColor: c,
                      borderColor: active ? '#fff' : 'transparent',
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* DND toggle */}
        <div className="flex items-center gap-3">
          <BellOff size={13} className={currentDnd ? 'text-accent-red' : 'text-text-muted'} />
          <span className="text-xs text-text-secondary flex-1">Rahatsız Etmeyin</span>
          <button
            onClick={() => handleDndChange(!currentDnd)}
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${currentDnd ? 'bg-accent-red' : 'bg-bg-input border border-border'}`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${currentDnd ? 'left-4' : 'left-0.5'}`}
            />
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border flex-shrink-0">
        {/* Delete — only for custom */}
        {isCustom && (
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-btn bg-accent-red/10 text-accent-red border border-accent-red/30 hover:bg-accent-red/20 transition-colors"
          >
            <Trash2 size={11} /> Sil
          </button>
        )}

        <div className="flex-1" />

        {/* Save — only for create */}
        {isCreate && (
          <button
            onClick={handleSave}
            disabled={!draft.name.trim()}
            className="px-3 py-1.5 bg-accent-purple hover:bg-accent-purple-hover text-white text-xs font-medium rounded-btn transition-colors disabled:opacity-50"
          >
            Kaydet
          </button>
        )}

        {/* Apply — always */}
        <button
          onClick={handleApply}
          disabled={isCreate && !draft.name.trim()}
          className="px-3 py-1.5 bg-bg-input border border-border text-text-secondary text-xs font-medium rounded-btn hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
        >
          Uygula
        </button>
      </div>
    </div>,
    document.body,
  );
}
