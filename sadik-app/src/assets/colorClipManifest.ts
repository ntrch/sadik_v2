/**
 * Color clip duration map — auto-derived from LittleFS .bin packet parse.
 * Generated: 2026-04-28. Source: sadik_color/sadik-firmware/data/clips/*.bin @ 24fps.
 *
 * Usage: import { COLOR_CLIP_DURATION_MS, COLOR_CLIP_FALLBACK_MS } from './colorClipManifest';
 *        const gap = COLOR_CLIP_DURATION_MS[clipName] ?? COLOR_CLIP_FALLBACK_MS;
 */

/** Fallback gap (ms) when clip name is not in the map. */
export const COLOR_CLIP_FALLBACK_MS = 1500;

/**
 * LittleFS clip name → duration in milliseconds.
 * Derived from actual frame count parsed from each .bin packet stream at 24 fps.
 */
export const COLOR_CLIP_DURATION_MS: Record<string, number> = {
  blink               : 2500,
  break_text          : 2542,
  confirming          : 5250,
  didnthear           : 2583,
  done                : 5250,
  idle                : 2583,
  idle_alt_left_look  : 2625,
  idle_alt_look_down  : 1000,
  idle_alt_right_look : 1000,
  listening           : 8208,
  mode_break          : 3000,
  mode_gaming         : 13708,
  mode_gaming_text    : 2500,
  mode_meeting_text   : 2542,
  mode_working        : 11000,
  mode_working_text   : 1000,
  return_to_idle      : 2542,
  talking             : 2500,
  thinking            : 10875,
  understanding       : 2500,
  wakeword            : 45375,
};
