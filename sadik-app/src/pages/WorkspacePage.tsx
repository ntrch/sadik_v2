import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import {
  Rocket, Code, Terminal, Music, Globe, Briefcase, Coffee, Zap,
  Gamepad2, Palette, Wrench, BookOpen, Camera, Film, Heart, Star,
  Home, Cloud, Database, Server, Lock, Key, Gift, Sparkles,
  Pencil, Trash2, Plus, ChevronUp, ChevronDown, X, Search,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyEnd, Maximize,
  LucideIcon, LayoutGrid, Square,
} from 'lucide-react';
import EmptyState from '../components/common/EmptyState';
import { workspacesApi, Workspace, WorkspaceActionCreate, ActionType } from '../api/workspaces';
import { modesApi } from '../api/modes';
import { AppContext } from '../context/AppContext';
import {
  nextFreeColor, PALETTE, DEFAULT_PRESET_COLORS, useModeColors,
} from '../utils/modeColors';

// ── Mode clip map (mirrors DashboardPage) ───────────────────────────────────

const MODE_CLIP_MAP: Record<string, { intro: string; loop: string }> = {
  working: { intro: 'mod_working', loop: 'mod_working_text' },
  break:   { intro: 'mod_break',   loop: 'mod_break_text'   },
};

// ── Icon map ─────────────────────────────────────────────────────────────────

const ICON_LIST: { name: string; component: LucideIcon }[] = [
  { name: 'Rocket',    component: Rocket    },
  { name: 'Code',      component: Code      },
  { name: 'Terminal',  component: Terminal  },
  { name: 'Music',     component: Music     },
  { name: 'Globe',     component: Globe     },
  { name: 'Briefcase', component: Briefcase },
  { name: 'Coffee',    component: Coffee    },
  { name: 'Zap',       component: Zap       },
  { name: 'Gamepad2',  component: Gamepad2  },
  { name: 'Palette',   component: Palette   },
  { name: 'Wrench',    component: Wrench    },
  { name: 'BookOpen',  component: BookOpen  },
  { name: 'Camera',    component: Camera    },
  { name: 'Film',      component: Film      },
  { name: 'Heart',     component: Heart     },
  { name: 'Star',      component: Star      },
  { name: 'Home',      component: Home      },
  { name: 'Cloud',     component: Cloud     },
  { name: 'Database',  component: Database  },
  { name: 'Server',    component: Server    },
  { name: 'Lock',      component: Lock      },
  { name: 'Key',       component: Key       },
  { name: 'Gift',      component: Gift      },
  { name: 'Sparkles',  component: Sparkles  },
];

function getIconComponent(name: string): LucideIcon {
  return ICON_LIST.find((i) => i.name === name)?.component ?? Rocket;
}

function renderWorkspaceIcon(icon: string, size = 20, color?: string) {
  if (icon.startsWith('data:')) {
    return (
      <img
        src={icon}
        alt="icon"
        style={{ width: size, height: size, objectFit: 'contain', color }}
      />
    );
  }
  const Ic = getIconComponent(icon);
  return <Ic size={size} style={color ? { color } : undefined} />;
}

// ── Action type labels ────────────────────────────────────────────────────────
// window_snap removed from picker (kept in data model for backward compat)

const ACTION_TYPE_LABELS: Partial<Record<ActionType, string>> = {
  launch_app:     'Uygulama Başlat',
  open_url:       'URL Aç',
  system_setting: 'SADIK Ayarı',
};

// ── Window snap buttons ───────────────────────────────────────────────────────

type SnapSide = 'left' | 'right' | 'top' | 'bottom' | 'maximize';

const SNAP_BUTTONS: { side: SnapSide; icon: LucideIcon; label: string }[] = [
  { side: 'left',     icon: AlignHorizontalJustifyStart, label: 'Sol'    },
  { side: 'right',    icon: AlignHorizontalJustifyEnd,   label: 'Sağ'    },
  { side: 'top',      icon: AlignVerticalJustifyStart,   label: 'Üst'    },
  { side: 'bottom',   icon: AlignVerticalJustifyEnd,     label: 'Alt'    },
  { side: 'maximize', icon: Maximize,                    label: 'Tam'    },
];

// ── SADIK boolean settings ────────────────────────────────────────────────────
// These mirror the AppContext-managed boolean settings from SettingsPage.

interface SadikBoolSetting {
  key: string;
  label: string;
}

const SADIK_SETTINGS: SadikBoolSetting[] = [
  { key: 'wake_word_enabled',         label: 'Uyandırma Kelimesi'      },
  { key: 'continuous_conversation',   label: 'Sürekli Konuşma Modu'    },
  { key: 'close_to_tray',             label: 'Sisteme Küçült'           },
  { key: 'proactive_suggestions',     label: 'Proaktif Öneriler'        },
  { key: 'spoken_proactive',          label: 'Sesli Proaktif Öneriler'  },
  { key: 'dnd_active',                label: 'Rahatsız Etme'            },
];

// ── App picker modal ──────────────────────────────────────────────────────────

interface AppEntry { name: string; path: string }

interface AppPickerProps {
  onSelect: (app: AppEntry) => void;
  onClose: () => void;
}

function AppPickerModal({ onSelect, onClose }: AppPickerProps) {
  const [apps, setApps]       = useState<AppEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery]     = useState('');

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.listApps) {
      api.listApps().then((list: AppEntry[]) => {
        setApps(list);
        setLoading(false);
      }).catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const filtered = apps.filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="bg-bg-card border border-border rounded-2xl w-full max-w-md max-h-[70vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-semibold text-text-primary text-sm">Uygulama Seç</span>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-bg-hover text-text-secondary">
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-2 border-b border-border">
          <div className="flex items-center gap-2 bg-bg-main border border-border rounded-lg px-3 py-1.5">
            <Search size={14} className="text-text-muted flex-shrink-0" />
            <input
              autoFocus
              type="text"
              placeholder="Ara..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {loading ? (
            <p className="text-text-muted text-sm text-center py-8">Yükleniyor...</p>
          ) : filtered.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-8">Uygulama bulunamadı</p>
          ) : (
            filtered.map((app) => (
              <button
                key={app.path}
                onClick={() => { onSelect(app); onClose(); }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-bg-hover text-sm text-text-primary transition-colors"
              >
                {app.name}
              </button>
            ))
          )}
        </div>
        {/* Fallback when no electron API or no apps found */}
        {!loading && apps.length === 0 && (
          <div className="px-4 py-3 border-t border-border">
            <p className="text-xs text-text-muted text-center">
              Uygulama listesi alınamadı. Dosya seçici kullanın.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Action row editor ─────────────────────────────────────────────────────────

interface ActionRowProps {
  action: WorkspaceActionCreate;
  index: number;
  total: number;
  onChange: (index: number, action: WorkspaceActionCreate) => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

function ActionRow({ action, index, total, onChange, onDelete, onMoveUp, onMoveDown }: ActionRowProps) {
  const [showAppPicker, setShowAppPicker] = useState(false);

  const setType = (type: ActionType) => {
    onChange(index, { ...action, type, payload: {} });
  };
  const setPayload = (patch: Record<string, unknown>) => {
    onChange(index, { ...action, payload: { ...action.payload, ...patch } });
  };
  const p = action.payload as Record<string, unknown>;

  // Settings map for system_setting action
  const settingsMap = (p.settings ?? {}) as Record<string, boolean>;
  const settingsIncluded = (p.settingsIncluded ?? {}) as Record<string, boolean>;

  const updateSetting = (key: string, value: boolean) => {
    setPayload({ settings: { ...settingsMap, [key]: value } });
  };
  const toggleSettingIncluded = (key: string, included: boolean) => {
    const newIncluded = { ...settingsIncluded, [key]: included };
    setPayload({ settingsIncluded: newIncluded });
  };

  return (
    <>
      {showAppPicker && (
        <AppPickerModal
          onSelect={(app) => setPayload({ path: app.path, _appName: app.name })}
          onClose={() => setShowAppPicker(false)}
        />
      )}
      <div className="relative flex flex-col gap-2 p-3 bg-bg-main border border-border rounded-xl">
        {/* Delete button — top-right absolute */}
        <button
          onClick={() => onDelete(index)}
          className="absolute top-2 right-2 p-1.5 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-colors"
          title="Sil"
        >
          <Trash2 size={13} />
        </button>

        {/* Type selector + reorder */}
        <div className="flex items-center gap-2 pr-8">
          <select
            value={action.type === 'window_snap' ? 'launch_app' : action.type}
            onChange={(e) => setType(e.target.value as ActionType)}
            className="flex-1 bg-bg-card border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-cyan"
          >
            {Object.entries(ACTION_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button
            onClick={() => onMoveUp(index)}
            disabled={index === 0}
            className="p-1.5 rounded-lg hover:bg-bg-hover disabled:opacity-30 text-text-secondary"
            title="Yukarı"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={() => onMoveDown(index)}
            disabled={index === total - 1}
            className="p-1.5 rounded-lg hover:bg-bg-hover disabled:opacity-30 text-text-secondary"
            title="Aşağı"
          >
            <ChevronDown size={14} />
          </button>
        </div>

        {/* launch_app: app picker + snap buttons */}
        {(action.type === 'launch_app' || action.type === 'window_snap') && (
          <div className="flex flex-col sm:flex-row gap-2">
            {/* App picker button */}
            <button
              type="button"
              onClick={() => {
                const api = (window as any).electronAPI;
                if (api?.listApps) {
                  setShowAppPicker(true);
                } else if (api?.pickExe) {
                  api.pickExe().then((result: { canceled: boolean; filePaths: string[] }) => {
                    if (!result.canceled && result.filePaths?.length) {
                      setPayload({ path: result.filePaths[0], _appName: undefined });
                    }
                  });
                }
              }}
              className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-bg-card border border-border rounded-lg text-sm text-text-secondary hover:text-text-primary hover:border-accent-cyan/60 transition-colors text-left min-w-0"
            >
              <span className="truncate text-text-primary flex-1 min-w-0">
                {String(p._appName ?? '') || (String(p.path ?? '').split(/[\\/]/).pop()?.replace('.lnk', '')) || 'Uygulama Seç'}
              </span>
            </button>

            {/* Snap toggle buttons */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {SNAP_BUTTONS.map(({ side, icon: Ic, label }) => {
                const selected = p.snap === side;
                return (
                  <button
                    key={side}
                    type="button"
                    title={label}
                    onClick={() => setPayload({ snap: selected ? undefined : side })}
                    className={`p-1.5 rounded-lg transition-colors ${
                      selected
                        ? 'bg-accent-cyan/20 text-accent-cyan ring-1 ring-accent-cyan/40'
                        : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
                    }`}
                  >
                    <Ic size={15} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* open_url */}
        {action.type === 'open_url' && (
          <input
            type="url"
            placeholder="https://example.com"
            value={String(p.url ?? '')}
            onChange={(e) => setPayload({ url: e.target.value })}
            className="w-full bg-bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan"
          />
        )}

        {/* system_setting: SADIK app boolean settings */}
        {action.type === 'system_setting' && (
          <div className="flex flex-col gap-2">
            {SADIK_SETTINGS.map(({ key, label }) => {
              const included = settingsIncluded[key] ?? false;
              const value    = settingsMap[key] ?? false;
              return (
                <div key={key} className="flex items-center gap-3">
                  {/* Include checkbox */}
                  <label className="flex items-center gap-1.5 cursor-pointer min-w-0">
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={(e) => toggleSettingIncluded(key, e.target.checked)}
                      className="w-3.5 h-3.5 accent-accent-cyan flex-shrink-0"
                    />
                    <span className={`text-xs truncate ${included ? 'text-text-primary' : 'text-text-muted'}`}>{label}</span>
                  </label>
                  {/* On/Off toggle — only active when included */}
                  {included && (
                    <button
                      onClick={() => updateSetting(key, !value)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ml-auto ${
                        value ? 'bg-accent-cyan' : 'bg-bg-card border border-border'
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        value ? 'translate-x-4' : 'translate-x-0.5'
                      }`} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface ModalProps {
  workspace: Workspace | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

function WorkspaceModal({ workspace, onClose, onSaved }: ModalProps) {
  console.log('[WS-DEBUG] WorkspaceModal mount, workspace prop=', workspace?.id, workspace?.name, 'initial actions len=', workspace?.actions?.length ?? 0);
  const { customModes } = useModeColors();
  const presetKeys = Object.keys(DEFAULT_PRESET_COLORS);

  const [name, setName]         = useState(workspace?.name ?? '');
  const [color, setColor]       = useState(workspace?.color ?? nextFreeColor());
  const [icon, setIcon]         = useState(workspace?.icon ?? 'Rocket');
  const [modeSync, setModeSync] = useState<string>(workspace?.mode_sync ?? '');
  const [actions, setActions]   = useState<WorkspaceActionCreate[]>(
    workspace?.actions.map((a) => ({
      order_index: a.order_index,
      type: a.type,
      payload: a.payload as Record<string, unknown>,
    })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savingRef    = useRef(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!name.trim()) { setError('İsim zorunlu'); return; }
    console.log('[WS-DEBUG] handleSave called, actions count=', actions.length, 'payload actions=', JSON.stringify(actions));
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        color,
        icon,
        mode_sync: modeSync || null,
        actions: actions.map((a, i) => ({ ...a, order_index: i })),
      };
      if (workspace) {
        console.log('[WS-DEBUG] PATCH update id=', workspace.id, 'body=', JSON.stringify(payload));
        await workspacesApi.update(workspace.id, payload);
      } else {
        console.log('[WS-DEBUG] POST create body=', JSON.stringify(payload));
        await workspacesApi.create(payload);
      }
      await onSaved();
      onClose();
    } catch {
      setError('Kayıt hatası');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const addAction = () => {
    console.log('[WS-DEBUG] addAction called, current actions len=', actions.length);
    setActions((prev) => [
      ...prev,
      { order_index: prev.length, type: 'launch_app', payload: { path: '' } },
    ]);
  };

  const updateAction = (index: number, action: WorkspaceActionCreate) => {
    setActions((prev) => prev.map((a, i) => (i === index ? action : a)));
  };

  const deleteAction = (index: number) => {
    setActions((prev) => prev.filter((_, i) => i !== index));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setActions((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const moveDown = (index: number) => {
    setActions((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  const handleCustomIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (dataUrl) setIcon(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="bg-bg-card border border-border rounded-2xl w-[min(90vw,640px)] max-w-2xl max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <span className="font-semibold text-text-primary">
            {workspace ? 'Çalışma Alanını Düzenle' : 'Yeni Çalışma Alanı'}
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-hover text-text-secondary">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-5">

          {/* Name */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5 font-medium">İsim</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Kodlama, Toplantı..."
              className="w-full bg-bg-main border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan"
            />
          </div>

          {/* Color + Icon row */}
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Color */}
            <div className="flex-1">
              <label className="block text-xs text-text-muted mb-1.5 font-medium">Renk</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    style={{ background: c }}
                    className={`w-6 h-6 rounded-full transition-transform ${color === c ? 'ring-2 ring-white scale-125' : 'hover:scale-110'}`}
                  />
                ))}
              </div>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                title="Özel renk"
              />
            </div>

            {/* Icon */}
            <div className="flex-1">
              <label className="block text-xs text-text-muted mb-1.5 font-medium">İkon</label>
              <div className="grid grid-cols-6 gap-1.5">
                {ICON_LIST.map(({ name: iname, component: Ic }) => (
                  <button
                    key={iname}
                    onClick={() => setIcon(iname)}
                    title={iname}
                    className={`p-2 rounded-lg flex items-center justify-center transition-all ${
                      icon === iname
                        ? 'bg-accent-cyan/20 text-accent-cyan ring-1 ring-accent-cyan/50'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                    }`}
                  >
                    <Ic size={18} />
                  </button>
                ))}
                {/* Custom icon upload button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Özel İkon Yükle"
                  className={`p-2 rounded-lg flex items-center justify-center transition-all text-xs font-bold border border-dashed ${
                    icon.startsWith('data:')
                      ? 'bg-accent-cyan/20 border-accent-cyan/50 text-accent-cyan ring-1 ring-accent-cyan/50'
                      : 'border-border text-text-muted hover:border-accent-cyan/40 hover:text-text-primary'
                  }`}
                >
                  {icon.startsWith('data:') ? (
                    <img src={icon} alt="custom" style={{ width: 18, height: 18, objectFit: 'contain' }} />
                  ) : (
                    <span style={{ fontSize: 10 }}>+IMG</span>
                  )}
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/svg+xml,image/png,image/jpg,image/jpeg"
                className="hidden"
                onChange={handleCustomIconUpload}
              />
              {icon.startsWith('data:') && (
                <p className="text-[10px] text-text-muted mt-1">
                  Özel ikon seçili.{' '}
                  <button
                    className="underline hover:text-text-primary"
                    onClick={() => setIcon('Rocket')}
                  >
                    Sıfırla
                  </button>
                </p>
              )}
            </div>
          </div>

          {/* Mode sync */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5 font-medium">Mod Senkronizasyonu</label>
            <select
              value={modeSync}
              onChange={(e) => setModeSync(e.target.value)}
              className="w-full bg-bg-main border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-cyan"
            >
              <option value="">Yok</option>
              {presetKeys.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
              {customModes.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div>
            <label className="block text-xs text-text-muted mb-2 font-medium">Aksiyonlar</label>
            <div className="flex flex-col gap-2">
              {actions.map((action, i) => (
                <ActionRow
                  key={i}
                  action={action}
                  index={i}
                  total={actions.length}
                  onChange={updateAction}
                  onDelete={deleteAction}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                />
              ))}
            </div>
            <button
              onClick={addAction}
              className="mt-2 flex items-center gap-2 text-sm text-accent-cyan hover:text-accent-cyan/80 transition-colors"
            >
              <Plus size={14} />
              Aksiyon Ekle
            </button>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            İptal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-accent-cyan text-bg-main hover:bg-accent-cyan/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Run snapshot (for Stop/Undo) ──────────────────────────────────────────────

interface SnapRect { left: number; top: number; right: number; bottom: number }

interface RunSnapshot {
  workspaceRunId: string;
  modeBefore: string | null;
  settingsBefore: Record<string, boolean>;
  launchedPids: { pid: number; target: string; wasPreExisting: boolean }[];
  capturedSnaps: { hwnd: string; rect: SnapRect; pid: number; target: string; wasPreExisting: boolean }[];
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
}

// ── Workspace card ────────────────────────────────────────────────────────────

interface CardProps {
  workspace: Workspace;
  onEdit: (w: Workspace) => void;
  onDelete: (id: number) => void;
  onRun: (w: Workspace) => void;
  onStop: (w: Workspace) => void;
  running: boolean;
  snapshot?: RunSnapshot;
}

function WorkspaceCard({ workspace: ws, onEdit, onDelete, onRun, onStop, running, snapshot }: CardProps) {
  return (
    <div
      className="bg-bg-card border rounded-2xl p-5 flex flex-col gap-3 shadow-card"
      style={{ borderColor: ws.color + '55' }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: ws.color + '22' }}
          >
            {renderWorkspaceIcon(ws.icon, 20, ws.color)}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-text-primary text-sm truncate">{ws.name}</p>
            <p className="text-xs text-text-muted">{ws.actions.length} aksiyon</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          <button
            onClick={() => onEdit(ws)}
            className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title="Düzenle"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => onDelete(ws.id)}
            className="p-2 rounded-lg hover:bg-red-500/10 text-text-secondary hover:text-red-400 transition-colors"
            title="Sil"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Mode badge */}
      {ws.mode_sync && (
        <span className="text-[11px] text-text-muted bg-bg-main border border-border rounded-full px-2 py-0.5 w-fit">
          Mod: {ws.mode_sync}
        </span>
      )}

      {/* Run / Stop buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => onRun(ws)}
          disabled={running}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
          style={{
            background: ws.color + '22',
            color: ws.color,
            border: `1px solid ${ws.color}44`,
          }}
        >
          <Rocket size={15} />
          {running ? 'Çalışıyor...' : 'Başlat'}
        </button>
        {snapshot && (
          <button
            onClick={() => onStop(ws)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25"
            title="Geri Al"
          >
            <Square size={14} />
            Durdur
          </button>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkspacePage() {
  const {
    currentMode,
    setCurrentMode, setDndActive, triggerEvent, showText, playModSequence, getLoadedClipNames, returnToIdle,
    wakeWordEnabled, toggleWakeWord,
    continuousConversation, setContinuousConversation,
    proactiveSuggestionsEnabled, setProactiveSuggestionsEnabled,
    spokenProactiveEnabled, setSpokenProactiveEnabled,
    dndActive,
    showToast: ctxShowToast,
  } = useContext(AppContext);

  const { getModeDnd } = useModeColors();

  const [workspaces, setWorkspaces]   = useState<Workspace[]>([]);
  const [loading, setLoading]         = useState(true);
  const [modalOpen, setModalOpen]     = useState(false);
  const [editTarget, setEditTarget]   = useState<Workspace | null>(null);
  const [modalKey, setModalKey]       = useState(0);
  const [runningId, setRunningId]     = useState<number | null>(null);
  const [toast, setToast]             = useState<ToastState | null>(null);
  const [snapshots, setSnapshots]     = useState<Record<number, RunSnapshot>>({});
  const snapshotsRef = useRef<Record<number, RunSnapshot>>({});
  snapshotsRef.current = snapshots;
  const modeReturnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (modeReturnTimer.current) clearTimeout(modeReturnTimer.current); }, []);

  const showToast = useCallback((message: string, type: ToastState['type'] = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await workspacesApi.list();
      setWorkspaces(data);
    } catch {
      showToast('Çalışma alanları yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  /**
   * Activates a mode using the exact same path as DashboardPage.handleSetMode:
   *  1. modesApi.setMode → backend
   *  2. setCurrentMode → AppContext state
   *  3. setDndActive → apply mode DND setting
   *  4. triggerEvent('confirmation_success') → animation
   *  5. playModSequence / showText → OLED/preview clip
   */
  const activateMode = useCallback(async (mode: string) => {
    try {
      await modesApi.setMode(mode);
      setCurrentMode(mode);
      setDndActive(getModeDnd(mode));
      triggerEvent('confirmation_success');
      if (modeReturnTimer.current) clearTimeout(modeReturnTimer.current);

      const clip = MODE_CLIP_MAP[mode];
      if (clip) {
        modeReturnTimer.current = setTimeout(
          () => playModSequence(clip.intro, clip.loop),
          1200,
        );
      } else {
        showText(mode.toUpperCase());
      }
    } catch {
      // best-effort; don't abort workspace run
    }
  }, [setCurrentMode, setDndActive, getModeDnd, triggerEvent, playModSequence, showText]);

  /**
   * Applies SADIK app settings from a system_setting action payload.
   * Uses the same context setters that SettingsPage uses.
   */
  const applySadikSettings = useCallback(
    (settings: Record<string, boolean>, included: Record<string, boolean>) => {
      for (const [key, value] of Object.entries(settings)) {
        if (!included[key]) continue;
        switch (key) {
          case 'wake_word_enabled':
            if (value !== wakeWordEnabled) toggleWakeWord();
            break;
          case 'continuous_conversation':
            setContinuousConversation(value);
            break;
          case 'proactive_suggestions':
            setProactiveSuggestionsEnabled(value);
            break;
          case 'spoken_proactive':
            setSpokenProactiveEnabled(value);
            break;
          case 'dnd_active':
            setDndActive(value);
            break;
          // close_to_tray is a backend setting — skip for now
          default:
            break;
        }
      }
    },
    [wakeWordEnabled, toggleWakeWord, setContinuousConversation, setProactiveSuggestionsEnabled, setSpokenProactiveEnabled, setDndActive],
  );

  const handleDelete = async (id: number) => {
    if (!window.confirm('Bu çalışma alanını silmek istediğinize emin misiniz?')) return;
    try {
      await workspacesApi.delete(id);
      setWorkspaces((prev) => prev.filter((w) => w.id !== id));
      showToast('Silindi', 'success');
    } catch {
      showToast('Silinemedi', 'error');
    }
  };

  const handleRun = async (ws: Workspace) => {
    setRunningId(ws.id);

    const electronAPI = (window as any).electronAPI;
    const workspaceRunId = (globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random()}`);

    // Snapshot pre-run state (mode + SADIK settings)
    const settingsBefore: Record<string, boolean> = {
      wake_word_enabled:       wakeWordEnabled,
      continuous_conversation: continuousConversation,
      proactive_suggestions:   proactiveSuggestionsEnabled,
      spoken_proactive:        spokenProactiveEnabled,
      dnd_active:              dndActive,
    };
    const snap: RunSnapshot = {
      workspaceRunId,
      modeBefore: currentMode ?? null,
      settingsBefore,
      launchedPids: [],
      capturedSnaps: [],
    };
    setSnapshots((prev) => ({ ...prev, [ws.id]: snap }));

    // Subscribe to snap-captured events for this run (auto-unsubscribe after 90s)
    let unsubscribe: (() => void) | null = null;
    if (electronAPI?.onWorkspaceSnapCaptured) {
      unsubscribe = electronAPI.onWorkspaceSnapCaptured((data: any) => {
        if (!data || data.workspaceRunId !== workspaceRunId) return;
        setSnapshots((prev) => {
          const cur = prev[ws.id];
          if (!cur) return prev;
          return {
            ...prev,
            [ws.id]: {
              ...cur,
              capturedSnaps: [...cur.capturedSnaps, {
                hwnd: String(data.hwnd),
                rect: data.rect,
                pid: Number(data.pid),
                target: String(data.target ?? ''),
                wasPreExisting: Boolean(data.wasPreExisting),
              }],
            },
          };
        });
      });
      setTimeout(() => { if (unsubscribe) { unsubscribe(); unsubscribe = null; } }, 90000);
    }

    try {
      // 1. Mode sync — use full activation path
      if (ws.mode_sync) {
        await activateMode(ws.mode_sync);
      }

      // 2. Apply system_setting actions (SADIK app settings)
      for (const action of ws.actions) {
        if (action.type === 'system_setting') {
          const p = action.payload as Record<string, unknown>;
          applySadikSettings(
            (p.settings ?? {}) as Record<string, boolean>,
            (p.settingsIncluded ?? {}) as Record<string, boolean>,
          );
        }
      }

      // 3. Execute launch/URL/snap actions via Electron IPC
      if (electronAPI?.executeWorkspace) {
        const result = await electronAPI.executeWorkspace({
          actions: ws.actions,
          workspaceName: ws.name,
          workspaceRunId,
        });

        // Record launched PIDs from results (launch_app actions)
        const launched: { pid: number; target: string; wasPreExisting: boolean }[] = [];
        for (const r of (result.results ?? [])) {
          if (r?.type === 'launch_app' && r.ok && typeof r.pid === 'number') {
            launched.push({ pid: r.pid, target: String(r.target ?? ''), wasPreExisting: Boolean(r.wasPreExisting) });
          }
        }
        setSnapshots((prev) => {
          const cur = prev[ws.id];
          if (!cur) return prev;
          return { ...prev, [ws.id]: { ...cur, launchedPids: launched } };
        });

        const failed = result.results?.filter((r: { ok: boolean }) => !r.ok).length ?? 0;
        if (failed > 0) {
          showToast(`${ws.name} başlatıldı (${failed} aksiyon başarısız)`, 'info');
        } else {
          showToast(`${ws.name} başlatıldı`, 'success');
        }
      } else {
        showToast('Electron API bulunamadı (web modunda çalışıyor olabilir)', 'info');
      }
    } catch {
      showToast(`${ws.name} başlatılamadı`, 'error');
    } finally {
      setRunningId(null);
    }
  };

  const handleStop = async (ws: Workspace) => {
    const snap = snapshotsRef.current[ws.id];
    if (!snap) return;
    const electronAPI = (window as any).electronAPI;

    // 1. Restore mode
    try {
      console.log('[WS-STOP] modeBefore=', snap.modeBefore, 'currentMode=', currentMode);
      if (snap.modeBefore) {
        if (snap.modeBefore !== currentMode) {
          await activateMode(snap.modeBefore);
        }
      } else if (currentMode) {
        // Pre-run had no mode active — end the workspace-set mode
        await modesApi.endCurrent();
        setCurrentMode(null);
        setDndActive(false);
        returnToIdle();
      }
    } catch (err) {
      console.error('[WS-STOP] mode restore failed', err);
    }

    // 2. Restore SADIK settings to pre-run values
    try {
      applySadikSettings(snap.settingsBefore, {
        wake_word_enabled: true,
        continuous_conversation: true,
        proactive_suggestions: true,
        spoken_proactive: true,
        dnd_active: true,
      });
    } catch { /* best-effort */ }

    // 3. Restore window positions for pre-existing windows that got snapped
    if (electronAPI?.restoreWindowPosition) {
      for (const s of snap.capturedSnaps) {
        if (!s.wasPreExisting) continue;
        try {
          await electronAPI.restoreWindowPosition({ hwnd: s.hwnd, rect: s.rect });
        } catch { /* best-effort */ }
      }
    }

    // 4. Confirm before killing newly-launched apps
    const newlyLaunched = snap.launchedPids.filter((p) => !p.wasPreExisting);
    if (newlyLaunched.length > 0 && electronAPI?.killPids) {
      const names = newlyLaunched.map((p) => p.target || `pid ${p.pid}`).join(', ');
      if (window.confirm(`${ws.name} tarafından açılan uygulamalar da kapatılsın mı?\n\n${names}`)) {
        try {
          await electronAPI.killPids({ pids: newlyLaunched.map((p) => p.pid) });
        } catch { /* best-effort */ }
      }
    }

    // Clear snapshot
    setSnapshots((prev) => {
      const next = { ...prev };
      delete next[ws.id];
      return next;
    });
    showToast(`${ws.name} durduruldu`, 'success');
  };

  const openCreate = () => { console.log('[WS-DEBUG] openCreate called, current editTarget=', editTarget, 'modalOpen=', modalOpen, 'modalKey=', modalKey); setModalKey(k => k + 1); setEditTarget(null); setModalOpen(true); };
  const openEdit   = (w: Workspace) => { console.log('[WS-DEBUG] openEdit called for workspace=', w?.id, w?.name, 'actions=', w?.actions?.length); setModalKey(k => k + 1); setEditTarget(w); setModalOpen(true); };

  return (
    <div className="p-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-pink/15 flex items-center justify-center">
            <LayoutGrid size={20} className="text-accent-pink" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-text-primary">Çalışma Alanı</h1>
            <p className="text-xs text-text-muted">Tek tıkla iş akışı otomasyonu</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30 hover:bg-accent-cyan/25 transition-colors"
        >
          <Plus size={16} />
          Yeni Çalışma Alanı
        </button>
      </div>

      {/* Grid — responsive */}
      {loading ? (
        <p className="text-text-muted text-sm text-center py-12">Yükleniyor...</p>
      ) : workspaces.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="Henüz çalışma alanı yok"
          description="Sık kullandığın uygulama+sekme grubunu kaydet, tek tıkla aç."
          ctaLabel="Yeni çalışma alanı"
          onCta={openCreate}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {workspaces.map((ws) => (
            <WorkspaceCard
              key={ws.id}
              workspace={ws}
              onEdit={openEdit}
              onDelete={handleDelete}
              onRun={handleRun}
              onStop={handleStop}
              running={runningId === ws.id}
              snapshot={snapshots[ws.id]}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <WorkspaceModal
          key={editTarget?.id ?? 'new-' + modalKey}
          workspace={editTarget}
          onClose={() => setModalOpen(false)}
          onSaved={load}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl text-sm font-medium shadow-lg transition-all ${
            toast.type === 'success' ? 'bg-green-500/20 text-green-300 border border-green-500/30' :
            toast.type === 'error'   ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                                       'bg-bg-card text-text-primary border border-border'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
