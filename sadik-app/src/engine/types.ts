export interface ClipManifestEntry {
  name: string;
  category: 'ambient' | 'core';
  source: string;
  frameCount: number;
  width: number;
  height: number;
  fps: number;
  loop: boolean;
}

export interface ClipData {
  name: string;
  width: number;
  height: number;
  frameCount: number;
  frames: number[][];
  fps: number;
  loop: boolean;
}

export type PlaybackMode = 'idle' | 'explicit_clip' | 'text';

export type IdleSubState = 'idle_loop' | 'blink' | 'variation' | 'focus_look';

export interface EngineState {
  playbackMode: PlaybackMode;
  currentClipName: string | null;
  currentFrameIndex: number;
  totalFrames: number;
  isPlaying: boolean;
  idleSubState: IdleSubState;
  textContent: string | null;
  fps: number;
}

export type AnimationEventType =
  // ── Legacy engine-internal (kept for show_text / show_timer) ─────────────
  | 'show_text'
  | 'show_timer'
  | 'return_to_idle'
  // ── Voice events ──────────────────────────────────────────────────────────
  | 'voice.wake_word_detected'
  | 'voice.user_speaking'
  | 'voice.processing'
  | 'voice.assistant_speaking'
  | 'voice.understanding_resolved'
  | 'voice.didnt_hear'
  | 'voice.soft_error'
  | 'voice.conversation_finished'
  | 'voice.return_to_idle'
  // ── Task events ───────────────────────────────────────────────────────────
  | 'task.completed'
  | 'task.milestone.daily_five'
  | 'tasks.action.success'
  // ── Chat events ───────────────────────────────────────────────────────────
  | 'chat.confirmed'
  // ── Mode events ───────────────────────────────────────────────────────────
  | 'mode.changed.working'
  | 'mode.changed.break'
  | 'mode.changed.gaming'
  | 'mode.changed.meeting'
  | 'mode.changed.generic'
  // ── Pomodoro events ───────────────────────────────────────────────────────
  | 'pomodoro.session.completed'
  // ── Page-level action events ──────────────────────────────────────────────
  | 'settings.saved'
  | 'workspace.action.success'
  | 'dashboard.action.success'
  | 'focus.action.success'
  | 'generic.success';
