import {
  ClipManifestEntry,
  ClipData,
  PlaybackMode,
  IdleSubState,
  EngineState,
  AnimationEventType,
} from './types';
import { EVENT_TO_CLIP, LOOPING_EVENT_CLIPS, AUTO_RETURN_CLIPS, EVENT_DISPLAY_TEXT } from './eventMapping';
import { USE_CODEC_PREVIEW } from './codecConfig';
import { decodeBin } from '../codec/SadikDecoder';

const FRAME_W = 160;
const FRAME_H = 128;
const FRAME_BYTES = FRAME_W * FRAME_H * 2; // 40960 bytes RGB565 LE

interface PlaybackState {
  clip: ClipData | null;
  frameIndex: number;
  loop: boolean;
  onFinish: (() => void) | null;
  lastFrameTime: number;
  isPlaying: boolean;
}

/** Decode an mp4 URL into an array of RGB565 LE frames (each FRAME_BYTES bytes).
 *  Uses a hidden <video> element + OffscreenCanvas stepped via currentTime. */
async function decodeMp4ToRgb565Frames(
  url: string,
  w: number,
  h: number,
  fps: number,
): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.preload = 'auto';
    video.style.display = 'none';
    document.body.appendChild(video);

    const cleanup = () => {
      document.body.removeChild(video);
      URL.revokeObjectURL(url);
    };

    video.addEventListener('error', () => {
      cleanup();
      reject(new Error(`Video load error: ${url}`));
    });

    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        cleanup();
        reject(new Error(`Bad video duration: ${duration}`));
        return;
      }

      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      const frameInterval = 1 / fps;
      const frameCount = Math.max(1, Math.round(duration * fps));
      const frames: Uint8Array[] = [];
      let frameIdx = 0;

      const seekNext = () => {
        if (frameIdx >= frameCount) {
          cleanup();
          resolve(frames);
          return;
        }
        const t = frameIdx * frameInterval;
        video.currentTime = Math.min(t, duration - 0.001);
      };

      const onSeeked = () => {
        ctx.drawImage(video, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const rgba = imgData.data;
        const rgb565 = new Uint8Array(FRAME_BYTES);
        for (let i = 0; i < w * h; i++) {
          const r = rgba[i * 4];
          const g = rgba[i * 4 + 1];
          const b = rgba[i * 4 + 2];
          // RGB565 LE: low byte first
          const pixel = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
          rgb565[i * 2]     = pixel & 0xFF;
          rgb565[i * 2 + 1] = (pixel >> 8) & 0xFF;
        }
        frames.push(rgb565);
        frameIdx++;
        seekNext();
      };

      video.addEventListener('seeked', onSeeked);
      seekNext();
    });
  });
}

/** Render text onto a 160×128 RGB565 LE buffer (white on black). */
function renderTextToRgb565(text: string): Uint8Array {
  const canvas = new OffscreenCanvas(FRAME_W, FRAME_H);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  ctx.fillStyle = '#ffffff';

  const lines = text.split('\n');
  // Auto-size: find largest font that fits all lines
  let fontSize = 32;
  for (let s = 48; s >= 8; s -= 2) {
    ctx.font = `bold ${s}px monospace`;
    const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const totalH = lines.length * s * 1.2;
    if (maxW <= FRAME_W - 8 && totalH <= FRAME_H - 8) {
      fontSize = s;
      break;
    }
  }
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lineH = fontSize * 1.2;
  const totalH = lines.length * lineH;
  const startY = (FRAME_H - totalH) / 2 + lineH / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, FRAME_W / 2, startY + i * lineH);
  });

  const imgData = ctx.getImageData(0, 0, FRAME_W, FRAME_H);
  const rgba = imgData.data;
  const rgb565 = new Uint8Array(FRAME_BYTES);
  for (let i = 0; i < FRAME_W * FRAME_H; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const pixel = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
    rgb565[i * 2]     = pixel & 0xFF;
    rgb565[i * 2 + 1] = (pixel >> 8) & 0xFF;
  }
  return rgb565;
}

/**
 * Load a .bin codec clip from a URL and decode it into an array of RGB565 LE
 * frames (Uint8Array, FRAME_BYTES each) — same format as decodeMp4ToRgb565Frames.
 *
 * SadikDecoder.decodeBin() returns Uint16Array[] (RGB565 pixels, LE).
 * We reinterpret each Uint16Array as a Uint8Array view — the bytes are identical;
 * no pixel conversion occurs.  OledPreview already reads the buffer as LE bytes.
 */
async function loadCodecClip(url: string): Promise<Uint8Array[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading codec: ${url}`);
  const arrayBuf = await res.arrayBuffer();
  const u8 = new Uint8Array(arrayBuf);
  const frames16 = decodeBin(u8);
  // Reinterpret: Uint16Array backing bytes are already RGB565 LE — same as mp4 path.
  return frames16.map((f) => new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
}

export class AnimationEngine {
  private clips: Map<string, ClipData> = new Map();
  private frameBuffer: Uint8Array = new Uint8Array(FRAME_BYTES);
  private bufferDirty = true;
  private lastTextEmitTime = 0;

  private playbackMode: PlaybackMode = 'black'; // stays black until idle is decoded
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

  private idleInitialized = false;
  private blinkTimeout: ReturnType<typeof setTimeout> | null = null;
  private variationTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastVariationDirection: 'left' | 'right' | null = null;
  private variationPending = false;

  private deviceCommandCallback: ((cmd: string) => void) | null = null;
  private stateChangeCallback: ((state: EngineState) => void) | null = null;
  private frameReadyCallback: ((buffer: Uint8Array) => void) | null = null;

  private lastCommandTime = 0;
  private pendingCommand: string | null = null;
  private commandTimeout: ReturnType<typeof setTimeout> | null = null;

  private streamingEnabled = true;

  private focusActive: boolean = false;
  private focusDirection: 'left' | 'right' | 'down' | null = null;

  constructor() {
    this.frameBuffer.fill(0);
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

      const loadClipEntry = async (entry: ClipManifestEntry) => {
        try {
          let frames: Uint8Array[];

          if (USE_CODEC_PREVIEW && entry.codecSource) {
            // Codec path: fetch .bin → decode → Uint8Array[] (RGB565 LE bytes)
            const binUrl = `${base}/${entry.codecSource}`;
            console.log(`[AnimationEngine] codec load: ${entry.name} (${entry.codecSource})`);
            frames = await loadCodecClip(binUrl);
          } else {
            // Mp4 fallback: video element → OffscreenCanvas → RGB565
            const r = await fetch(`${base}/${entry.source}`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            frames = await decodeMp4ToRgb565Frames(
              url,
              entry.width ?? FRAME_W,
              entry.height ?? FRAME_H,
              entry.fps ?? 12,
            );
          }

          const clip: ClipData = {
            name: entry.name,
            width: entry.width ?? FRAME_W,
            height: entry.height ?? FRAME_H,
            frameCount: frames.length,
            frames,
            fps: entry.fps ?? 12,
            loop: entry.loop ?? false,
          };
          this.clips.set(entry.name, clip);
        } catch (e) {
          console.warn(`[AnimationEngine] Failed to load clip "${entry.name}":`, e);
        }
      };

      // Load idle first so we can start playing before the rest are decoded.
      const idleEntry = manifest.find((e) => e.name === 'idle');
      const restEntries = manifest.filter((e) => e.name !== 'idle');

      if (idleEntry) {
        await loadClipEntry(idleEntry);
        this.startIdleOrchestration(); // idle is ready — start immediately
        this.emitState();
        // Decode remaining clips in the background; no await here.
        Promise.all(restEntries.map(loadClipEntry)).then(() => {
          console.log(`[AnimationEngine] Loaded ${this.clips.size} clips`);
        });
        return; // emitState already called above
      }

      // No idle entry — load everything and fall back to text.
      await Promise.all(manifest.map(loadClipEntry));
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
      const displayText = EVENT_DISPLAY_TEXT[event] ?? event.toUpperCase();
      this.enterTextMode(displayText);
    }
    this.emitState();
  }

  update(timestamp: number): Uint8Array {
    // During initial clip load: emit a single black frame then go quiet.
    if (this.playbackMode === 'black') {
      if (this.bufferDirty) {
        this.frameBuffer.fill(0);
        this.bufferDirty = false;
        if (this.streamingEnabled) this.frameReadyCallback?.(this.frameBuffer);
      }
      return this.frameBuffer;
    }

    if (this.playbackMode === 'text') {
      if (this.bufferDirty) {
        this.frameBuffer = renderTextToRgb565(this.textContent);
        this.bufferDirty = false;
        this.lastTextEmitTime = 0;
      }
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

        this.frameBuffer = this.pb.clip.frames[this.pb.frameIndex];
        if (this.streamingEnabled) this.frameReadyCallback?.(this.frameBuffer);
        this.emitState();
      }
    }

    return this.frameBuffer;
  }

  getFrameBuffer(): Uint8Array {
    return this.frameBuffer;
  }

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
      isLooping: this.pb.loop,
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

  playModSequence(intro: string, loop: string): void {
    this.playModSequenceWithCallback(intro, loop);
  }

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

  setFocusLook(direction: 'left' | 'right' | 'down' | null): void {
    if (direction === null) {
      this.focusActive = false;
      if (this.playbackMode === 'idle' && this.idleSubState === 'focus_look') {
        this.startIdleOrchestration();
      }
      return;
    }

    this.focusActive = true;
    this.focusDirection = direction;

    if (this.playbackMode === 'idle') {
      this.enterFocusLook();
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

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
      this.frameBuffer = clip.frames[0];
    }
  }

  private stopClip(): void {
    this.pb.isPlaying = false;
    this.pb.clip = null;
    this.pb.onFinish = null;
  }

  private startIdleOrchestration(): void {
    this.cancelIdleTimers();
    this.playbackMode = 'idle';
    this.idleSubState = 'idle_loop';
    this.idleInitialized = false;
    this.lastVariationDirection = null;
    this.variationPending = false;

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

  private updateIdleOrchestration(_timestamp: number): void {
    if (this.idleSubState === 'idle_loop') {
      if (!this.idleInitialized || !this.pb.isPlaying || this.pb.clip?.name !== 'idle') {
        this.playClip('idle', { loop: true });
        this.idleInitialized = true;
      }
    }
  }

  private scheduleBlink(): void {
    const interval = 12000 + Math.random() * 18000;
    this.blinkTimeout = setTimeout(() => this.fireBlink(), interval);
  }

  private fireBlink(): void {
    this.blinkTimeout = null;

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

        if (this.variationPending) {
          this.variationPending = false;
          this.fireVariation();
        }
      },
    });
  }

  private scheduleVariation(): void {
    const interval = 300000 + Math.random() * 180000;
    this.variationTimeout = setTimeout(() => this.fireVariation(), interval);
  }

  private fireVariation(): void {
    this.variationTimeout = null;

    if (this.idleSubState === 'blink') {
      this.variationPending = true;
      return;
    }

    let dir: 'left' | 'right' = Math.random() < 0.5 ? 'left' : 'right';
    if (dir === this.lastVariationDirection) {
      dir = dir === 'left' ? 'right' : 'left';
    }

    const clipName = dir === 'left' ? 'idle_alt_look_left' : 'idle_alt_look_right';

    if (!this.clips.has(clipName)) {
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

let _instance: AnimationEngine | null = null;
export function getAnimationEngine(): AnimationEngine {
  if (!_instance) _instance = new AnimationEngine();
  return _instance;
}
