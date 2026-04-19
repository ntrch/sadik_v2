import {
  ClipManifestEntry,
  ClipData,
  PlaybackMode,
  IdleSubState,
  EngineState,
  AnimationEventType,
} from './types';
import { EVENT_TO_CLIP, LOOPING_EVENT_CLIPS, AUTO_RETURN_CLIPS, EVENT_DISPLAY_TEXT } from './eventMapping';
import { renderTextToBuffer } from './bitmapFont';

const BUFFER_SIZE = 1024; // 128 * 64 / 8

interface PlaybackState {
  clip: ClipData | null;
  frameIndex: number;
  loop: boolean;
  onFinish: (() => void) | null;
  lastFrameTime: number;
  isPlaying: boolean;
}

export class AnimationEngine {
  private clips: Map<string, ClipData> = new Map();
  private frameBuffer: Uint8Array = new Uint8Array(BUFFER_SIZE);
  private bufferDirty = true;
  private lastTextEmitTime = 0;

  private playbackMode: PlaybackMode = 'text';
  private textContent: string = 'SADIK';
  private idleSubState: IdleSubState = 'idle_loop';

  private pb: PlaybackState = {
    clip: null,
    frameIndex: 0,
    loop: false,
    onFinish: null,
    lastFrameTime: 0,
    isPlaying: false,
  };

  // Idle orchestration — two independent timers
  private idleInitialized = false;
  private blinkTimeout: ReturnType<typeof setTimeout> | null = null;
  private variationTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastVariationDirection: 'left' | 'right' | null = null;
  private variationPending = false; // variation fired while blink was playing

  private deviceCommandCallback: ((cmd: string) => void) | null = null;
  private stateChangeCallback: ((state: EngineState) => void) | null = null;
  private frameReadyCallback: ((buffer: Uint8Array) => void) | null = null;

  // Command debounce
  private lastCommandTime = 0;
  private pendingCommand: string | null = null;
  private commandTimeout: ReturnType<typeof setTimeout> | null = null;

  private streamingEnabled = true;

  // ─── Focus-look state ────────────────────────────────────────────────────────
  private focusActive: boolean = false;
  private focusDirection: 'left' | 'right' | 'down' | null = null;

  constructor() {
    this.clearBuffer();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  onDeviceCommand(cb: (cmd: string) => void): void {
    this.deviceCommandCallback = cb;
  }

  onStateChange(cb: (state: EngineState) => void): void {
    this.stateChangeCallback = cb;
  }

  onFrameReady(cb: (buffer: Uint8Array) => void): void {
    this.frameReadyCallback = cb;
  }

  setStreamingEnabled(enabled: boolean): void {
    this.streamingEnabled = enabled;
  }

  async loadClips(personaSlug: string = 'sadik'): Promise<void> {
    const base = `/animations/personas/${personaSlug}`;
    try {
      const res = await fetch(`${base}/clips-manifest.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest: ClipManifestEntry[] = await res.json();

      if (!manifest || manifest.length === 0) {
        console.log('[AnimationEngine] No clips in manifest — text mode');
        this.playbackMode = 'text';
        this.textContent = 'SADIK';
        this.emitState();
        return;
      }

      const loadPromises = manifest.map(async (entry) => {
        try {
          const r = await fetch(`${base}/${entry.source}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          const clip: ClipData = {
            name: entry.name,
            width: data.width ?? 128,
            height: data.height ?? 64,
            frameCount: data.frameCount ?? (data.frames?.length ?? 0),
            frames: data.frames ?? [],
            fps: entry.fps ?? 12,
            loop: entry.loop ?? false,
          };
          this.clips.set(entry.name, clip);
        } catch (e) {
          console.warn(`[AnimationEngine] Failed to load clip "${entry.name}":`, e);
        }
      });

      await Promise.all(loadPromises);
      console.log(`[AnimationEngine] Loaded ${this.clips.size} clips`);

      if (this.clips.has('idle')) {
        this.startIdleOrchestration();
      } else {
        this.playbackMode = 'text';
        this.textContent = 'SADIK';
      }
    } catch (e) {
      console.warn('[AnimationEngine] Could not load manifest — text mode', e);
      this.playbackMode = 'text';
      this.textContent = 'SADIK';
    }
    this.emitState();
  }

  triggerEvent(event: AnimationEventType, payload?: { text?: string }): void {
    if (event === 'return_to_idle') {
      this.stopClip();
      if (this.clips.has('idle')) {
        this.startIdleOrchestration();
      } else {
        this.playbackMode = 'text';
        this.textContent = 'SADIK';
      }
      this.emitState();
      return;
    }

    if (event === 'show_text' || event === 'show_timer') {
      const txt = payload?.text ?? '';
      this.enterTextMode(txt);
      this.emitState();
      return;
    }

    // Leaving idle — stop both independent timers before taking over playback
    this.cancelIdleTimers();

    const clipName = EVENT_TO_CLIP[event];

    if (clipName && this.clips.has(clipName)) {
      const shouldLoop = LOOPING_EVENT_CLIPS.has(clipName);
      const shouldAutoReturn = AUTO_RETURN_CLIPS.has(clipName);

      this.playbackMode = 'explicit_clip';
      this.playClip(clipName, {
        loop: shouldLoop,
        onFinish: shouldAutoReturn
          ? () => {
              if (this.clips.has('idle')) {
                this.startIdleOrchestration();
              } else {
                this.enterTextMode('SADIK');
              }
              this.emitState();
            }
          : undefined,
      });
    } else {
      // Clip not loaded — fall back to text
      const displayText = EVENT_DISPLAY_TEXT[event] ?? event.toUpperCase();
      this.enterTextMode(displayText);
    }
    this.emitState();
  }

  /** Call this method on every requestAnimationFrame. Returns frame buffer. */
  update(timestamp: number): Uint8Array {
    if (this.playbackMode === 'text') {
      if (this.bufferDirty) {
        this.clearBuffer();
        renderTextToBuffer(this.frameBuffer, this.textContent, { centered: true });
        this.bufferDirty = false;
        // Force an immediate emit on any content change.
        this.lastTextEmitTime = 0;
      }
      // Re-emit at 4 Hz while showing text.  Static content doesn't need
      // animation, but periodic re-emission guarantees that a single lost
      // frame (ACK timeout, in-flight drop) self-heals within 250 ms instead
      // of leaving the OLED permanently behind the preview.
      if (this.streamingEnabled && timestamp - this.lastTextEmitTime >= 250) {
        this.lastTextEmitTime = timestamp;
        this.frameReadyCallback?.(this.frameBuffer);
      }
      return this.frameBuffer;
    }

    if (this.playbackMode === 'idle') {
      this.updateIdleOrchestration(timestamp);
    }

    if (this.pb.isPlaying && this.pb.clip) {
      const msPerFrame = 1000 / (this.pb.clip.fps || 12);
      if (timestamp - this.pb.lastFrameTime >= msPerFrame) {
        this.pb.lastFrameTime = timestamp;
        this.pb.frameIndex++;

        if (this.pb.frameIndex >= this.pb.clip.frames.length) {
          if (this.pb.loop) {
            this.pb.frameIndex = 0;
          } else {
            this.pb.frameIndex = this.pb.clip.frames.length - 1;
            this.pb.isPlaying = false;
            const cb = this.pb.onFinish;
            this.pb.onFinish = null;
            if (cb) cb();
          }
        }

        this.copyFrameToBuffer(this.pb.clip.frames[this.pb.frameIndex]);
        if (this.streamingEnabled) this.frameReadyCallback?.(this.frameBuffer);
        this.emitState();
      }
    }

    return this.frameBuffer;
  }

  getFrameBuffer(): Uint8Array {
    return this.frameBuffer;
  }

  /** Force a re-emit of the current frame on the next update() tick. Used by
   *  the transport layer when a send failed (ACK timeout / back-pressure
   *  drop) and the OLED needs to be resynchronised with the preview. */
  markBufferDirty(): void {
    this.bufferDirty = true;
  }

  getState(): EngineState {
    return {
      playbackMode: this.playbackMode,
      currentClipName: this.pb.clip?.name ?? null,
      currentFrameIndex: this.pb.frameIndex,
      totalFrames: this.pb.clip?.frames.length ?? 0,
      isPlaying: this.pb.isPlaying,
      idleSubState: this.idleSubState,
      textContent: this.textContent,
      fps: this.pb.clip?.fps ?? 12,
    };
  }

  getLoadedClipNames(): string[] {
    return Array.from(this.clips.keys());
  }

  playClipDirect(name: string): void {
    if (!this.clips.has(name)) {
      console.warn(`[AnimationEngine] Clip not found: ${name}`);
      return;
    }
    this.cancelIdleTimers();
    this.playbackMode = 'explicit_clip';
    this.playClip(name, {
      loop: false,
      onFinish: () => {
        if (this.clips.has('idle')) this.startIdleOrchestration();
        else this.enterTextMode('SADIK');
        this.emitState();
      },
    });
    this.emitState();
  }

  /** Play a mod animation clip that loops indefinitely until returnToIdle.
   *  When the clip ends it holds the last frame (loop handled by re-starting). */
  playModClip(name: string): void {
    if (!this.clips.has(name)) {
      console.warn(`[AnimationEngine] Mod clip not found: ${name}`);
      return;
    }
    this.cancelIdleTimers();
    this.playbackMode = 'explicit_clip';
    this.playClip(name, { loop: true });
    this.emitState();
  }

  /** Play an intro clip once, then transition into a looping clip.
   *  Used by modes that have a one-shot entry animation followed by a
   *  steady-state text/idle loop (e.g. mod_working → mod_working_text). */
  playModSequence(intro: string, loop: string): void {
    this.playModSequenceWithCallback(intro, loop);
  }

  /**
   * Play an intro clip once, call onIntroFinish when the intro completes,
   * THEN start looping the loop clip.
   * This allows the caller (e.g. acceptInsight) to start a backend timer
   * precisely when the intro ends rather than in parallel.
   */
  /**
   * Play an intro clip once and invoke onFinish when the last frame renders.
   * The engine stays on that last frame until the next showText / event / clip
   * call takes over. Used by voice-accepted break: intro plays, timer starts,
   * then timer_tick's showText seamlessly replaces the held frame with MM:SS.
   */
  playModIntroOnce(intro: string, onFinish?: () => void): void {
    if (!this.clips.has(intro)) {
      console.warn(`[AnimationEngine] Intro clip not found: ${intro}`);
      onFinish?.();
      return;
    }
    this.cancelIdleTimers();
    this.playbackMode = 'explicit_clip';
    this.playClip(intro, {
      loop: false,
      onFinish: () => {
        onFinish?.();
        this.emitState();
      },
    });
    this.emitState();
  }

  playModSequenceWithCallback(intro: string, loop: string, onIntroFinish?: () => void): void {
    if (!this.clips.has(intro)) {
      console.warn(`[AnimationEngine] Intro clip not found: ${intro} — falling back to loop`);
      onIntroFinish?.();
      this.playModClip(loop);
      return;
    }
    if (!this.clips.has(loop)) {
      console.warn(`[AnimationEngine] Loop clip not found: ${loop}`);
      onIntroFinish?.();
      return;
    }
    this.cancelIdleTimers();
    this.playbackMode = 'explicit_clip';
    this.playClip(intro, {
      loop: false,
      onFinish: () => {
        onIntroFinish?.();
        this.playClip(loop, { loop: true });
        this.emitState();
      },
    });
    this.emitState();
  }

  showText(text: string): void {
    this.enterTextMode(text);
    this.emitState();
  }

  /**
   * Engage or disengage focus-look based on whether the app window is focused.
   * direction: mapped clip direction (left/right/down), or null to disengage.
   *
   * Safety: if engine is in explicit_clip or text mode, just stores the state
   * without interrupting. Focus-look re-applies on the next idle re-entry via
   * startIdleOrchestration().
   */
  setFocusLook(direction: 'left' | 'right' | 'down' | null): void {
    if (direction === null) {
      this.focusActive = false;
      // Only resume idle timers if we are actually in focus_look sub-state
      if (this.playbackMode === 'idle' && this.idleSubState === 'focus_look') {
        this.startIdleOrchestration();
      }
      return;
    }

    this.focusActive = true;
    this.focusDirection = direction;

    // Only act immediately when in idle mode; otherwise wait for return_to_idle
    if (this.playbackMode === 'idle') {
      this.enterFocusLook();
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /** Cancel idle timers and play the focus-look clip once; on finish, freeze on last frame. */
  private enterFocusLook(): void {
    if (!this.focusDirection) return;
    const clipName = `idle_alt_look_${this.focusDirection}`;
    if (!this.clips.has(clipName)) {
      console.warn(`[AnimationEngine] focus-look clip not found: ${clipName}`);
      return;
    }
    this.cancelIdleTimers();
    this.idleSubState = 'focus_look';
    this.playClip(clipName, {
      loop: false,
      onFinish: () => {
        // Hold last frame — do not reschedule timers; idleSubState stays 'focus_look'
        // pb.isPlaying is already false at this point (set by update() logic)
        this.idleSubState = 'focus_look';
        this.emitState();
      },
    });
  }

  private enterTextMode(text: string): void {
    this.pb.isPlaying = false;
    this.pb.clip = null;
    this.playbackMode = 'text';
    this.textContent = text;
    this.bufferDirty = true;
  }

  private playClip(name: string, opts: { loop?: boolean; onFinish?: () => void } = {}): void {
    const clip = this.clips.get(name);
    if (!clip) {
      console.warn(`[AnimationEngine] playClip: "${name}" not loaded`);
      return;
    }
    this.pb.clip = clip;
    this.pb.frameIndex = 0;
    this.pb.loop = opts.loop ?? clip.loop;
    this.pb.onFinish = opts.onFinish ?? null;
    this.pb.lastFrameTime = performance.now();
    this.pb.isPlaying = true;

    if (clip.frames.length > 0) {
      this.copyFrameToBuffer(clip.frames[0]);
    }
  }

  private stopClip(): void {
    this.pb.isPlaying = false;
    this.pb.clip = null;
    this.pb.onFinish = null;
  }

  // ─── Idle orchestration — two independent timers ─────────────────────────────
  //
  // Timer 1 (blink):     fires every 12–30 s, plays 'blink' once, returns to idle.
  // Timer 2 (variation): fires every 5–8 min, plays a look clip, returns to idle.
  // Both timers are true setTimeout one-shots; each reschedules itself when done.
  // They never poll inside update() — updateIdleOrchestration only keeps the
  // looping idle clip alive.

  private startIdleOrchestration(): void {
    this.cancelIdleTimers();
    this.playbackMode = 'idle';
    this.idleSubState = 'idle_loop';
    this.idleInitialized = false;
    this.lastVariationDirection = null;
    this.variationPending = false;

    // If focus-look is active, play the look clip and freeze — skip normal timers
    if (this.focusActive && this.focusDirection) {
      this.enterFocusLook();
      return;
    }

    this.scheduleBlink();
    this.scheduleVariation();
  }

  private cancelIdleTimers(): void {
    if (this.blinkTimeout !== null) {
      clearTimeout(this.blinkTimeout);
      this.blinkTimeout = null;
    }
    if (this.variationTimeout !== null) {
      clearTimeout(this.variationTimeout);
      this.variationTimeout = null;
    }
    this.variationPending = false;
  }

  /** Keep the looping idle clip running — called every frame while in idle mode. */
  private updateIdleOrchestration(_timestamp: number): void {
    if (this.idleSubState === 'idle_loop') {
      if (!this.idleInitialized || !this.pb.isPlaying || this.pb.clip?.name !== 'idle') {
        this.playClip('idle', { loop: true });
        this.idleInitialized = true;
      }
    }
    // 'focus_look': last frame held, pb.isPlaying=false — do not reinitialise idle loop
    // 'blink' and 'variation' sub-states are driven entirely by onFinish callbacks
  }

  // ── Blink timer ───────────────────────────────────────────────────────────────

  private scheduleBlink(): void {
    // Fresh random interval each cycle: 12–30 seconds
    const interval = 12000 + Math.random() * 18000;
    this.blinkTimeout = setTimeout(() => this.fireBlink(), interval);
  }

  private fireBlink(): void {
    this.blinkTimeout = null;

    // Collision: variation is playing — don't interrupt, skip this blink entirely
    // and let the next scheduled blink handle it.
    if (this.idleSubState === 'variation') {
      this.scheduleBlink();
      return;
    }

    if (!this.clips.has('blink')) {
      this.scheduleBlink();
      return;
    }

    this.idleSubState = 'blink';
    this.playClip('blink', {
      loop: false,
      onFinish: () => {
        this.idleSubState = 'idle_loop';
        this.idleInitialized = false;
        this.scheduleBlink();

        // Collision: variation was deferred while this blink played — fire it now
        if (this.variationPending) {
          this.variationPending = false;
          this.fireVariation();
        }
      },
    });
  }

  // ── Variation timer ───────────────────────────────────────────────────────────

  private scheduleVariation(): void {
    // Fresh random interval each cycle: 5–8 minutes (300 000–480 000 ms)
    const interval = 300000 + Math.random() * 180000;
    this.variationTimeout = setTimeout(() => this.fireVariation(), interval);
  }

  private fireVariation(): void {
    this.variationTimeout = null;

    // Collision: blink is playing — defer until blink's onFinish runs
    if (this.idleSubState === 'blink') {
      this.variationPending = true;
      return;
    }

    // Pick a direction; never repeat the same direction consecutively
    let dir: 'left' | 'right' = Math.random() < 0.5 ? 'left' : 'right';
    if (dir === this.lastVariationDirection) {
      dir = dir === 'left' ? 'right' : 'left';
    }

    const clipName = dir === 'left' ? 'idle_alt_look_left' : 'idle_alt_look_right';

    if (!this.clips.has(clipName)) {
      // Clip not loaded — skip silently and reschedule
      this.scheduleVariation();
      return;
    }

    this.lastVariationDirection = dir;
    this.idleSubState = 'variation';
    this.playClip(clipName, {
      loop: false,
      onFinish: () => {
        this.idleSubState = 'idle_loop';
        this.idleInitialized = false;
        this.scheduleVariation();
      },
    });
  }

  // ─── Buffer helpers ───────────────────────────────────────────────────────────

  private clearBuffer(): void {
    this.frameBuffer.fill(0);
  }

  private copyFrameToBuffer(frame: number[]): void {
    const len = Math.min(frame.length, BUFFER_SIZE);
    for (let i = 0; i < len; i++) this.frameBuffer[i] = frame[i];
    if (len < BUFFER_SIZE) this.frameBuffer.fill(0, len);
  }

  // ─── Device command ───────────────────────────────────────────────────────────

  private sendCommand(cmd: string): void {
    const now = performance.now();
    if (this.commandTimeout) clearTimeout(this.commandTimeout);

    if (now - this.lastCommandTime >= 100) {
      this.lastCommandTime = now;
      this.deviceCommandCallback?.(cmd);
    } else {
      this.pendingCommand = cmd;
      this.commandTimeout = setTimeout(() => {
        if (this.pendingCommand) {
          this.lastCommandTime = performance.now();
          this.deviceCommandCallback?.(this.pendingCommand);
          this.pendingCommand = null;
        }
      }, 100);
    }
  }

  private emitState(): void {
    this.stateChangeCallback?.(this.getState());
  }
}

// Module-level singleton
let _instance: AnimationEngine | null = null;
export function getAnimationEngine(): AnimationEngine {
  if (!_instance) _instance = new AnimationEngine();
  return _instance;
}
