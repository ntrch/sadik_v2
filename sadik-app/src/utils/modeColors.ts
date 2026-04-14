import { useEffect, useState } from 'react';
import { settingsApi } from '../api/settings';

export interface CustomModeEntry { name: string; color: string; }

export const DEFAULT_PRESET_COLORS: Record<string, string> = {
  working: '#a78bfa',
  coding:  '#67e8f9',
  break:   '#6ee7b7',
  meeting: '#fcd34d',
};

export const CUSTOM_DEFAULT_COLOR = '#fb923c';

export const PALETTE = [
  '#fb923c', '#f472b6', '#c084fc', '#60a5fa', '#34d399', '#facc15',
  '#f87171', '#22d3ee', '#a3e635', '#eab308', '#e879f9', '#38bdf8',
  '#fda4af', '#f59e0b', '#10b981', '#8b5cf6',
];

type State = {
  presetColors: Record<string, string>;
  customModes: CustomModeEntry[];
  loaded: boolean;
};

const state: State = {
  presetColors: { ...DEFAULT_PRESET_COLORS },
  customModes: [],
  loaded: false,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadModeColors(): Promise<void> {
  if (state.loaded) return;
  try {
    const s = await settingsApi.getAll();
    if (s.preset_mode_colors) {
      try {
        const parsed = JSON.parse(s.preset_mode_colors);
        state.presetColors = { ...state.presetColors, ...parsed };
      } catch { /* ignore */ }
    }
    if (s.custom_modes) {
      try {
        const parsed = JSON.parse(s.custom_modes);
        state.customModes = (Array.isArray(parsed) ? parsed : []).map((e: unknown) => {
          if (typeof e === 'string') return { name: e, color: CUSTOM_DEFAULT_COLOR };
          const o = e as Partial<CustomModeEntry>;
          return { name: String(o.name ?? ''), color: String(o.color ?? CUSTOM_DEFAULT_COLOR) };
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
    await settingsApi.update({
      preset_mode_colors: JSON.stringify(state.presetColors),
      custom_modes: JSON.stringify(state.customModes),
    });
  } catch { /* best-effort */ }
}

export async function setPresetColor(mode: string, color: string): Promise<void> {
  state.presetColors = { ...state.presetColors, [mode]: color };
  emit();
  await persist();
}

export async function addCustomMode(name: string, color: string): Promise<boolean> {
  if (state.customModes.some((m) => m.name === name)) return false;
  state.customModes = [...state.customModes, { name, color }];
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

/** Subscribe hook — rerenders on any color/custom-mode change. */
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
    customModes: state.customModes,
    getModeColor,
    nextFreeColor,
    setPresetColor,
    addCustomMode,
    setCustomModeColor,
    removeCustomMode,
  };
}
