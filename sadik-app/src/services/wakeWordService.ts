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

// =============================================================================
// Safe Voice Startup Policy
//
// Wake word detection is started ONLY when the user explicitly enables it via
// the UI toggle.  It does NOT start automatically at app launch.
//
// This prevents automatic microphone acquisition at startup, which can cause
// renderer crashes on some Windows audio drivers due to WASAPI concurrent-
// session conflicts (STATUS_ACCESS_VIOLATION / exitCode -1073741819).
//
// Startup safety is guaranteed by AppContext: it only calls wakeWordService.start()
// when the user's saved setting is wake_word_enabled=true (opt-in, not default).
//
// Energy gating uses OfflineAudioContext (pure software renderer, no WASAPI
// hardware) so decodeAudioData never opens a render device while MediaRecorder
// holds the capture session.
// =============================================================================

// ── Configuration ─────────────────────────────────────────────────────────────

const CHUNK_DURATION_MS  = 2000;   // length of each recorded chunk
                                   // 2 s gives short single-word utterances ("Sadık", "Sağdık")
                                   // more room to land inside one chunk rather than being split
                                   // across a chunk boundary, which causes missed detections.
const COOLDOWN_MS        = 6000;   // silence after a detection
const STT_TIMEOUT_MS     = 12000;  // per-request Whisper timeout
const MIN_BLOB_BYTES     = 1500;   // blobs smaller than this are treated as empty
                                   // (1.5 s WebM/Opus @ 16 kbps ≈ 3 KB; < 1500 is header-only)
const TINY_BLOB_FALLBACK = 3;      // consecutive tiny blobs before switching mime type

// Whisper prompt — primes spelling of the two name forms so the model uses
// correct orthography when the wake word genuinely appears.
// Intentionally short: a long, expectation-setting prompt ("this recording
// contains Sadık…") dramatically increases hallucinations when the audio is
// silence or ambient noise, because the model reads it as a strong prior and
// confabulates the named tokens.  A minimal prompt provides spelling guidance
// without that false-positive amplification.
const WAKE_WORD_PROMPT = "Hey Sadık, sana nasıl yardımcı olabilirim? Sağdık.";

// ── MIME-type helpers ─────────────────────────────────────────────────────────

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

/** Return all mime types supported by this browser, in preference order. */
function getSupportedMimeTypes(): string[] {
  if (typeof MediaRecorder === 'undefined') return [];
  return MIME_CANDIDATES.filter((t) => MediaRecorder.isTypeSupported(t));
}

function getSupportedMimeType(): string {
  return getSupportedMimeTypes()[0] ?? '';
}

function mimeToExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
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

// ── Wake-word variant table ───────────────────────────────────────────────────
//
// All entries are already ASCII-folded (normalizeTR applied at build time).
//
// The table is split into two categories that drive different matching logic:
//
//   WAKE_WORDS_SINGLE  — single-token forms (no spaces).
//                        Matched with a whole-word boundary regex (\b…\b) so
//                        the token cannot match as a substring inside an
//                        unrelated longer word that Whisper hallucinated.
//
//   WAKE_WORDS_PHRASES — multi-token forms (contain a space).
//                        Matched with a plain substring check; the phrase is
//                        already specific enough that a spurious match inside
//                        ambient-noise output is extremely unlikely.
//
// Precision policy: marginal "log-derived" single-token variants (sadikcam,
// sadigim, sadika) are intentionally omitted.  "Sadık'a" is covered by the
// word-boundary match on 'sadik' because the apostrophe is a non-word char.
// "Sadıkçığım" is kept as an explicit single token (sadikcigim) so that its
// \b match fires even though it cannot be derived from 'sadik' alone.
const WAKE_WORDS_SINGLE: string[] = [
  // ── Core name tokens ────────────────────────────────────────────────────
  'sadik',        // sadık — primary written/spoken form
  'sagdik',       // sağdık — TTS-trained pronunciation (ğ→g, ı→i)
  'saddik',       // saddık — double-d variant
  'sadiq',        // sadıq — q-final (some locale keyboards)
  'sadick',       // sadick — trailing-ck English spelling
  'sadig',        // voiced final consonant
  // ── Suffix-fused invocation forms ──────────────────────────────────────
  'sadikcigim',   // "sadıkçığım" — affectionate diminutive+possessive
];

const WAKE_WORDS_PHRASES: string[] = [
  // ── Greeting + name phrases ─────────────────────────────────────────────
  'hey sadik',
  'hey sagdik',   // "hey sağdık" — TTS-trained pronunciation with greeting
  'hey saddik',
  'merhaba sadik',
  'selam sadik',
  'selam saddik',
  'ey sadik',
  // ── Explicit command phrases ────────────────────────────────────────────
  'sadik bey',
  'sadik gel',
  'sadik dinle',
];

/**
 * Returns the matched wake-word variant, or null if none matched.
 *
 * Matching strategy
 * ─────────────────
 * Single-token variants  → whole-word boundary regex  (\btoken\b)
 *   After normalizeTR the transcript is pure ASCII [a-z0-9 '.,!?…], so \b
 *   reliably separates word characters from non-word characters.  This means
 *   "sadik" does NOT match inside "sadikseven" or any other longer noise
 *   hallucination; it only matches when "sadik" is a discrete word in the
 *   transcript.  The apostrophe in "sadik'a" is a non-word character, so
 *   \bsadik\b still fires correctly for the dative form.
 *
 * Multi-word phrases     → plain substring match
 *   Phrases like "hey sadik" are specific enough that a false substring match
 *   in ambient-noise output is extremely unlikely.  No boundary guard needed.
 */
function containsWakeWord(transcript: string): string | null {
  const norm = normalizeTR(transcript);

  // 1. Phrase variants — plain substring, already highly specific.
  for (const phrase of WAKE_WORDS_PHRASES) {
    if (norm.includes(phrase)) return phrase;
  }

  // 2. Single-token variants — whole-word boundary only.
  for (const token of WAKE_WORDS_SINGLE) {
    // Build the pattern once per call (list is short, < 10 entries).
    // All tokens are plain ASCII after normalizeTR, so no escaping is needed,
    // but we apply a light escape for future-safety.
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`).test(norm)) return token;
  }

  return null;
}

// ── Service class ─────────────────────────────────────────────────────────────

export class WakeWordService {
  private active        = false;
  private inCooldown    = false;
  private generation    = 0;   // incremented on every start/stop to cancel stale callbacks
  private _sensitivity  = 'normal';
  private _inputDeviceId = 'default';

  // Guards against concurrent getUserMedia calls (e.g. React StrictMode double-invoke).
  // True while the async mic-acquisition is in-flight but before this.active is set.
  private _starting = false;

  private stream:    MediaStream   | null = null;
  private recorder:  MediaRecorder | null = null;
  private chunks:    Blob[]               = [];

  // ── Mime fallback tracking ────────────────────────────────────────────────
  private _mimeIndex      = 0;   // current index into the supported mime list
  private _tinyBlobCount  = 0;   // consecutive tiny blobs for the current mime type

  private onDetected:  (() => void)                  | null = null;
  private onError:     ((msg: string) => void)       | null = null;
  private onListening: ((active: boolean) => void)   | null = null;

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
    // Both this.active (already running) and this._starting (getUserMedia in-flight)
    // must be false before we proceed.  Without the _starting guard, two callers that
    // arrive while getUserMedia is awaiting can both pass the this.active check and
    // open two concurrent WASAPI sessions, crashing the renderer on Windows.
    if (this.active || this._starting) return;
    this._starting = true;
    console.log('[WakeWord] start() — entering, device:', this._inputDeviceId);

    this.onDetected  = onDetected;
    this.onError     = onError  ?? null;
    this.onListening = onListening ?? null;

    // Alias device IDs ('default', 'communications') must use `audio: true` — not
    // `{ exact: id }` — because passing them as exact constraints can hang or fail
    // silently on Windows WASAPI drivers.  Physical device IDs always use exact.
    const constraints: MediaStreamConstraints = {
      audio: this._isAliasDevice()
        ? true
        : { deviceId: { exact: this._inputDeviceId } },
    };
    console.log('[WakeWord] start() — before getUserMedia, alias:', this._isAliasDevice(), 'device:', this._inputDeviceId);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[WakeWord] start() — getUserMedia succeeded, tracks:', this.stream.getTracks().length);
    } catch {
      if (!this._isAliasDevice()) {
        // Physical device unavailable → fall back to system default.
        console.warn('[WakeWord] Selected input device unavailable, falling back to default');
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          console.log('[WakeWord] start() — getUserMedia fallback succeeded');
        } catch {
          this._starting = false;
          this.onError?.('Mikrofon erişimi reddedildi');
          return;
        }
      } else {
        this._starting = false;
        this.onError?.('Mikrofon erişimi reddedildi');
        return;
      }
    }

    this._starting     = false;
    this.active        = true;
    this._mimeIndex    = 0;
    this._tinyBlobCount = 0;
    this.generation++;
    const mimeForLog = this._currentMimeType() || 'default';
    console.log('[WakeWord] start() — active, gen', this.generation, 'mime:', mimeForLog);

    // ── First-chunk arm delay ─────────────────────────────────────────────────
    // On Windows/WASAPI, the audio processing chain (AGC, noise suppression,
    // level normalisation) needs ~150–400 ms to fully settle after getUserMedia()
    // resolves.  Calling _recordChunk() immediately means the first chunk's
    // leading samples are captured during this unstable ramp, which degrades
    // Whisper's confidence on multi-phoneme phrases ("hey Sadık", "Sadıkçığım")
    // even though single-word "Sadık" is short enough to survive the ramp.
    //
    // This 500 ms delay is unnoticeable to the user (onListening remains false
    // during the wait, which is honest — we are not yet capturing usable audio)
    // and replicates the natural settling that the toggle-off/on path already
    // gets for free via the ~400 ms user-action latency.
    // Raised from 350 ms → 500 ms to give Windows AGC/noise-suppression more
    // time to fully stabilise before we capture the first real chunk.
    //
    // The generation guard ensures that if stop() is called during the 500 ms
    // window the stale setTimeout fires but exits immediately without recording.
    const armGen = this.generation;
    setTimeout(() => {
      if (this.active && this.generation === armGen) {
        console.log('[WakeWord] Arm delay elapsed — starting first chunk (gen', armGen, ')');
        this._recordChunk(armGen);
      } else {
        console.log('[WakeWord] Arm delay elapsed but session changed — discarding (armGen', armGen, ')');
      }
    }, 500);
  }

  /** Stop detection and release the microphone. */
  stop(): void {
    if (!this.active && this.stream === null) return;
    this.active = false;
    // Clear inCooldown so that a rapid start() call after stop() (e.g. after a
    // fast cancel → resume sequence) is not blocked by a stale cooldown timer.
    // The generation increment below invalidates the stale setTimeout callback
    // so it cannot restart recording with the wrong session.
    this.inCooldown = false;
    this.generation++;   // invalidate all in-flight callbacks
    this._stopRecorder();
    this._releaseStream();
    this.onListening?.(false);
    console.warn('[WakeWord] Service stopped');
  }

  isActive(): boolean {
    return this.active;
  }

  /** Store sensitivity level (used when energy gating is restored). */
  setSensitivity(level: string): void {
    this._sensitivity = level;
    console.log('[WakeWord] Sensitivity set to:', level);
  }

  /**
   * Set the microphone device ID used for recording.
   * Applies to the next mic acquisition (start() or stream re-acquisition).
   * Pass "default" to use the system default.
   */
  setInputDeviceId(deviceId: string): void {
    this._inputDeviceId = deviceId;
    console.log('[WakeWord] Input device ID set to:', deviceId || 'default');
  }

  /**
   * Returns true when the stored device ID is a virtual/alias endpoint that
   * must be opened via `audio: true` rather than `{ deviceId: { exact: id } }`.
   *
   * On Windows/Electron, enumerateDevices exposes these virtual WASAPI endpoints:
   *   'default'        — Default Communications / Playback alias
   *   'communications' — Communications-role alias (echo-cancel endpoint)
   * Passing either as an `exact` constraint can hang or fail silently on some
   * Windows audio drivers; `audio: true` resolves to the same physical device
   * and is always reliable.
   */
  private _isAliasDevice(): boolean {
    const id = this._inputDeviceId;
    return id === '' || id === 'default' || id === 'communications';
  }

  // ── Internal recording loop ───────────────────────────────────────────────────

  private _currentMimeType(): string {
    const supported = getSupportedMimeTypes();
    if (supported.length === 0) return '';
    // Clamp index in case the supported list shrank.
    if (this._mimeIndex >= supported.length) this._mimeIndex = supported.length - 1;
    return supported[this._mimeIndex];
  }

  private _recordChunk(gen: number): void {
    if (!this.active || !this.stream || this.inCooldown || gen !== this.generation) return;
    // Guard against duplicate recorder sessions.  The stale cooldown setTimeout
    // in _triggerDetection reads this.generation at fire-time (live value), so
    // after stop()+start() it can call _recordChunk with a matching gen while a
    // chunk is already in flight.  If the recorder is still recording we skip —
    // the running chunk's onstop handler will schedule the next one correctly.
    if (this.recorder && this.recorder.state !== 'inactive') return;

    // If the stream tracks ended (e.g. user unplugged mic), re-acquire.
    if (this.stream.getTracks().some((t) => t.readyState === 'ended')) {
      this._releaseStream();
      const reacquireConstraints: MediaStreamConstraints = {
        audio: this._isAliasDevice()
          ? true
          : { deviceId: { exact: this._inputDeviceId } },
      };
      navigator.mediaDevices
        .getUserMedia(reacquireConstraints)
        .then((s) => {
          if (gen !== this.generation) { s.getTracks().forEach((t) => t.stop()); return; }
          this.stream = s;
          this._recordChunk(gen);
        })
        .catch(() => {
          if (gen !== this.generation) return;
          if (!this._isAliasDevice()) {
            console.warn('[WakeWord] Re-acquisition of selected device failed, trying default');
            navigator.mediaDevices.getUserMedia({ audio: true })
              .then((s) => {
                if (gen !== this.generation) { s.getTracks().forEach((t) => t.stop()); return; }
                this.stream = s;
                this._recordChunk(gen);
              })
              .catch(() => {
                if (gen !== this.generation) return;
                this.active = false;
                this.onListening?.(false);
                this.onError?.('Mikrofon bağlantısı kesildi');
              });
          } else {
            this.active = false;
            this.onListening?.(false);
            this.onError?.('Mikrofon bağlantısı kesildi');
          }
        });
      return;
    }

    const mimeType = this._currentMimeType();
    this.chunks = [];

    try {
      this.recorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream);
    } catch (e) {
      console.error('[WakeWord] MediaRecorder init error:', e);
      this.active = false;
      this.onListening?.(false);
      this.onError?.('Ses kaydı başlatılamadı');
      return;
    }

    const recorderForClosure = this.recorder;

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.recorder.onstop = async () => {
      // Guard against stale callbacks after stop()/start() cycles.
      if (!this.active || gen !== this.generation) return;

      const actualMime = recorderForClosure.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(this.chunks, { type: actualMime });

      await this._processChunk(blob, gen, mimeType);

      if (this.active && !this.inCooldown && gen === this.generation) {
        this._recordChunk(gen);
      }
    };

    this.recorder.start();
    this.onListening?.(true);
    console.log('[WakeWord] Recording chunk start (gen', gen, ', mime:', mimeType || 'default', ')');

    // Auto-stop after the chunk duration.
    setTimeout(() => {
      if (this.recorder && this.recorder.state === 'recording') {
        console.log('[WakeWord] Auto-stopping recorder after', CHUNK_DURATION_MS, 'ms');
        this.recorder.stop();
      }
    }, CHUNK_DURATION_MS);
  }

  private async _processChunk(blob: Blob, gen: number, usedMime: string): Promise<void> {
    if (!this.active || gen !== this.generation) return;

    // ── Blob size guard ───────────────────────────────────────────────────────
    // A 1.5 s chunk at 16–48 kbps should produce several KB; anything under
    // MIN_BLOB_BYTES is effectively empty (header-only or no dataavailable).
    if (blob.size < MIN_BLOB_BYTES) {
      console.log(`[WakeWord][Decision] blob=${blob.size} rejected below-min-bytes`);
      console.warn('[WakeWord] Tiny/invalid chunk, skipping', { size: blob.size, type: blob.type });
      this._tinyBlobCount++;

      // Mime fallback: if this mime type keeps producing tiny blobs, rotate.
      if (this._tinyBlobCount >= TINY_BLOB_FALLBACK) {
        const supported = getSupportedMimeTypes();
        const nextIndex = this._mimeIndex + 1;
        if (nextIndex < supported.length) {
          const prev = usedMime || supported[this._mimeIndex] || 'default';
          this._mimeIndex = nextIndex;
          this._tinyBlobCount = 0;
          console.warn('[WakeWord] Switching mime type from', prev, 'to', supported[nextIndex], 'due to repeated tiny chunks');
        } else {
          // Already on the last candidate — just reset the counter and keep going.
          this._tinyBlobCount = 0;
          console.warn('[WakeWord] All mime types exhausted; staying on', usedMime || 'default');
        }
      }
      return;
    }

    // Valid blob — reset the tiny-blob counter.
    this._tinyBlobCount = 0;

    // ── Energy gate: blob size only ───────────────────────────────────────────
    // Audio context decoding (AudioContext or OfflineAudioContext) crashes the
    // renderer on this Windows audio driver (STATUS_ACCESS_VIOLATION / 0xC0000005)
    // when called while or immediately after a WASAPI capture session is active.
    // The blob size check above already filters header-only silent chunks, so
    // this is sufficient — any blob > MIN_BLOB_BYTES is forwarded to STT.
    // The STT endpoint will return empty text for genuinely silent audio, which
    // the wake-word matcher will correctly ignore.

    const actualMime = blob.type || 'audio/webm';
    const ext        = mimeToExtension(actualMime);
    const filename   = `wake.${ext}`;
    const formData   = new FormData();
    formData.append('audio', blob, filename);
    formData.append('prompt', WAKE_WORD_PROMPT);

    console.log('[WakeWord] Sending to STT:', { size: blob.size, type: actualMime, filename });

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

      if (gen !== this.generation || !this.active) {
        console.log('[WakeWord][Decision] rejected stale-generation');
        return;
      }

      // Require at least 3 characters after trimming — single-char or two-char
      // strings are noise artifacts from near-empty audio, not real speech.
      const trimmed = text.trim();
      if (trimmed.length >= 3) {
        const norm      = normalizeTR(trimmed);
        const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

        // ── Word-count guard ────────────────────────────────────────────────
        // A genuine wake-word invocation within a 2-second chunk is naturally
        // short ("Sadık", "hey Sadık", "Sadık ışıkları aç").  More than 5
        // words almost certainly means a TV broadcast or background
        // conversation was captured rather than an intentional activation.
        // Reject without checking the wake-word list to avoid false positives.
        if (wordCount > 5) {
          console.log(`[WakeWord][Decision] blob=${blob.size} raw="${trimmed}" wordCount=${wordCount} rejected too-many-words`);
          return;
        }

        const matched = containsWakeWord(trimmed);
        if (matched !== null) {
          console.log(`[WakeWord][Decision] blob=${blob.size} raw="${trimmed}" normalized="${norm}" wordCount=${wordCount} accepted variant="${matched}"`);
          this._triggerDetection();
        } else {
          console.log(`[WakeWord][Decision] blob=${blob.size} raw="${trimmed}" normalized="${norm}" wordCount=${wordCount} rejected no-variant-match`);
        }
      } else {
        console.log(`[WakeWord][Decision] blob=${blob.size} raw="${trimmed || '(empty)'}" rejected too-short`);
      }
    } catch (err) {
      // Network / timeout errors are silently swallowed — the loop continues.
      console.error('[WakeWord] STT request error:', err);
    }
  }

  private _triggerDetection(): void {
    if (!this.active || this.inCooldown) {
      console.log('[WakeWord][Decision] rejected cooldown-active');
      return;
    }

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
