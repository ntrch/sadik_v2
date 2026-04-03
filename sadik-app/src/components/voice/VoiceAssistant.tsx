import React, { useState, useRef, useContext, useEffect, useCallback } from 'react';
import { Mic, MicOff, Volume2, Radio, X } from 'lucide-react';
import axios from 'axios';
import { voiceApi } from '../../api/voice';
import { chatApi } from '../../api/chat';
import { AppContext } from '../../context/AppContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

interface Bubble {
  role: 'user' | 'assistant';
  text: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isCancelled(e: unknown): boolean {
  if (axios.isCancel(e)) return true;
  if (e instanceof Error && e.name === 'CanceledError') return true;
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(id); resolve(); });
  });
}

function getSupportedMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

async function hasAudioEnergy(blob: Blob): Promise<boolean> {
  try {
    const arrayBuffer  = await blob.arrayBuffer();
    const audioContext = new AudioContext();
    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const data        = audioBuffer.getChannelData(0);
      let sumOfSquares  = 0;
      for (let i = 0; i < data.length; i++) sumOfSquares += data[i] * data[i];
      const rms = Math.sqrt(sumOfSquares / data.length);
      console.log('[Voice] Audio RMS energy:', rms);
      return rms >= 0.01;
    } finally {
      await audioContext.close();
    }
  } catch {
    return true;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<VoiceState, string> = {
  idle:       'Dinlemek için mikrofona basın',
  listening:  'Dinleniyor...',
  processing: 'Düşünüyor...',
  speaking:   'Konuşuyor...',
};

const SPEECH_START_THRESHOLD = 0.02;   // RMS above this → speech started
const SILENCE_THRESHOLD      = 0.01;   // RMS below this → silence
const SILENCE_DURATION_MS    = 1200;   // continuous silence before auto-stop
const NO_SPEECH_TIMEOUT_MS   = 5000;   // hard timeout if user never speaks

// =============================================================================
// VoiceAssistant
// =============================================================================

export default function VoiceAssistant() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [voiceState,     setVoiceState]     = useState<VoiceState>('idle');
  const [bubbles,        setBubbles]        = useState<Bubble[]>([]);
  const [error,          setError]          = useState<string | null>(null);
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  /** Tracks whether speech energy was detected during current listening session (for hint text). */
  const [speechDetected, setSpeechDetected] = useState(false);

  // ── Refs — recording ───────────────────────────────────────────────────────
  const mediaRecorderRef   = useRef<MediaRecorder | null>(null);
  const audioChunks        = useRef<Blob[]>([]);
  const audioRef           = useRef<HTMLAudioElement | null>(null);
  const listeningTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returnTimer        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceStateRef      = useRef<VoiceState>('idle');
  const cancelledRef       = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const startListeningRef  = useRef<() => Promise<void>>(async () => {});

  // ── Refs — silence detection ───────────────────────────────────────────────
  const silenceAudioCtxRef       = useRef<AudioContext | null>(null);
  const silenceDetectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noSpeechTimeoutRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechDetectedRef        = useRef(false);   // ref for use inside interval callback
  const silenceStartRef          = useRef<number | null>(null);

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
  } = useContext(AppContext);

  // Keep voiceState ref in sync.
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);

  // ── Silence detection cleanup ──────────────────────────────────────────────

  const stopSilenceDetection = useCallback(() => {
    if (silenceDetectIntervalRef.current !== null) {
      clearInterval(silenceDetectIntervalRef.current);
      silenceDetectIntervalRef.current = null;
    }
    if (noSpeechTimeoutRef.current !== null) {
      clearTimeout(noSpeechTimeoutRef.current);
      noSpeechTimeoutRef.current = null;
    }
    if (silenceAudioCtxRef.current) {
      silenceAudioCtxRef.current.close().catch(() => {});
      silenceAudioCtxRef.current = null;
    }
    speechDetectedRef.current = false;
    silenceStartRef.current   = null;
    setSpeechDetected(false);
  }, []);

  // ── Stop TTS playback — null handlers first to prevent late onended fires ──

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
  }, []);

  // ── Wake word pending: auto-start (idle) OR barge-in (speaking) ───────────

  useEffect(() => {
    if (!wakeWordPending) return;
    const state = voiceStateRef.current;

    if (state === 'idle') {
      clearWakeWordPending();
      setError(null);
      startListeningRef.current();
    } else if (state === 'speaking') {
      // Barge-in: interrupt TTS and start a new listening turn.
      console.log('[Voice] Barge-in: wake word detected during TTS');
      clearWakeWordPending();
      stopPlayback();
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      if (returnTimer.current) { clearTimeout(returnTimer.current); returnTimer.current = null; }
      setVoiceState('idle');
      // startListening will call pauseWakeWord before mic acquisition
      setTimeout(() => startListeningRef.current(), 50);
    }
    // processing state: ignore — cannot interrupt a mid-pipeline request
  }, [wakeWordPending, clearWakeWordPending, stopPlayback]);

  // ── Return to idle ─────────────────────────────────────────────────────────

  const returnToIdleFlow = useCallback(() => {
    setVoiceState('idle');
    returnToIdle();
    resumeWakeWord();
  }, [returnToIdle, resumeWakeWord]);

  // ── beforeunload + unmount cleanup ────────────────────────────────────────

  useEffect(() => {
    const onUnload = () => {
      abortControllerRef.current?.abort();
      stopPlayback();
      stopSilenceDetection();
      returnToIdle();
      fetch('http://localhost:8000/api/device/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'RETURN_TO_IDLE' }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      abortControllerRef.current?.abort();
      if (listeningTimer.current) clearTimeout(listeningTimer.current);
      if (returnTimer.current)    clearTimeout(returnTimer.current);
      stopPlayback();
      stopSilenceDetection();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cancel ─────────────────────────────────────────────────────────────────

  const cancelVoice = useCallback(() => {
    cancelledRef.current = true;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    stopSilenceDetection();

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    stopPlayback();

    if (listeningTimer.current) clearTimeout(listeningTimer.current);
    if (returnTimer.current)    clearTimeout(returnTimer.current);

    setStatusOverride(null);
    setVoiceState('idle');
    returnToIdle();
    resumeWakeWord();
  }, [returnToIdle, resumeWakeWord, stopPlayback, stopSilenceDetection]);

  // ── Audio pipeline ────────────────────────────────────────────────────────
  //
  // Animation event sequence (matches eventMapping.ts):
  //   processing           → thinking      (loops: STT + LLM)
  //   understanding_resolved → understanding (fires after LLM, while TTS fetches)
  //   assistant_speaking   → talking       (loops: audio plays)
  //   conversation_finished → goodbye_to_idle (fires: audio ended)

  const processAudio = useCallback(async (blob: Blob, signal: AbortSignal) => {
    setVoiceState('processing');
    triggerEvent('processing');   // thinking — loops until understanding_resolved

    try {
      // ── Step 0: Energy gate ───────────────────────────────────────────────
      const hasEnergy = await hasAudioEnergy(blob);
      if (!hasEnergy) {
        triggerEvent('didnt_hear');
        setStatusOverride('Duyamadım, tekrar söyler misiniz?');
        await sleep(2200, signal);
        setStatusOverride(null);
        if (!signal.aborted) returnToIdleFlow();
        return;
      }

      // ── Step 1: STT ───────────────────────────────────────────────────────
      const text = await voiceApi.stt(blob, signal);
      if (signal.aborted) return;

      // ── Step 2: Validate transcript ───────────────────────────────────────
      const trimmed   = text.trim();
      const wordCount = trimmed.split(/\s+/).filter((w) => w.length > 1).length;

      if (trimmed.length < 2 || wordCount < 1) {
        triggerEvent('didnt_hear');
        await sleep(2200, signal);
        if (!signal.aborted) returnToIdleFlow();
        return;
      }

      setBubbles((p) => [...p, { role: 'user', text: trimmed }]);

      // ── Step 3: LLM ───────────────────────────────────────────────────────
      // Thinking animation continues looping — no event change during LLM wait.
      const res = await chatApi.sendMessage(trimmed, true, signal);
      if (signal.aborted) return;

      const reply = res.response;
      setBubbles((p) => [...p, { role: 'assistant', text: reply }]);

      // ── Step 4: Understanding + TTS fetch in parallel ─────────────────────
      // Fire understanding_resolved immediately after LLM responds, then fetch
      // TTS audio and hold the understanding animation concurrently.  Audio is
      // ready to play the moment the animation minimum has elapsed — no gap.
      triggerEvent('understanding_resolved');
      const [audioBlob] = await Promise.all([
        voiceApi.tts(reply, signal),   // TTS generation overlaps animation
        sleep(500, signal),            // hold understanding clip ≥ 500 ms
      ]);
      if (signal.aborted) return;

      // ── Step 5: Play TTS ──────────────────────────────────────────────────
      setVoiceState('speaking');
      triggerEvent('assistant_speaking');   // talking animation — loops while audio plays

      const url   = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (continuousConversationRef.current) {
          // Continuous mode: loop straight back to listening — no goodbye animation.
          triggerEvent('user_speaking');
          setTimeout(() => startListeningRef.current(), 150);
        } else {
          // Normal mode: goodbye animation → idle.
          triggerEvent('conversation_finished');  // goodbye_to_idle animation
          // Pause wake word; returnToIdleFlow re-arms it with its 800 ms delay.
          pauseWakeWord();
          if (returnTimer.current) clearTimeout(returnTimer.current);
          returnTimer.current = setTimeout(() => returnToIdleFlow(), 1200);
        }
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        returnToIdleFlow();
      };

      await audio.play();

      // Re-arm wake word during TTS playback so barge-in is possible.
      // resumeWakeWord has an internal 800 ms delay before restarting the service.
      resumeWakeWord();

    } catch (e: unknown) {
      if (isCancelled(e) || signal.aborted) return;

      const msg = e instanceof Error ? e.message : 'Bir hata oluştu';
      setError(msg);
      triggerEvent('soft_error');
      setTimeout(() => returnToIdleFlow(), 2000);
      setVoiceState('idle');
    }
  }, [triggerEvent, returnToIdleFlow, pauseWakeWord, resumeWakeWord, continuousConversationRef]);

  // ── Start listening ────────────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    setError(null);
    setSpeechDetected(false);
    cancelledRef.current  = false;
    // Pause global wake word BEFORE acquiring mic — two services cannot share mic.
    pauseWakeWord();

    try {
      const mimeType = getSupportedMimeType();

      // Fire waking animation before getUserMedia — mic acquisition takes ~300ms,
      // during which the animation plays naturally.  Transition to listening
      // immediately after the mic is ready rather than via a fixed timer.
      triggerEvent('wake_word_detected');

      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      audioChunks.current      = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        stopSilenceDetection();
        stream.getTracks().forEach((t) => t.stop());

        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }

        cancelledRef.current = false;
        const actualMime = recorder.mimeType || mimeType || 'audio/webm';
        const blob       = new Blob(audioChunks.current, { type: actualMime });
        const controller = new AbortController();
        abortControllerRef.current = controller;
        await processAudio(blob, controller.signal);
      };

      recorder.start();

      // getUserMedia has resolved — transition directly to listening.
      triggerEvent('user_speaking');
      setVoiceState('listening');

      // ── Silence detection setup ────────────────────────────────────────────
      speechDetectedRef.current = false;
      silenceStartRef.current   = null;

      try {
        const audioCtx = new AudioContext();
        silenceAudioCtxRef.current = audioCtx;

        const source   = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        const bufLen  = analyser.fftSize;
        const dataArr = new Float32Array(bufLen);

        silenceDetectIntervalRef.current = setInterval(() => {
          if (!silenceAudioCtxRef.current) return;

          analyser.getFloatTimeDomainData(dataArr);
          let sumSq = 0;
          for (let i = 0; i < bufLen; i++) sumSq += dataArr[i] * dataArr[i];
          const rms = Math.sqrt(sumSq / bufLen);

          if (!speechDetectedRef.current) {
            // Waiting for speech to start
            if (rms > SPEECH_START_THRESHOLD) {
              speechDetectedRef.current = true;
              setSpeechDetected(true);
              silenceStartRef.current = null;
              console.log('[Voice] Speech detected');
            }
          } else {
            // Speech started — monitor for end-of-speech silence
            if (rms < SILENCE_THRESHOLD) {
              if (silenceStartRef.current === null) {
                silenceStartRef.current = Date.now();
              } else if (Date.now() - silenceStartRef.current >= SILENCE_DURATION_MS) {
                console.log('[Voice] Silence detected, auto-stopping');
                stopSilenceDetection();
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                  mediaRecorderRef.current.stop();
                }
              }
            } else {
              // Still speaking — reset silence timer
              silenceStartRef.current = null;
            }
          }
        }, 100);
      } catch (e) {
        console.warn('[Voice] Silence detection setup failed:', e);
        // Non-fatal — user can still stop manually
      }

      // Hard timeout: auto-stop if user never speaks within NO_SPEECH_TIMEOUT_MS
      noSpeechTimeoutRef.current = setTimeout(() => {
        if (!speechDetectedRef.current) {
          console.log('[Voice] No speech timeout, auto-stopping');
          stopSilenceDetection();
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
          }
        }
      }, NO_SPEECH_TIMEOUT_MS);

    } catch {
      setError('Mikrofon erişimi reddedildi');
      resumeWakeWord();
    }
  }, [processAudio, triggerEvent, pauseWakeWord, resumeWakeWord, stopSilenceDetection]);

  // Keep the ref up-to-date every render.
  useEffect(() => { startListeningRef.current = startListening; });

  // ── Stop listening (manual fallback) ──────────────────────────────────────

  const stopListening = useCallback(() => {
    stopSilenceDetection();
    if (listeningTimer.current) clearTimeout(listeningTimer.current);
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
    }
  }, [stopSilenceDetection]);

  // ── Button handlers ────────────────────────────────────────────────────────

  const handleMicClick = () => {
    if (voiceState === 'idle')           startListening();
    else if (voiceState === 'listening') stopListening();
  };

  // ── Derived flags ──────────────────────────────────────────────────────────

  const isListening  = voiceState === 'listening';
  const isProcessing = voiceState === 'processing';
  const isSpeaking   = voiceState === 'speaking';
  const isActive     = isListening || isProcessing || isSpeaking;

  // Dynamic listening hint: changes once speech is first detected
  const listeningHint = speechDetected
    ? 'Dinliyorum... (sessizlikte otomatik duracak)'
    : 'Konuşmaya başlayın...';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center justify-start h-full pt-8 pb-6 gap-6 page-transition overflow-y-auto">

      {/* ── Title row + wake-word toggle ───────────────────────────────────── */}
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

      {/* ── Wake-word hint ───────────────────────────────────────────────────── */}
      {wakeWordEnabled && voiceState === 'idle' && (
        <p className="text-[11px] text-text-muted -mt-3">
          {wakeWordActive
            ? '"Sadık" diyerek konuşmaya başlayabilirsiniz'
            : 'Mikrofon bağlanıyor...'}
        </p>
      )}

      {/* ── Mic button + cancel ──────────────────────────────────────────────── */}
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
            disabled={isProcessing || isSpeaking}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg
              ${isListening
                ? 'bg-accent-red hover:bg-red-600 scale-110'
                : isProcessing || isSpeaking
                  ? 'bg-bg-card border border-border text-text-muted cursor-not-allowed opacity-70'
                  : 'bg-accent-blue hover:bg-accent-blue-hover hover:scale-105'}`}
          >
            {isSpeaking ? (
              <Volume2 size={28} className="text-white" />
            ) : isListening ? (
              <MicOff size={28} className="text-white" />
            ) : (
              <Mic size={28} className={isProcessing ? 'text-text-muted' : 'text-white'} />
            )}
          </button>
        </div>

        {isActive && <div className="w-12 h-12 flex-shrink-0" />}
      </div>

      {/* ── Status label ────────────────────────────────────────────────────── */}
      <p
        className={`text-sm font-medium transition-colors text-center max-w-xs
          ${isListening
            ? 'text-accent-red'
            : isProcessing || isSpeaking
              ? 'text-accent-yellow'
              : 'text-text-secondary'}`}
      >
        {statusOverride ?? (isListening ? listeningHint : STATUS_LABELS[voiceState])}
        {isActive && (
          <span className="text-text-muted text-xs font-normal ml-2">
            {isSpeaking ? '— Dur\'a bas' : '— İptal\'e bas'}
          </span>
        )}
      </p>

      {/* ── Error banner ────────────────────────────────────────────────────── */}
      {error && (
        <p className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/20 px-4 py-2 rounded-btn max-w-xs text-center">
          {error}
        </p>
      )}

      {/* ── Conversation bubbles ─────────────────────────────────────────────── */}
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
                    ? 'bg-accent-blue text-white rounded-br-md'
                    : 'bg-bg-card border border-border text-text-primary rounded-bl-md'}`}
              >
                {b.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Empty-state hint ────────────────────────────────────────────────── */}
      {bubbles.length === 0 && voiceState === 'idle' && !wakeWordEnabled && (
        <p className="text-xs text-text-muted text-center max-w-xs">
          Mikrofon butonuna basarak konuşmaya başlayın.
        </p>
      )}
    </div>
  );
}
