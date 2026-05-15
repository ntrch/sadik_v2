/**
 * voiceLiveService — SADIK Voice V2 WebSocket client (T9.5.6)
 *
 * Connects to /api/voice/live (Gemini Live proxy) and handles:
 *   - Full WS lifecycle (connect, send, receive, disconnect)
 *   - 24 kHz PCM audio playback via Web Audio API
 *   - Wire protocol matching voice.py _live_send_loop / _live_receive_loop
 *
 * ── COST DISCIPLINE (mandatory — see memory/feedback_voice_cost_discipline.md) ──
 *   1. connect() is called ONLY from wakeword detection or mic-tap. Never auto-called.
 *   2. No cold session: never open WS on component mount or effect.
 *   3. Only VAD speech-active PCM goes to the API via pipeMicChunk(). Silence = no send.
 *   4. Continuous mode: after turn_complete WS stays open but caller suspends mic pipe.
 *   5. Wakeword false-positive guard: 2s grace handled by VoiceAssistant (caller).
 *   6. Idle timeout (8s) is the backend safety net, not primary defence.
 *   7. No automatic reconnect after error: caller re-triggers on next wakeword/tap.
 */

const WS_BASE = 'ws://127.0.0.1:8000';
const VOICE_NAME = 'Charon'; // Hardcoded — no voice picker (T9.5.6 decision)
const SAMPLE_RATE_IN  = 16000;  // PCM from mic
const SAMPLE_RATE_OUT = 24000;  // PCM from Gemini

export type ToolResult = {
  tool_name: string;
  status: 'ok' | 'error';
  data: Record<string, unknown> | null;
  error: string | null;
};

export type VoiceLiveCallbacks = {
  onReady:       () => void;
  onAudio:       (pcm24k: Int16Array) => void;
  onTranscript:  (text: string, finished: boolean) => void;
  onTurnComplete: () => void;
  onToolResult:  (result: ToolResult) => void;
  onError:       (detail: string) => void;
  onClose:       () => void;
};

export class VoiceLiveService {
  private ws: WebSocket | null = null;
  private callbacks: VoiceLiveCallbacks | null = null;
  private audioCtx: AudioContext | null = null;
  // Playback queue: each item is a 24kHz Int16Array chunk waiting to play.
  // We schedule chunks sequentially by chaining AudioBufferSourceNode.onended.
  private playbackQueue: Int16Array[] = [];
  private isPlayingAudio = false;
  private triggerSource: 'wakeword' | 'mic_tap' = 'wakeword';

  /**
   * Open a new Gemini Live WS session.
   * Must only be called on wakeword detection or mic-tap — never speculatively.
   */
  connect(triggerSource: 'wakeword' | 'mic_tap', callbacks: VoiceLiveCallbacks): void {
    if (this.ws) {
      console.warn('[VoiceLive] connect() called while already connected — disconnecting first');
      this._forceClose();
    }

    this.triggerSource = triggerSource;
    this.callbacks = callbacks;
    this.playbackQueue = [];
    this.isPlayingAudio = false;

    const url = `${WS_BASE}/api/voice/live?voice=${VOICE_NAME}`;
    console.log(`[VoiceLive] Opening WS (trigger=${triggerSource}): ${url}`);

    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      console.log('[VoiceLive] WS open');
      // Send wake timestamp immediately for latency telemetry
      this._send({ type: 'wake_ts', ts: performance.now() / 1000 });
    };

    this.ws.onmessage = (ev: MessageEvent) => {
      this._handleMessage(ev);
    };

    this.ws.onerror = (e) => {
      console.error('[VoiceLive] WS error', e);
      this.callbacks?.onError('WebSocket bağlantı hatası');
    };

    this.ws.onclose = (ev) => {
      console.log(`[VoiceLive] WS closed code=${ev.code} reason=${ev.reason}`);
      this._teardown();
      this.callbacks?.onClose();
    };
  }

  /**
   * Send a 16kHz int16 mono PCM chunk to Gemini.
   * Only call while VAD speech is active (caller gates this).
   */
  pipeMicChunk(pcm16k: Int16Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const bytes = new Uint8Array(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength);
    const b64 = this._toBase64(bytes);
    this._send({ type: 'audio', data: b64 });
  }

  /**
   * Signal end of turn — call after VAD onSpeechEnd (+hangover).
   */
  signalEndOfTurn(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    console.log('[VoiceLive] signalEndOfTurn');
    this._send({ type: 'end_of_turn' });
  }

  /**
   * Graceful disconnect (code 1000). Stops playback and tears down.
   */
  disconnect(): void {
    if (!this.ws) return;
    console.log('[VoiceLive] disconnect (graceful)');
    this._stopPlayback();
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close(1000, 'client_disconnect');
    }
    // onclose will call _teardown + callbacks.onClose
  }

  /** True if WS is open. */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _handleMessage(ev: MessageEvent): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(ev.data as string) as Record<string, unknown>;
    } catch {
      console.warn('[VoiceLive] Non-JSON message ignored');
      return;
    }

    const type = msg['type'] as string;

    switch (type) {
      case 'ready':
        console.log('[VoiceLive] session ready');
        this.callbacks?.onReady();
        break;

      case 'audio': {
        const b64 = msg['data'] as string;
        const bytes = this._fromBase64(b64);
        // bytes are raw 16-bit LE PCM @ 24kHz
        const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
        this.callbacks?.onAudio(pcm);
        this._enqueueAudio(pcm);
        break;
      }

      case 'transcript':
        this.callbacks?.onTranscript(
          msg['text'] as string,
          Boolean(msg['finished']),
        );
        break;

      case 'turn_complete':
        console.log('[VoiceLive] turn_complete');
        this.callbacks?.onTurnComplete();
        break;

      case 'tool_result':
        console.log('[VoiceLive] tool_result', msg['tool_name'], msg['status']);
        this.callbacks?.onToolResult({
          tool_name: msg['tool_name'] as string,
          status:    msg['status'] as 'ok' | 'error',
          data:      (msg['data'] as Record<string, unknown>) ?? null,
          error:     (msg['error'] as string) ?? null,
        });
        break;

      case 'error':
        console.error('[VoiceLive] server error:', msg['detail']);
        this.callbacks?.onError(msg['detail'] as string ?? 'Sunucu hatası');
        break;

      case 'latency':
        // Telemetry-only — log and ignore
        console.debug('[VoiceLive] latency telemetry:', msg);
        break;

      default:
        console.warn('[VoiceLive] Unknown server message type:', type);
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
    // Copy so we own the memory (Int16Array view may be on a shared buffer)
    this.playbackQueue.push(new Int16Array(pcm));
    if (!this.isPlayingAudio) {
      this._drainQueue();
    }
  }

  private _drainQueue(): void {
    if (this.playbackQueue.length === 0) {
      this.isPlayingAudio = false;
      return;
    }

    this.isPlayingAudio = true;
    const chunk = this.playbackQueue.shift()!;
    const ctx   = this._ensureAudioCtx();

    // Convert int16 → float32 (Web Audio expects float32 in [-1, 1])
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

  private _stopPlayback(): void {
    this.playbackQueue = [];
    this.isPlayingAudio = false;
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

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
  }

  private _teardown(): void {
    this._stopPlayback();
    this.ws = null;
    this.callbacks = null;
  }

  private _toBase64(bytes: Uint8Array): string {
    let bin = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  }

  private _fromBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }

  /** Expose sample rates for callers that need to know. */
  static readonly MIC_RATE    = SAMPLE_RATE_IN;
  static readonly PLAYBACK_RATE = SAMPLE_RATE_OUT;
}

export const voiceLiveService = new VoiceLiveService();
