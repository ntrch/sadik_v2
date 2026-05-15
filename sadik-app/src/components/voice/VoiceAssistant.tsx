import React, { useState, useRef, useContext, useEffect, useCallback } from 'react';
import { Mic, MicOff, Volume2, Radio, X } from 'lucide-react';
import { MicVAD } from '@ricky0123/vad-web';
import { AppContext } from '../../context/AppContext';
import { voiceLiveService, ToolResult } from '../../services/voiceLiveService';

// ── Types ─────────────────────────────────────────────────────────────────────

// idle       — waiting for wakeword / mic-tap
// listening  — VAD active, mic pipe to WS open
// thinking   — end_of_turn sent, waiting for Gemini response
// speaking   — receiving/playing Gemini audio
type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Bubble {
  role: 'user' | 'assistant';
  text: string;
}

// ── Focus guard ───────────────────────────────────────────────────────────────

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

// ── Tool name → Turkish label ─────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  list_tasks:            'Görevler listeleniyor',
  delete_task:           'Görev siliniyor',
  list_habits:           'Alışkanlıklar kontrol ediliyor',
  get_today_agenda:      'Bugünkü ajanda alınıyor',
  get_app_usage_summary: 'Kullanım özeti çıkarılıyor',
  start_pomodoro:        'Pomodoro başlatılıyor',
  switch_mode:           'Mod değiştiriliyor',
  search_memory:         'Hafıza aranıyor',
  cancel_break:          'Mola iptal ediliyor',
  list_workspaces:       'Çalışma alanları getiriliyor',
  start_workspace:       'Çalışma alanı başlatılıyor',
  get_current_mode:      'Aktif mod kontrol ediliyor',
};

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<VoiceState, string> = {
  idle:      'Dinlemek için mikrofona basın',
  listening: 'Dinleniyor...',
  thinking:  'Düşünüyor...',
  speaking:  'Konuşuyor...',
};

// VAD config — T9.5.6 tuned: longer silence tolerance to prevent early cut on
// short words ("selam") or mid-sentence breath pauses.
const POST_ROLL_SILENCE_MS = 1500;  // was 800 — extra 700ms hangover
const MIN_RECORDING_MS     = 1500;
const VAD_CONFIG = {
  positiveSpeechThreshold: 0.6,
  negativeSpeechThreshold: 0.35,
  redemptionFrames: 48,   // was 24 (~750ms) → ~1500ms silence tolerance
  minSpeechFrames: 4,
  preSpeechPadFrames: 10,
};

// Mic capture: 48kHz browser default → downsample to 16kHz for Gemini
// CHUNK_FRAMES @ 16kHz = 100ms chunks
const CHUNK_FRAMES = 1600; // 100ms @ 16kHz

// Cost discipline: if VAD speech_start doesn't fire within this window after
// connect, disconnect immediately (false-positive wakeword guard).
const WAKEWORD_GRACE_MS = 2000;

// =============================================================================
// VoiceAssistant — Voice V2 (Gemini Live)
// =============================================================================

export default function VoiceAssistant() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [voiceState,     setVoiceState]     = useState<VoiceState>('idle');
  const [bubbles,        setBubbles]        = useState<Bubble[]>([]);
  const [error,          setError]          = useState<string | null>(null);
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  const [activeTool,     setActiveTool]     = useState<string | null>(null);

  const voiceStateRef = useRef<VoiceState>('idle');

  // Keep ref in sync
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);

  // ── VAD / mic refs ─────────────────────────────────────────────────────────
  const vadRef               = useRef<any | null>(null);
  const persistentStreamRef  = useRef<MediaStream | null>(null);
  const postRollTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vadSpeechActiveRef   = useRef(false);
  const speechDetectedRef    = useRef(false);  // VAD confirmed speech in this turn

  // ── Mic PCM pipeline refs ──────────────────────────────────────────────────
  // PCM is fed from VAD onFrameProcessed (16kHz Float32) — no ScriptProcessor.
  const micPipeActiveRef     = useRef(false);   // true when sending PCM to WS
  // PCM accumulator: we accumulate samples until CHUNK_FRAMES
  const pcmAccumulatorRef    = useRef<number[]>([]);

  // ── Session guards ─────────────────────────────────────────────────────────
  const wakewordGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionActiveRef      = useRef(false);   // WS session is open
  const firstAudioReceivedRef = useRef(false);   // reset per turn; guards onAudio spam

  // ── AppContext ─────────────────────────────────────────────────────────────
  const {
    triggerEvent,
    returnToIdle,
    wakeWordEnabled,
    wakeWordActive,
    wakeWordPending,
    clearWakeWordPending,
    toggleWakeWord,
    pauseWakeWord,
    resumeWakeWord,
    continuousConversationRef,
    selectedAudioInputDeviceId,
    setVoiceAssistantActive,
    markAppActivity,
  } = useContext(AppContext);

  const selectedAudioInputIdRef = useRef('default');
  selectedAudioInputIdRef.current = selectedAudioInputDeviceId;

  // Notify AppContext so spoken proactive is gated while voice is active
  useEffect(() => {
    setVoiceAssistantActive(voiceState !== 'idle');
  }, [voiceState, setVoiceAssistantActive]);

  // ── Cleanup helpers ────────────────────────────────────────────────────────

  const stopMicPipeline = useCallback(() => {
    micPipeActiveRef.current = false;
    pcmAccumulatorRef.current = [];
  }, []);

  const destroyVAD = useCallback(() => {
    if (postRollTimerRef.current) {
      clearTimeout(postRollTimerRef.current);
      postRollTimerRef.current = null;
    }
    if (vadRef.current) {
      vadRef.current.destroy().catch(() => {});
      vadRef.current = null;
    }
    if (persistentStreamRef.current) {
      persistentStreamRef.current.getTracks().forEach(t => t.stop());
      persistentStreamRef.current = null;
    }
    vadSpeechActiveRef.current = false;
    speechDetectedRef.current  = false;
  }, []);

  const clearWakewordGrace = useCallback(() => {
    if (wakewordGraceTimerRef.current) {
      clearTimeout(wakewordGraceTimerRef.current);
      wakewordGraceTimerRef.current = null;
    }
  }, []);

  const returnToIdleFlow = useCallback(() => {
    // Idempotency guard: skip if already idle and session already torn down.
    // Prevents double dispatch when both endSession and onClose call this.
    if (voiceStateRef.current === 'idle' && !sessionActiveRef.current) return;
    setError(null);
    setActiveTool(null);
    setStatusOverride(null);
    setVoiceState('idle');
    returnToIdle();
    resumeWakeWord();
    sessionActiveRef.current = false;
  }, [returnToIdle, resumeWakeWord]);

  // ── Full session teardown ──────────────────────────────────────────────────
  //
  // Graceful reasons (await disconnect — let Gemini audio finish):
  //   turn_complete, tool_result, server_error, wakeword_grace_timeout
  //   Default for any unrecognised reason: graceful (safest).
  //
  // Force reasons (forceClose — cut immediately):
  //   cancel, error, idle_timeout

  const endSession = useCallback((reason: string) => {
    console.log(`[Voice] endSession reason=${reason}`);
    // Flip sessionActiveRef synchronously BEFORE any async disconnect so that
    // ws.onclose (which fires synchronously on server-close) sees it already
    // false and skips the redundant returnToIdleFlow call. returnToIdleFlow
    // itself also has an idempotency guard as a second line of defence.
    sessionActiveRef.current = false;
    clearWakewordGrace();
    stopMicPipeline();

    const forceReasons = ['cancel', 'error', 'idle_timeout', 'wakeword_grace_timeout'];
    if (forceReasons.includes(reason)) {
      voiceLiveService.forceClose();
      if (!continuousConversationRef.current) {
        destroyVAD();
      }
      returnToIdleFlow();
    } else {
      // Graceful: drain playback queue before closing
      voiceLiveService.disconnect().then(() => {
        if (!continuousConversationRef.current) {
          destroyVAD();
        }
        returnToIdleFlow();
      }).catch(() => {
        // disconnect() should not throw, but be safe
        if (!continuousConversationRef.current) {
          destroyVAD();
        }
        returnToIdleFlow();
      });
    }
  }, [clearWakewordGrace, stopMicPipeline, destroyVAD, returnToIdleFlow, continuousConversationRef]);

  // ── Cancel ─────────────────────────────────────────────────────────────────

  const cancelVoice = useCallback(() => {
    console.log('[Voice] cancelVoice');
    clearWakewordGrace();
    voiceLiveService.forceClose();
    stopMicPipeline();
    destroyVAD();
    setActiveTool(null);
    setStatusOverride(null);
    setVoiceState('idle');
    returnToIdle();
    pauseWakeWord();
    resumeWakeWord();
    sessionActiveRef.current = false;
  }, [clearWakewordGrace, stopMicPipeline, destroyVAD, returnToIdle, pauseWakeWord, resumeWakeWord]);

  // ── Global Escape ─────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (voiceStateRef.current === 'idle') return;
      if (isInputFocused()) return;
      cancelVoice();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelVoice]);

  // ── Core session start ─────────────────────────────────────────────────────

  const startListeningRef = useRef<(triggerSource: 'wakeword' | 'mic_tap') => Promise<void>>(
    async () => {}
  );

  const startListening = useCallback(async (triggerSource: 'wakeword' | 'mic_tap') => {
    if (sessionActiveRef.current) {
      console.log('[Voice] startListening: session already active — skipped');
      return;
    }

    setError(null);
    setActiveTool(null);
    setStatusOverride(null);
    markAppActivity();
    pauseWakeWord();

    // Fire waking animation before mic acquisition
    triggerEvent('wake_word_detected');

    // ── Acquire mic stream ─────────────────────────────────────────────────
    let stream: MediaStream;
    const existing = persistentStreamRef.current;
    if (existing && existing.getAudioTracks().some(t => t.readyState === 'live')) {
      stream = existing;
      console.log('[Voice] Reusing persistent mic stream');
    } else {
      const audioConstraints: boolean | MediaTrackConstraints =
        selectedAudioInputIdRef.current === 'default'
          ? true
          : { deviceId: { exact: selectedAudioInputIdRef.current } };
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch {
        if (selectedAudioInputIdRef.current !== 'default') {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          setError('Mikrofon erişimi reddedildi');
          resumeWakeWord();
          return;
        }
      }
      persistentStreamRef.current = stream;
      console.log('[Voice] New mic stream acquired');
    }

    // ── VAD setup ─────────────────────────────────────────────────────────
    speechDetectedRef.current  = false;
    vadSpeechActiveRef.current = false;

    try {
      if (vadRef.current) {
        // Existing VAD from previous continuous-mode turn — reset only
        if (!continuousConversationRef.current) {
          vadRef.current.start();
        }
        console.log('[Voice] VAD reused');
      } else {
        const vad = await MicVAD.new({
          ...VAD_CONFIG,
          getStream: async () => stream,
          submitUserSpeechOnPause: false,

          onSpeechStart: () => {
            vadSpeechActiveRef.current = true;
            if (postRollTimerRef.current) {
              clearTimeout(postRollTimerRef.current);
              postRollTimerRef.current = null;
            }
            const st = voiceStateRef.current;
            // Allow speech during 'listening' OR while WS is still connecting
            // (session active but not yet ready — "waking" window).
            const isWaking = st === 'idle' && sessionActiveRef.current;
            if (st !== 'listening' && !isWaking) {
              console.log('[Voice] VAD speech_start ignored (not listening)');
              return;
            }
            console.log('[Voice] VAD speech_start → mic pipe ENABLE');
            speechDetectedRef.current = true;
            micPipeActiveRef.current  = true;
            clearWakewordGrace();
          },

          onSpeechEnd: (_audio: Float32Array) => {
            vadSpeechActiveRef.current = false;
            const st = voiceStateRef.current;
            const isWaking = st === 'idle' && sessionActiveRef.current;
            if (st !== 'listening' && !isWaking) return;
            if (!speechDetectedRef.current) return;

            console.log(`[Voice] VAD speech_end → post-roll armed (${POST_ROLL_SILENCE_MS}ms)`);
            if (postRollTimerRef.current) clearTimeout(postRollTimerRef.current);

            postRollTimerRef.current = setTimeout(() => {
              postRollTimerRef.current = null;
              const st = voiceStateRef.current;
              // Allow end_of_turn if fully listening OR if WS is still
              // connecting (idle + sessionActive = "waking" window — pre-ready
              // speech case). signalEndOfTurn() handles buffering when pre-ready.
              const isWaking = st === 'idle' && sessionActiveRef.current;
              if (st !== 'listening' && !isWaking) return;
              console.log('[Voice] VAD post-roll expired → signalEndOfTurn');
              micPipeActiveRef.current = false;
              // Flush any remaining accumulated PCM
              pcmAccumulatorRef.current = [];
              voiceLiveService.signalEndOfTurn();
              setVoiceState('thinking');
              triggerEvent('processing');
            }, POST_ROLL_SILENCE_MS);
          },

          onVADMisfire: () => {
            console.log('[Voice] VAD misfire (speech too short)');
          },

          onFrameProcessed: (_probs: { isSpeech: number }, frame: Float32Array) => {
            if (!micPipeActiveRef.current) return;
            // frame is 16kHz Float32, length 512 (~32ms) — already correct rate
            for (let i = 0; i < frame.length; i++) {
              const s = Math.max(-1, Math.min(1, frame[i]));
              pcmAccumulatorRef.current.push(s < 0 ? s * 32768 : s * 32767);
            }
            while (pcmAccumulatorRef.current.length >= CHUNK_FRAMES) {
              const chunk = new Int16Array(pcmAccumulatorRef.current.splice(0, CHUNK_FRAMES));
              voiceLiveService.pipeMicChunk(chunk);
            }
          },

          baseAssetPath: '/vad/',
          onnxWASMBasePath: '/vad/',
        });

        vadRef.current = vad;
        await vad.start();
        console.log('[Voice] Silero VAD created and active');
      }
    } catch (e) {
      console.warn('[Voice] VAD setup failed (non-fatal):', e);
    }

    // ── Connect Gemini Live WS ─────────────────────────────────────────────
    sessionActiveRef.current = true;
    firstAudioReceivedRef.current = false;

    voiceLiveService.connect(triggerSource, {
      onReady: () => {
        console.log('[Voice] WS ready → listening');
        setVoiceState('listening');
        triggerEvent('user_speaking');

        // Cost discipline: 2s wakeword false-positive guard.
        // If VAD speech_start doesn't fire within WAKEWORD_GRACE_MS, disconnect.
        wakewordGraceTimerRef.current = setTimeout(() => {
          wakewordGraceTimerRef.current = null;
          if (!speechDetectedRef.current && voiceStateRef.current === 'listening') {
            console.log('[Voice] Wakeword grace timeout — no speech detected, disconnecting (cost ~0)');
            endSession('wakeword_grace_timeout');
          }
        }, WAKEWORD_GRACE_MS);
      },

      onAudio: (_pcm24k: Int16Array) => {
        // Playback is handled inside voiceLiveService; we react to first chunk only.
        // Guard prevents repeated state sets and log spam for every chunk.
        if (firstAudioReceivedRef.current) return;
        firstAudioReceivedRef.current = true;
        console.log('[Voice] First audio chunk → speaking');
        setVoiceState('speaking');
        triggerEvent('assistant_speaking');
      },

      onTranscript: (text: string, finished: boolean) => {
        if (finished && text.trim()) {
          console.log('[Voice] transcript (final):', text);
          setBubbles(p => [...p, { role: 'user', text: text.trim() }]);
        }
      },

      onTurnComplete: () => {
        console.log('[Voice] turn_complete');
        firstAudioReceivedRef.current = false;  // reset for next turn
        if (continuousConversationRef.current) {
          // Multi-turn: keep WS open, suspend mic pipe, wait for next speech
          console.log('[Voice] Continuous mode: suspending pipe, arming VAD for next turn');
          micPipeActiveRef.current  = false;
          speechDetectedRef.current = false;
          vadSpeechActiveRef.current = false;
          setVoiceState('listening');
          triggerEvent('user_speaking');
        } else {
          // Single-turn: close session
          endSession('turn_complete');
          triggerEvent('conversation_finished');
        }
      },

      onToolResult: (result: ToolResult) => {
        console.log('[Voice] tool_result', result.tool_name, result.status);
        // Reset firstAudioReceivedRef so the first narration audio chunk after
        // tool execution correctly transitions state to 'speaking'.
        firstAudioReceivedRef.current = false;
        setActiveTool(null);
        if (result.status === 'ok') {
          // Done clip: tool succeeded (plays in parallel with narration audio)
          triggerEvent('confirmation_success');
        } else {
          // Error clip: tool failed
          triggerEvent('soft_error');
        }
        // T9.5.7: do NOT fast-disconnect here.
        // Backend feeds result text to Gemini Live → narration audio chunks will
        // arrive → onAudio fires → state transitions to 'speaking'.
        // Session ends naturally on turn_complete (onTurnComplete handler below).
      },

      onError: (detail: string) => {
        console.error('[Voice] server error:', detail);
        setError(detail || 'Ses oturumu hatası');
        triggerEvent('soft_error');
        setTimeout(() => endSession('server_error'), 1500);
      },

      onClose: () => {
        console.log('[Voice] WS closed');
        if (sessionActiveRef.current) {
          // Unexpected close
          sessionActiveRef.current = false;
          returnToIdleFlow();
        }
      },
    });
  }, [
    markAppActivity, pauseWakeWord, resumeWakeWord, triggerEvent,
    clearWakewordGrace, endSession, returnToIdleFlow,
    continuousConversationRef, destroyVAD,
  ]);

  // Keep ref up-to-date
  useEffect(() => { startListeningRef.current = startListening; });

  // ── Tool status display ────────────────────────────────────────────────────
  // Show tool label when thinking state + tool is detected via transcript
  // (transcript keywords are not reliable — show spinner in "thinking" state)

  // ── Wake word pending ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!wakeWordPending) return;
    if (isInputFocused()) {
      console.log('[Voice] wakeWordPending: skipped — input focused');
      clearWakeWordPending();
      return;
    }
    const state = voiceStateRef.current;
    if (state === 'idle') {
      clearWakeWordPending();
      startListeningRef.current('wakeword');
    } else if (state === 'speaking') {
      // Barge-in: interrupt and start new turn
      console.log('[Voice] Barge-in during speaking');
      clearWakeWordPending();
      cancelVoice();
      setTimeout(() => startListeningRef.current('wakeword'), 50);
    }
    // thinking: ignore — cannot interrupt mid-pipeline
  }, [wakeWordPending, clearWakeWordPending, cancelVoice]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    const onUnload = () => {
      clearWakewordGrace();
      voiceLiveService.forceClose();
      stopMicPipeline();
      destroyVAD();
      returnToIdle();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      clearWakewordGrace();
      voiceLiveService.forceClose();
      stopMicPipeline();
      destroyVAD();
      returnToIdle();
      resumeWakeWord();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Button handlers ────────────────────────────────────────────────────────

  const handleMicClick = () => {
    if (voiceState === 'idle') {
      startListeningRef.current('mic_tap');
    } else if (voiceState === 'listening') {
      // Manual stop: flush end_of_turn
      micPipeActiveRef.current = false;
      pcmAccumulatorRef.current = [];
      voiceLiveService.signalEndOfTurn();
      setVoiceState('thinking');
      triggerEvent('processing');
    }
  };

  // ── Derived flags ──────────────────────────────────────────────────────────

  const isListening  = voiceState === 'listening';
  const isThinking   = voiceState === 'thinking';
  const isSpeaking   = voiceState === 'speaking';
  const isActive     = isListening || isThinking || isSpeaking;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center justify-start h-full pt-8 pb-6 gap-6 page-transition overflow-y-auto">

      {/* Title row + wake-word toggle */}
      <div className="flex items-center justify-between w-full max-w-md px-2">
        <h1 className="text-xl font-bold text-text-primary">Sesli Asistan</h1>

        <button
          onClick={toggleWakeWord}
          title={wakeWordEnabled ? '"Sadık" komutunu dinliyor' : 'Uyandırma kelimesi kapalı'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all
            ${wakeWordEnabled
              ? 'bg-accent-green/15 text-accent-green border border-accent-green/30'
              : 'bg-bg-input text-text-muted border border-border'}`}
        >
          <Radio size={12} className={wakeWordEnabled && wakeWordActive ? 'animate-pulse' : ''} />
          {wakeWordEnabled ? 'Uyandırma Açık' : 'Uyandırma Kapalı'}
        </button>
      </div>

      {/* Wake-word hint */}
      {wakeWordEnabled && voiceState === 'idle' && (
        <p className="text-[11px] text-text-muted -mt-3">
          {wakeWordActive
            ? '"Sadık" diyerek konuşmaya başlayabilirsiniz'
            : 'Mikrofon bağlanıyor...'}
        </p>
      )}

      {/* Mic button + cancel */}
      <div className="flex items-center gap-4 mt-2">

        {isActive && (
          <button
            onClick={cancelVoice}
            title={isSpeaking ? 'Dur' : 'İptal'}
            className="w-12 h-12 rounded-full bg-accent-red/15 hover:bg-accent-red/25 border border-accent-red/40
                       text-accent-red flex items-center justify-center transition-all duration-200 flex-shrink-0"
          >
            <X size={18} />
          </button>
        )}

        <div className="relative">
          {isListening && (
            <>
              <span className="absolute inset-0 rounded-full bg-accent-red/20 animate-ping" />
              <span
                className="absolute inset-[-12px] rounded-full border-2 border-accent-red/30"
                style={{ animation: 'pulse-ring 1.5s ease-out infinite' }}
              />
            </>
          )}

          <button
            onClick={handleMicClick}
            disabled={isThinking || isSpeaking}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg
              ${isListening
                ? 'bg-accent-red hover:bg-red-600 scale-110'
                : isThinking || isSpeaking
                  ? 'bg-bg-card border border-border text-text-muted cursor-not-allowed opacity-70'
                  : 'bg-accent-purple hover:bg-accent-purple-hover hover:scale-105'}`}
          >
            {isSpeaking ? (
              <Volume2 size={28} className="text-white" />
            ) : isListening ? (
              <MicOff size={28} className="text-white" />
            ) : (
              <Mic size={28} className={isThinking ? 'text-text-muted' : 'text-white'} />
            )}
          </button>
        </div>

        {isActive && <div className="w-12 h-12 flex-shrink-0" />}
      </div>

      {/* Status label */}
      <p
        className={`text-sm font-medium transition-colors text-center max-w-xs
          ${isListening
            ? 'text-accent-red'
            : isThinking || isSpeaking
              ? 'text-accent-yellow'
              : 'text-text-secondary'}`}
      >
        {statusOverride ?? STATUS_LABELS[voiceState]}
        {isActive && (
          <span className="text-text-muted text-xs font-normal ml-2">
            {isSpeaking ? '— Dur\'a bas' : isListening ? '— İptal için X' : '— İptal\'e bas'}
          </span>
        )}
      </p>

      {/* Tool indicator */}
      {activeTool && (
        <p className="text-xs text-text-muted animate-pulse -mt-2">
          {TOOL_LABELS[activeTool] ?? activeTool}...
        </p>
      )}

      {/* Error banner */}
      {error && (
        <p className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/20 px-4 py-2 rounded-btn max-w-xs text-center">
          {error}
        </p>
      )}

      {/* Conversation bubbles */}
      {bubbles.length > 0 && (
        <div className="w-full max-w-md space-y-3 overflow-y-auto max-h-72 px-1">
          {bubbles.map((b, i) => (
            <div
              key={i}
              className={`flex animate-fade-in ${b.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`px-4 py-2.5 rounded-2xl text-sm max-w-[85%] leading-relaxed
                  ${b.role === 'user'
                    ? 'bg-accent-purple text-white rounded-br-md'
                    : 'bg-bg-card border border-border text-text-primary rounded-bl-md'}`}
              >
                {b.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty-state hint */}
      {bubbles.length === 0 && voiceState === 'idle' && !wakeWordEnabled && (
        <p className="text-xs text-text-muted text-center max-w-xs">
          Mikrofon butonuna basarak konuşmaya başlayın.
        </p>
      )}
    </div>
  );
}
