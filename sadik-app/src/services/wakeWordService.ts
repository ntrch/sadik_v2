// =============================================================================
// Wake Word Detection Service
//
// Continuously records 3-second audio chunks and sends each to the Whisper
// STT endpoint.  If any recognised wake-word appears in the transcript the
// registered callback fires and recording pauses (COOLDOWN_MS) to prevent
// double-triggering during the active voice turn.
//
// Key design decisions
//   • Generation counter — prevents stale onstop callbacks from interfering
//     when stop() / start() are called in quick succession.
//   • Turkish text normalisation — Whisper may return different Unicode forms
//     of Turkish characters; we normalise both sides before comparing.
//   • MIME-type fallback chain — picks the best format the browser supports.
//   • Silent error swallowing — network / timeout errors keep the loop alive.
// =============================================================================

import axios from 'axios';

// ── Configuration ─────────────────────────────────────────────────────────────

const CHUNK_DURATION_MS = 1500;   // length of each recorded chunk
const COOLDOWN_MS       = 6000;   // silence after a detection
const STT_TIMEOUT_MS    = 12000;  // per-request Whisper timeout

// Whisper prompt — biases the model toward the expected vocabulary so short
// audio chunks with just the wake word are recognised reliably.
const WAKE_WORD_PROMPT = "Sadık. Hey Sadık. Sadık'a sesleniyorum. Bu ses kaydında Sadık ismi geçiyor olabilir.";

// ── MIME-type helper ──────────────────────────────────────────────────────────

function getSupportedMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return '';
}

function mimeToExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'mp4';
  return 'webm'; // default — Whisper handles webm/opus well
}

// ── Text normalisation & wake-word matching ───────────────────────────────────

/**
 * Fold all Turkish-specific characters to their ASCII equivalents and
 * lower-case the result so we can do reliable substring matching even when
 * Whisper returns mixed-case or different Unicode normalisation forms.
 */
function normalizeTR(text: string): string {
  return text
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/İ/gi, 'i')
    .replace(/ş/g, 's')
    .replace(/Ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'c')
    .trim();
}

// Both the wake-word list and incoming transcripts are normalised before
// comparison, so we only need the ASCII-folded forms here.
// All Turkish chars are already folded by normalizeTR, so only ASCII variants
// are needed.  The list is intentionally wide to cover Whisper transcription
// drift (spacing, phonetic substitutions, spelling variants).
const WAKE_WORDS_NORMALIZED: string[] = [
  // ── Core name variants ──────────────────────────────────────────────────
  'sadik',        // sadık — primary
  'saddik',       // saddık — double-d variant
  'sadiq',        // sadıq — q instead of k (some locales)
  'sadk',         // compressed, no vowel
  'satik',        // satık — t/d confusion
  'sadic',        // c instead of k
  'sadick',       // with trailing k
  'sadig',        // voiced final consonant
  'sadigh',       // gh variant
  // ── Whisper space-insertion variants ───────────────────────────────────
  'sa dik',       // Whisper splits the word with a space
  'sa diq',
  // ── Greeting prefixes ──────────────────────────────────────────────────
  'hey sadik',
  'hey saddik',
  'merhaba sadik',
  'selam sadik',
  'selam saddik',
  'ey sadik',
  // ── Command suffixes (original set) ────────────────────────────────────
  'sadik bey',
  'sadikcigim',   // "sadıkçığım"
  'sadik gel',
  'sadik dinle',
  // ── Log-derived variants (Whisper observed outputs) ─────────────────────
  'sadikcam',     // "Sadıkçam" — Whisper collapses suffix onto name
  'sadigim',      // "Sadığım" — voiced g + possessive (not covered by 'sadik')
  'sadika',       // "Sadık'a" — dative without apostrophe
];

function containsWakeWord(transcript: string): boolean {
  const norm = normalizeTR(transcript);
  console.log('[WakeWord] Normalized transcript:', norm);
  return WAKE_WORDS_NORMALIZED.some((w) => norm.includes(w));
}

// ── Service class ─────────────────────────────────────────────────────────────

export class WakeWordService {
  private active       = false;
  private inCooldown   = false;
  private generation   = 0;   // incremented on every start/stop to cancel stale callbacks
  private _sensitivity = 'normal';

  private stream:    MediaStream   | null = null;
  private recorder:  MediaRecorder | null = null;
  private chunks:    Blob[]               = [];

  private onDetected:  (() => void)                  | null = null;
  private onError:     ((msg: string) => void)       | null = null;
  private onListening: ((active: boolean) => void)   | null = null;

  // ── Sensitivity → energy threshold mapping ────────────────────────────────

  private _getEnergyThreshold(): number {
    switch (this._sensitivity) {
      case 'very_high': return 0.002;
      case 'high':      return 0.005;
      case 'low':       return 0.015;
      case 'normal':
      default:          return 0.008;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Start the detection loop.
   * Safe to call even if already active — it will return immediately.
   *
   * @param onDetected   Called once per detection (before cooldown starts).
   * @param onError      Called on unrecoverable mic / permission errors.
   * @param onListening  Called with `true` when recording, `false` during
   *                     cooldown or after stop().
   */
  async start(
    onDetected:   () => void,
    onError?:     (msg: string) => void,
    onListening?: (active: boolean) => void,
  ): Promise<void> {
    if (this.active) return;

    this.onDetected  = onDetected;
    this.onError     = onError  ?? null;
    this.onListening = onListening ?? null;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.onError?.('Mikrofon erişimi reddedildi');
      return;
    }

    this.active = true;
    this.generation++;
    console.log('[WakeWord] Service started (gen', this.generation, ')');
    this._recordChunk(this.generation);
  }

  /** Stop detection and release the microphone. */
  stop(): void {
    if (!this.active && this.stream === null) return;
    this.active = false;
    this.generation++;   // invalidate all in-flight callbacks
    this._stopRecorder();
    this._releaseStream();
    this.onListening?.(false);
    console.log('[WakeWord] Service stopped');
  }

  isActive(): boolean {
    return this.active;
  }

  /** Update the energy gate threshold. Safe to call while the service is running. */
  setSensitivity(level: string): void {
    this._sensitivity = level;
    console.log('[WakeWord] Sensitivity set to:', level, '— threshold:', this._getEnergyThreshold());
  }

  // ── Internal recording loop ───────────────────────────────────────────────────

  private _recordChunk(gen: number): void {
    if (!this.active || !this.stream || this.inCooldown || gen !== this.generation) return;

    // If the stream tracks ended (e.g. user unplugged mic), re-acquire.
    if (this.stream.getTracks().some((t) => t.readyState === 'ended')) {
      this._releaseStream();
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((s) => {
          if (gen !== this.generation) { s.getTracks().forEach((t) => t.stop()); return; }
          this.stream = s;
          this._recordChunk(gen);
        })
        .catch(() => {
          if (gen !== this.generation) return;
          this.onError?.('Mikrofon bağlantısı kesildi');
          this.active = false;
        });
      return;
    }

    const mimeType = getSupportedMimeType();
    this.chunks = [];

    try {
      this.recorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream);
    } catch (e) {
      console.error('[WakeWord] MediaRecorder init error:', e);
      this.active = false;
      return;
    }

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.recorder.onstop = async () => {
      // Guard against stale callbacks after stop()/start() cycles.
      if (!this.active || gen !== this.generation) return;

      const blob = new Blob(this.chunks, {
        type: this.recorder?.mimeType || mimeType || 'audio/webm',
      });
      await this._processChunk(blob, gen);

      if (this.active && !this.inCooldown && gen === this.generation) {
        this._recordChunk(gen);
      }
    };

    this.recorder.start();
    this.onListening?.(true);
    console.log('[WakeWord] Recording chunk...');

    // Auto-stop after the chunk duration.
    setTimeout(() => {
      if (this.recorder && this.recorder.state === 'recording') {
        this.recorder.stop();
      }
    }, CHUNK_DURATION_MS);
  }

  private async _hasAudioEnergy(blob: Blob): Promise<boolean> {
    try {
      const arrayBuffer  = await blob.arrayBuffer();
      const audioContext = new AudioContext();
      try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const data        = audioBuffer.getChannelData(0);
        let sumOfSquares  = 0;
        for (let i = 0; i < data.length; i++) {
          sumOfSquares += data[i] * data[i];
        }
        const rms       = Math.sqrt(sumOfSquares / data.length);
        const threshold = this._getEnergyThreshold();
        console.log('[WakeWord] Audio RMS energy:', rms.toFixed(4), '— sensitivity:', this._sensitivity, '— threshold:', threshold);
        return rms >= threshold;
      } finally {
        await audioContext.close();
      }
    } catch {
      return true;  // energy check failed — proceed with STT as fallback
    }
  }

  private async _processChunk(blob: Blob, gen: number): Promise<void> {
    if (!this.active || gen !== this.generation) return;

    // Energy gate: skip silent chunks to avoid unnecessary STT calls.
    const hasEnergy = await this._hasAudioEnergy(blob);
    if (!hasEnergy) {
      console.log('[WakeWord] Silent chunk, skipping STT');
      return;
    }

    // Re-check generation after the async energy check.
    if (!this.active || gen !== this.generation) return;

    const actualMime = this.recorder?.mimeType || blob.type || 'audio/webm';
    const ext        = mimeToExtension(actualMime);
    const formData   = new FormData();
    formData.append('audio', blob, `wake.${ext}`);
    formData.append('prompt', WAKE_WORD_PROMPT);

    console.log('[WakeWord] Sending to STT... (size:', blob.size, 'bytes, type:', actualMime, ')');

    try {
      const res = await axios.post<{ text: string }>(
        'http://localhost:8000/api/voice/stt',
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: STT_TIMEOUT_MS,
        },
      );

      const text = res.data?.text ?? '';
      console.log('[WakeWord] STT result:', JSON.stringify(text));

      if (gen !== this.generation || !this.active) return;

      if (text) {
        console.log('[WakeWord] Checking for wake words in:', normalizeTR(text));
        if (containsWakeWord(text)) {
          console.log('[WakeWord] DETECTED!');
          this._triggerDetection();
        }
      }
    } catch (err) {
      // Network / timeout errors are silently swallowed — the loop continues.
      console.error('[WakeWord] STT request error:', err);
    }
  }

  private _triggerDetection(): void {
    if (!this.active || this.inCooldown) return;

    this.inCooldown = true;
    this.onListening?.(false);
    this.onDetected?.();

    setTimeout(() => {
      this.inCooldown = false;
      if (this.active && this.generation !== 0) {
        this._recordChunk(this.generation);
      }
    }, COOLDOWN_MS);
  }

  private _stopRecorder(): void {
    if (this.recorder) {
      if (this.recorder.state !== 'inactive') {
        try { this.recorder.stop(); } catch { /* ignore */ }
      }
      // Detach handlers so onstop doesn't fire for our new session.
      this.recorder.ondataavailable = null;
      this.recorder.onstop          = null;
      this.recorder = null;
    }
  }

  private _releaseStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const wakeWordService = new WakeWordService();
