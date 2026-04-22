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
  | 'wake_word_detected'
  | 'user_speaking'
  | 'processing'
  | 'assistant_speaking'
  | 'confirmation_success'
  | 'understanding_resolved'
  | 'didnt_hear'
  | 'soft_error'
  | 'ambiguity'
  | 'conversation_finished'
  | 'return_to_idle'
  | 'show_text'
  | 'show_timer';
