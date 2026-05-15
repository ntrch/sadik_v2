/**
 * narrationService — Tool result narration via /api/voice/narrate (T9.5.7)
 *
 * Opens a short-lived WebSocket to /api/voice/narrate after a tool_result
 * event.  The backend opens a TTS-mode Gemini Live mini-session and streams
 * 24 kHz PCM audio back.  This is entirely separate from the main /api/voice/live
 * session — no overlap, no shared state.
 *
 * COST DISCIPLINE: speak() is called ONLY from onToolResult callback, which fires
 * only after the user's bilinçli komut has been processed.  No cold opens.
 *
 * Audio playback reuses the same Int16 → Float32 → Web Audio pattern as
 * VoiceLiveService._enqueueAudio.
 */

const WS_BASE = 'ws://127.0.0.1:8000';
const SAMPLE_RATE_OUT = 24000;

export type NarrationCallbacks = {
  /** Called when Gemini sends the first audio chunk (state → speaking) */
  onFirstAudio?: () => void;
  /** Called after all audio has finished playing (state → idle) */
  onDone?: () => void;
  /** Called on error */
  onError?: (detail: string) => void;
};

class NarrationService {
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private playbackQueue: Int16Array[] = [];
  private isPlayingAudio = false;
  private firstAudioFired = false;
  private callbacks: NarrationCallbacks | null = null;
  // Resolved once playback queue drains
  private playbackIdleResolve: (() => void) | null = null;

  /**
   * Open narration mini-session and play TTS audio for `text`.
   * Resolves when audio has finished playing and WS is closed.
   *
   * Only call from onToolResult (cost discipline ✓).
   */
  speak(text: string, callbacks?: NarrationCallbacks): void {
    if (this.ws) {
      console.warn('[Narration] speak() called while already active — force-closing previous');
      this._forceClose();
    }

    this.callbacks = callbacks ?? null;
    this.playbackQueue = [];
    this.isPlayingAudio = false;
    this.firstAudioFired = false;

    const url = `${WS_BASE}/api/voice/narrate?voice=Charon`;
    console.log('[Narration] Opening WS:', url);

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[Narration] WS open — sending narrate request');
      this._send({ type: 'narrate', text });
    };

    this.ws.onmessage = (ev: MessageEvent) => {
      this._handleMessage(ev);
    };

    this.ws.onerror = (e) => {
      console.error('[Narration] WS error', e);
      this.callbacks?.onError?.('Narration WebSocket hatası');
      this._teardown();
    };

    this.ws.onclose = (ev) => {
      if (ev.code === 1000) {
        console.log('[Narration] WS closed gracefully');
      } else {
        console.warn(`[Narration] WS closed code=${ev.code}`);
      }
      // If there's still audio queued, let it drain before firing onDone.
      // _drainQueue will fire onDone when queue empties.
      if (!this.isPlayingAudio && this.playbackQueue.length === 0) {
        this._fireOnDone();
      }
      // ws ref cleared; playback continues from existing queue via AudioContext
      this.ws = null;
    };
  }

  /** Force-stop narration (e.g. user cancels) */
  stop(): void {
    console.log('[Narration] stop()');
    this._forceClose();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _handleMessage(ev: MessageEvent): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(ev.data as string) as Record<string, unknown>;
    } catch {
      console.warn('[Narration] Non-JSON message ignored');
      return;
    }

    const type = msg['type'] as string;

    switch (type) {
      case 'ready':
        console.log('[Narration] session ready — awaiting audio');
        break;

      case 'audio': {
        const b64 = msg['data'] as string;
        const bytes = this._fromBase64(b64);
        const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
        if (!this.firstAudioFired) {
          this.firstAudioFired = true;
          this.callbacks?.onFirstAudio?.();
        }
        this._enqueueAudio(new Int16Array(pcm));
        break;
      }

      case 'turn_complete':
        // Server is about to close. Audio may still be queued — drain handles onDone.
        console.log('[Narration] turn_complete from server');
        break;

      case 'error':
        console.error('[Narration] server error:', msg['detail']);
        this.callbacks?.onError?.(msg['detail'] as string ?? 'Narration sunucu hatası');
        this._teardown();
        break;

      default:
        console.warn('[Narration] Unknown message type:', type);
    }
  }

  // ── Audio playback (Web Audio API, 24kHz PCM) ──────────────────────────────

  private _ensureAudioCtx(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE_OUT });
    }
    return this.audioCtx;
  }

  private _enqueueAudio(pcm: Int16Array): void {
    this.playbackQueue.push(pcm);
    if (!this.isPlayingAudio) {
      this._drainQueue();
    }
  }

  private _drainQueue(): void {
    if (this.playbackQueue.length === 0) {
      this.isPlayingAudio = false;
      if (this.playbackIdleResolve) {
        const r = this.playbackIdleResolve;
        this.playbackIdleResolve = null;
        r();
      }
      // WS already closed (turn_complete path) → fire onDone
      if (!this.ws) {
        this._fireOnDone();
      }
      return;
    }

    this.isPlayingAudio = true;
    const chunk = this.playbackQueue.shift()!;
    const ctx = this._ensureAudioCtx();

    const float32 = new Float32Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      float32[i] = chunk[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE_OUT);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      this._drainQueue();
    };
    source.start();
  }

  private _fireOnDone(): void {
    const cb = this.callbacks?.onDone;
    this.callbacks = null;
    if (cb) cb();
  }

  private _stopPlayback(): void {
    this.playbackQueue = [];
    this.isPlayingAudio = false;
    if (this.playbackIdleResolve) {
      const r = this.playbackIdleResolve;
      this.playbackIdleResolve = null;
      r();
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  private _send(obj: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  private _forceClose(): void {
    this._stopPlayback();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.callbacks = null;
  }

  private _teardown(): void {
    this._stopPlayback();
    this.ws = null;
    this.callbacks = null;
  }

  private _fromBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }
}

export const narrationService = new NarrationService();
