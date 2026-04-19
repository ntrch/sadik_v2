import { useEffect, useState } from 'react';
import { settingsApi } from '../api/settings';
import { DEFAULT_PRESET_ICONS } from './modeIcons';

export interface CustomModeEntry { name: string; color: string; dnd: boolean; icon?: string; }

export const DEFAULT_PRESET_COLORS: Record<string, string> = {
  working: '#a78bfa',
  coding:  '#67e8f9',
  break:   '#6ee7b7',
  meeting: '#fcd34d',
};

export const DEFAULT_PRESET_DND: Record<string, boolean> = {
  working: false,
  coding:  false,
  break:   false,
  meeting: false,
};

export const CUSTOM_DEFAULT_COLOR = '#fb923c';

export const PALETTE = [
  '#fb923c', '#f472b6', '#c084fc', '#60a5fa', '#34d399', '#facc15',
  '#f87171', '#22d3ee', '#a3e635', '#eab308', '#e879f9', '#38bdf8',
  '#fda4af', '#f59e0b', '#10b981', '#8b5cf6',
];

type State = {
  presetColors: Record<string, string>;
  presetDnd: Record<string, boolean>;
  presetIcons: Record<string, string>;
  customModes: CustomModeEntry[];
  loaded: boolean;
};

const state: State = {
  presetColors: { ...DEFAULT_PRESET_COLORS },
  presetDnd: { ...DEFAULT_PRESET_DND },
  presetIcons: { ...DEFAULT_PRESET_ICONS },
  customModes: [],
  loaded: false,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadModeColors(): Promise<void> {
  if (state.loaded) return;
  try {
    const s = await settingsApi.getAll();
    // Migrate: preset_mode_settings supersedes preset_mode_colors (adds dnd).
    if (s.preset_mode_settings) {
      try {
        const parsed = JSON.parse(s.preset_mode_settings) as Record<string, { color: string; dnd?: boolean; icon?: string }>;
        Object.entries(parsed).forEach(([k, v]) => {
          if (v.color) state.presetColors[k] = v.color;
          if (typeof v.dnd === 'boolean') state.presetDnd[k] = v.dnd;
          if (v.icon) state.presetIcons[k] = v.icon;
        });
      } catch { /* ignore */ }
    } else if (s.preset_mode_colors) {
      // Legacy: old shape — only colors, no dnd
      try {
        const parsed = JSON.parse(s.preset_mode_colors);
        state.presetColors = { ...state.presetColors, ...parsed };
      } catch { /* ignore */ }
    }
    if (s.custom_modes) {
      try {
        const parsed = JSON.parse(s.custom_modes);
        state.customModes = (Array.isArray(parsed) ? parsed : []).map((e: unknown) => {
          if (typeof e === 'string') return { name: e, color: CUSTOM_DEFAULT_COLOR, dnd: false };
          const o = e as Partial<CustomModeEntry>;
          return {
            name: String(o.name ?? ''),
            color: String(o.color ?? CUSTOM_DEFAULT_COLOR),
            dnd: typeof o.dnd === 'boolean' ? o.dnd : false,
            icon: o.icon ? String(o.icon) : undefined,
          };
        }).filter((m) => m.name);
      } catch { /* ignore */ }
    }
  } catch { /* best-effort */ }
  state.loaded = true;
  emit();
}

export function getModeColor(name: string): string {
  if (state.presetColors[name]) return state.presetColors[name];
  const c = state.customModes.find((m) => m.name === name);
  if (c) return c.color;
  return CUSTOM_DEFAULT_COLOR;
}

export function getModeDnd(name: string): boolean {
  if (name in state.presetDnd) return state.presetDnd[name];
  const c = state.customModes.find((m) => m.name === name);
  return c?.dnd ?? false;
}

function usedColors(excludeName?: string): Set<string> {
  const out = new Set<string>();
  Object.entries(state.presetColors).forEach(([k, v]) => { if (k !== excludeName) out.add(v.toLowerCase()); });
  state.customModes.forEach((m) => { if (m.name !== excludeName) out.add(m.color.toLowerCase()); });
  return out;
}

export function nextFreeColor(): string {
  const used = usedColors();
  const free = PALETTE.find((c) => !used.has(c.toLowerCase()));
  return free ?? CUSTOM_DEFAULT_COLOR;
}

async function persist(): Promise<void> {
  try {
    // Build preset_mode_settings blob combining color + dnd + icon
    const presetSettings: Record<string, { color: string; dnd: boolean; icon: string }> = {};
    Object.keys(state.presetColors).forEach((k) => {
      presetSettings[k] = {
        color: state.presetColors[k],
        dnd:   state.presetDnd[k]   ?? false,
        icon:  state.presetIcons[k] ?? DEFAULT_PRESET_ICONS[k] ?? 'briefcase',
      };
    });
    await settingsApi.update({
      preset_mode_settings: JSON.stringify(presetSettings),
      custom_modes: JSON.stringify(state.customModes),
    });
  } catch { /* best-effort */ }
}

export async function setPresetColor(mode: string, color: string): Promise<void> {
  state.presetColors = { ...state.presetColors, [mode]: color };
  emit();
  await persist();
}

export async function setModeDnd(mode: string, dnd: boolean): Promise<void> {
  if (mode in state.presetDnd || DEFAULT_PRESET_COLORS[mode] !== undefined) {
    state.presetDnd = { ...state.presetDnd, [mode]: dnd };
  } else {
    state.customModes = state.customModes.map((m) => (m.name === mode ? { ...m, dnd } : m));
  }
  emit();
  await persist();
}

export async function addCustomMode(name: string, color: string): Promise<boolean> {
  if (state.customModes.some((m) => m.name === name)) return false;
  state.customModes = [...state.customModes, { name, color, dnd: false }];
  emit();
  await persist();
  return true;
}

export async function setCustomModeColor(name: string, color: string): Promise<void> {
  state.customModes = state.customModes.map((m) => (m.name === name ? { ...m, color } : m));
  emit();
  await persist();
}

export async function removeCustomMode(name: string): Promise<void> {
  state.customModes = state.customModes.filter((m) => m.name !== name);
  emit();
  await persist();
}

export function getCustomModes(): CustomModeEntry[] { return state.customModes; }
export function getPresetColors(): Record<string, string> { return state.presetColors; }
export function getPresetDnd(): Record<string, boolean> { return state.presetDnd; }

export function getModeIcon(name: string): string | null {
  if (state.presetIcons[name]) return state.presetIcons[name];
  const c = state.customModes.find((m) => m.name === name);
  return c?.icon ?? null;
}

export async function setPresetIcon(mode: string, icon: string): Promise<void> {
  state.presetIcons = { ...state.presetIcons, [mode]: icon };
  emit();
  await persist();
}

export async function setCustomModeIcon(name: string, icon: string): Promise<void> {
  state.customModes = state.customModes.map((m) => (m.name === name ? { ...m, icon } : m));
  emit();
  await persist();
}

/** Subscribe hook — rerenders on any color/custom-mode/dnd change. */
export function useModeColors() {
  const [, setTick] = useState(0);
  useEffect(() => {
    loadModeColors();
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return {
    presetColors: state.presetColors,
    presetDnd: state.presetDnd,
    presetIcons: state.presetIcons,
    customModes: state.customModes,
    getModeColor,
    getModeDnd,
    getModeIcon,
    nextFreeColor,
    setPresetColor,
    setModeDnd,
    setPresetIcon,
    setCustomModeIcon,
    addCustomMode,
    setCustomModeColor,
    removeCustomMode,
  };
}
