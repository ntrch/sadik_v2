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

async function hasAudioEnergy(_blob: Blob): Promise<boolean> {
  // AudioContext-based energy gating is disabled.
  // new AudioContext() opens a WASAPI render device; on some Windows audio drivers
  // this conflicts with WASAPI capture sessions and causes STATUS_ACCESS_VIOLATION.
  // The blob size guard in processAudio (< 1000 bytes) is sufficient to filter
  // header-only silent recordings.
  return true;
}

// Preprocess text for TTS only — keeps visible UI text unchanged.
// Replaces the assistant name so Turkish TTS pronounces it naturally as
// "Sağdık" instead of the incorrect hard-d "Sadık" reading.
function prepareTtsText(text: string): string {
  return text
    .replace(/SADIK/g, 'Sağdık')
    .replace(/Sadık/g, 'Sağdık')
    .replace(/sadık/g, 'sağdık');
}

function isConversationEnding(text: string): boolean {
  const lower = text.toLowerCase();
  const endings = [
    'durdurabilirim', 'durduruyorum',
    'ihtiyacın olduğunda', 'ihtiyacınız olduğunda',
    'buradayım', 'her zaman buradayım',
    'görüşürüz', 'hoşça kal', 'iyi günler', 'iyi geceler', 'iyi akşamlar',
    'bu kadar', 'tamam o zaman',
    'konuşmayı sonlandır', 'konuşmayı bitir',
    'güle güle', 'bye', 'goodbye',
    'sonra görüşürüz', 'sonra konuşuruz',
    'kendine iyi bak',
  ];
  return endings.some(e => lower.includes(e));
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<VoiceState, string> = {
  idle:       'Dinlemek için mikrofona basın',
  listening:  'Dinleniyor...',
  processing: 'Düşünüyor...',
  speaking:   'Konuşuyor...',
};

const NO_SPEECH_TIMEOUT_MS   = 30000;  // hard recording cap — auto-stops after 30 s

// Speaking-state direct interruption detector
const INTERRUPT_THRESHOLD  = 0.03;  // RMS above this → user speaking during TTS
const INTERRUPT_SUSTAIN_MS = 300;   // must sustain for this long to trigger interrupt

// =============================================================================
// VoiceAssistant
// =============================================================================

export default function VoiceAssistant() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [voiceState,     setVoiceState]     = useState<VoiceState>('idle');
  const [bubbles,        setBubbles]        = useState<Bubble[]>([]);
  const [error,          setError]          = useState<string | null>(null);
  const [statusOverride, setStatusOverride] = useState<string | null>(null);

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
  const lastReplyRef       = useRef('');

  // ── Refs — silence detection ───────────────────────────────────────────────
  const silenceAudioCtxRef       = useRef<AudioContext | null>(null);
  const silenceDetectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noSpeechTimeoutRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechDetectedRef        = useRef(false);   // ref for use inside interval callback
  const silenceStartRef          = useRef<number | null>(null);

  // ── Refs — speaking interruption detector ─────────────────────────────────
  const interruptAudioCtxRef    = useRef<AudioContext | null>(null);
  const interruptIntervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const interruptStreamRef      = useRef<MediaStream | null>(null);
  const interruptSpeechStartRef = useRef<number | null>(null);
  const interruptHandledRef     = useRef(false);

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
    selectedAudioOutputDeviceId,
    setVoiceAssistantActive,
  } = useContext(AppContext);

  // Refs for device IDs — always current, safe inside async callbacks without deps.
  const selectedAudioInputIdRef  = useRef('default');
  const selectedAudioOutputIdRef = useRef('default');
  selectedAudioInputIdRef.current  = selectedAudioInputDeviceId;
  selectedAudioOutputIdRef.current = selectedAudioOutputDeviceId;

  // Keep voiceState ref in sync.
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);

  // Notify AppContext when voice assistant becomes active/idle so spoken
  // proactive suggestions skip playback while a voice session is in progress.
  useEffect(() => {
    setVoiceAssistantActive(voiceState !== 'idle');
  }, [voiceState, setVoiceAssistantActive]);

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
  }, []);

  // ── Speaking interruption detector cleanup ────────────────────────────────

  const stopSpeakingInterruptDetection = useCallback(() => {
    if (interruptIntervalRef.current !== null) {
      clearInterval(interruptIntervalRef.current);
      interruptIntervalRef.current = null;
    }
    if (interruptAudioCtxRef.current) {
      interruptAudioCtxRef.current.close().catch(() => {});
      interruptAudioCtxRef.current = null;
    }
    if (interruptStreamRef.current) {
      interruptStreamRef.current.getTracks().forEach((t) => t.stop());
      interruptStreamRef.current = null;
    }
    interruptSpeechStartRef.current = null;
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
      stopSpeakingInterruptDetection();
      stopPlayback();
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      if (returnTimer.current) { clearTimeout(returnTimer.current); returnTimer.current = null; }
      setVoiceState('idle');
      // startListening will call pauseWakeWord before mic acquisition
      setTimeout(() => startListeningRef.current(), 50);
    }
    // processing state: ignore — cannot interrupt a mid-pipeline request
  }, [wakeWordPending, clearWakeWordPending, stopPlayback, stopSpeakingInterruptDetection]);

  // ── Return to idle ─────────────────────────────────────────────────────────

  const returnToIdleFlow = useCallback(() => {
    setVoiceState('idle');
    returnToIdle();
    resumeWakeWord();
  }, [returnToIdle, resumeWakeWord]);

  // ── Didn't-hear retry helper ───────────────────────────────────────────────
  //
  // Called from every "I didn't catch that" branch in processAudio.
  // - continuous mode ON  → show message, then retry listening (no idle return)
  // - continuous mode OFF → show message, then return to idle as before

  const handleDidntHear = useCallback(async (signal: AbortSignal) => {
    triggerEvent('didnt_hear');
    setStatusOverride('Duyamadım, tekrar söyler misiniz?');
    await sleep(2200, signal);
    setStatusOverride(null);
    if (signal.aborted) return;
    if (continuousConversationRef.current) {
      // Brief gap so the mic is fully released before re-acquisition.
      await sleep(200, signal);
      if (!signal.aborted) startListeningRef.current();
    } else {
      returnToIdleFlow();
    }
  }, [triggerEvent, returnToIdleFlow, continuousConversationRef]);

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
      stopSpeakingInterruptDetection();
      // Reset animation engine so it never stays stuck in a speaking/talking
      // state when the user navigates away from the Voice Assistant page while
      // TTS is active.  stopPlayback() already nulled onended, so the normal
      // conversation_finished → returnToIdle path will never run; call it here
      // explicitly instead.
      returnToIdle();
      resumeWakeWord();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cancel ─────────────────────────────────────────────────────────────────

  const cancelVoice = useCallback(() => {
    cancelledRef.current = true;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    stopSilenceDetection();
    stopSpeakingInterruptDetection();

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
  }, [returnToIdle, resumeWakeWord, stopPlayback, stopSilenceDetection, stopSpeakingInterruptDetection]);

  // ── Speaking interruption detector — start ────────────────────────────────
  //
  // Acquires a separate mic stream to monitor for user speech while Sadık is
  // playing TTS.  Higher RMS threshold (0.03) + sustained duration (300 ms)
  // prevent Sadık's own speaker output from triggering a false interrupt.

  const startSpeakingInterruptDetection = useCallback(() => {
    interruptHandledRef.current = false;

    const interruptConstraints: MediaStreamConstraints = {
      audio: selectedAudioInputIdRef.current === 'default'
        ? true
        : { deviceId: { exact: selectedAudioInputIdRef.current } },
    };
    const acquireInterruptMic = () =>
      navigator.mediaDevices.getUserMedia(interruptConstraints).catch((e) => {
        if (selectedAudioInputIdRef.current !== 'default') {
          console.warn('[Voice] Speaking interrupt: selected device failed, falling back to default:', e);
          return navigator.mediaDevices.getUserMedia({ audio: true });
        }
        throw e;
      });

    acquireInterruptMic().then((stream) => {
      // Guard: if we're no longer speaking by the time mic is ready, bail out.
      if (voiceStateRef.current !== 'speaking') {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      interruptStreamRef.current = stream;

      try {
        const audioCtx = new AudioContext();
        interruptAudioCtxRef.current = audioCtx;

        const source   = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        const bufLen  = analyser.fftSize;
        const dataArr = new Float32Array(bufLen);

        interruptIntervalRef.current = setInterval(() => {
          // Bail if detector was stopped or interrupt already handled.
          if (!interruptAudioCtxRef.current || interruptHandledRef.current) return;

          analyser.getFloatTimeDomainData(dataArr);
          let sumSq = 0;
          for (let i = 0; i < bufLen; i++) sumSq += dataArr[i] * dataArr[i];
          const rms = Math.sqrt(sumSq / bufLen);

          if (rms > INTERRUPT_THRESHOLD) {
            if (interruptSpeechStartRef.current === null) {
              interruptSpeechStartRef.current = Date.now();
            } else if (Date.now() - interruptSpeechStartRef.current >= INTERRUPT_SUSTAIN_MS) {
              // Sustained user speech detected — interrupt TTS playback.
              interruptHandledRef.current = true;
              console.log('[Voice] Direct speech interruption detected');

              stopSpeakingInterruptDetection();
              stopPlayback();
              abortControllerRef.current?.abort();
              abortControllerRef.current = null;
              if (returnTimer.current) { clearTimeout(returnTimer.current); returnTimer.current = null; }

              setVoiceState('idle');
              // Small delay so mic stream is fully released before re-acquisition.
              setTimeout(() => startListeningRef.current(), 200);
            }
          } else {
            // Energy dropped — reset the sustain timer.
            interruptSpeechStartRef.current = null;
          }
        }, 100);
      } catch (e) {
        console.warn('[Voice] Speaking interrupt detection setup failed:', e);
        stream.getTracks().forEach((t) => t.stop());
        interruptStreamRef.current = null;
      }
    }).catch((e) => {
      console.warn('[Voice] Speaking interrupt detection: mic access failed:', e);
    });
  }, [stopSpeakingInterruptDetection, stopPlayback]);

  // ── Audio pipeline ────────────────────────────────────────────────────────
  //
  // Animation event sequence (matches eventMapping.ts):
  //   processing             → thinking      (loops: STT + LLM + TTS fetch)
  //   understanding_resolved → understanding (fires after TTS blob ready, ≥250 ms)
  //   assistant_speaking     → talking       (loops: audio plays)
  //   conversation_finished  → goodbye_to_idle (fires: audio ended)
  //
  // Key invariant: understanding_resolved fires only when audio is already in
  // hand, so the understanding clip leads directly into speaking and the engine
  // never has an opportunity to return to idle between the two events.

  const processAudio = useCallback(async (blob: Blob, signal: AbortSignal) => {
    setVoiceState('processing');
    triggerEvent('processing');   // thinking — loops until understanding_resolved

    try {
      // ── Step 0a: Blob size guard ──────────────────────────────────────────
      // Guard against empty or suspiciously tiny blobs before hitting STT.
      if (blob.size < 1000) {
        console.warn('[Voice] Invalid or empty audio blob, skipping STT', { size: blob.size, type: blob.type });
        await handleDidntHear(signal);
        return;
      }

      // ── Step 0b: Energy gate ──────────────────────────────────────────────
      const hasEnergy = await hasAudioEnergy(blob);
      if (!hasEnergy) {
        await handleDidntHear(signal);
        return;
      }

      // ── Step 1: STT ───────────────────────────────────────────────────────
      const text = await voiceApi.stt(blob, signal);
      if (signal.aborted) return;

      // ── Step 2: Validate transcript ───────────────────────────────────────
      const trimmed   = text.trim();
      const wordCount = trimmed.split(/\s+/).filter((w) => w.length > 1).length;

      if (trimmed.length < 2 || wordCount < 1) {
        await handleDidntHear(signal);
        return;
      }

      // ── Step 2b: Reject noise artifacts and accidental wake-name re-triggers ─
      //
      // Guards applied in sequence (all resolve to "didn't hear"):
      //
      //   G1  All-punctuation — Whisper hallucination on near-silence
      //       ("...", ".", "♪" etc. — no alphabetic content at all).
      //
      //   G2  Single-word wake name — user re-said "Sadık" or "Sağdık" into
      //       the open mic with no actual command. Covers the TTS-trained
      //       "Sağdık" pronunciation form ("sagdik" after normalisation).
      //
      //   G3  Two-word attention-call + wake name — "hey Sadık", "merhaba Sağdık"
      //       etc. in the follow-up turn mean the user called the name again
      //       without adding a real command; treat the same as G2.

      const hasLetter = /[a-zA-ZğüşıöçĞÜŞİÖÇ]/.test(trimmed);
      if (!hasLetter) {
        // G1 — no alphabetic content at all
        await handleDidntHear(signal);
        return;
      }

      // Normalised standalone forms of the assistant name, covering all known
      // Whisper transcription variants and both pronunciation forms.
      // 'sagdik' is the normalizeTR form of "Sağdık" — must be listed because
      // 'sadik' is NOT a substring of 'sagdik' (the ğ→g shifts character positions).
      const SOLO_WAKE_FORMS = ['sadik', 'sagdik', 'saddik', 'sadiq', 'sadick', 'sadig', 'sadika'];

      // Inline Turkish normalisation used for single-word comparison.
      const normWord = (w: string) =>
        w.toLowerCase()
          .replace(/ı/g, 'i').replace(/İ/gi, 'i')
          .replace(/ş/g, 's').replace(/ğ/g, 'g')
          .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
          .replace(/[^a-z]/g, '');

      // G2 — sole word is the wake name (with or without trailing punctuation)
      if (wordCount === 1) {
        if (SOLO_WAKE_FORMS.includes(normWord(trimmed.split(/\s+/)[0]))) {
          await handleDidntHear(signal);
          return;
        }
      }

      // G3 — two-word "attention call + wake name" with no real command
      //   wordCount === 2 ensures neither word is a single character (both pass
      //   the length > 1 filter), so this doesn't fire on e.g. "a Sadık".
      if (wordCount === 2) {
        const parts = trimmed.split(/\s+/);
        if (parts.length === 2) {
          const w0 = parts[0].toLowerCase().replace(/[^a-z]/g, '');
          const w1 = normWord(parts[1]);
          const ATTENTION_CALLS = ['hey', 'ey', 'ah', 'merhaba', 'selam', 'alo'];
          if (ATTENTION_CALLS.includes(w0) && SOLO_WAKE_FORMS.includes(w1)) {
            await handleDidntHear(signal);
            return;
          }
        }
      }

      setBubbles((p) => [...p, { role: 'user', text: trimmed }]);

      // ── Step 3: LLM ───────────────────────────────────────────────────────
      // Thinking animation continues looping — no event change during LLM wait.
      const res = await chatApi.sendMessage(trimmed, true, signal);
      if (signal.aborted) return;

      const reply = res.response;
      setBubbles((p) => [...p, { role: 'assistant', text: reply }]);

      // ── Step 4: TTS fetch ─────────────────────────────────────────────────
      // Keep the thinking animation looping throughout TTS generation.
      // understanding_resolved fires only after the audio blob is ready so the
      // understanding clip flows directly into speaking — the engine never has a
      // chance to return to idle between the two events.
      const audioBlob = await voiceApi.tts(prepareTtsText(reply), signal);
      if (signal.aborted) return;

      // ── Step 5: Understanding flash → speaking ────────────────────────────
      // Audio is in hand — flash understanding briefly then begin playback.
      triggerEvent('understanding_resolved');
      await sleep(450, signal);          // hold understanding clip ≥ 450 ms
      if (signal.aborted) return;

      setVoiceState('speaking');
      triggerEvent('assistant_speaking');   // talking animation — loops while audio plays

      const url   = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      audioRef.current = audio;
      lastReplyRef.current = reply;

      // Route to selected output device if the browser supports setSinkId.
      if (selectedAudioOutputIdRef.current !== 'default') {
        const audioWithSink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        if (typeof audioWithSink.setSinkId === 'function') {
          try {
            await audioWithSink.setSinkId(selectedAudioOutputIdRef.current);
          } catch (e) {
            console.warn('[Voice] setSinkId failed, using default output:', e);
          }
        }
      }

      audio.onended = () => {
        URL.revokeObjectURL(url);
        stopSpeakingInterruptDetection();
        if (continuousConversationRef.current && !isConversationEnding(lastReplyRef.current)) {
          // Continuous mode: loop straight back to listening — no goodbye animation.
          triggerEvent('user_speaking');
          setTimeout(() => startListeningRef.current(), 150);
        } else {
          // Normal mode or conversation-ending response: goodbye animation → idle.
          triggerEvent('conversation_finished');  // goodbye_to_idle animation
          // Pause wake word; returnToIdleFlow re-arms it with its 800 ms delay.
          pauseWakeWord();
          if (returnTimer.current) clearTimeout(returnTimer.current);
          returnTimer.current = setTimeout(() => returnToIdleFlow(), 1200);
        }
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        stopSpeakingInterruptDetection();
        returnToIdleFlow();
      };

      await audio.play();

      // Re-arm wake word during TTS playback so barge-in is possible.
      // resumeWakeWord has an internal 800 ms delay before restarting the service.
      resumeWakeWord();

      // Speaking interrupt detection disabled (safe mode):
      // startSpeakingInterruptDetection() opens getUserMedia + new AudioContext()
      // simultaneously, which causes the same WASAPI concurrent-session crash as
      // the silence detector.  User can interrupt TTS via the Stop (X) button.

    } catch (e: unknown) {
      if (isCancelled(e) || signal.aborted) return;

      const msg = e instanceof Error ? e.message : 'Bir hata oluştu';
      setError(msg);
      triggerEvent('soft_error');
      setTimeout(() => returnToIdleFlow(), 2000);
      setVoiceState('idle');
    }
  }, [triggerEvent, returnToIdleFlow, pauseWakeWord, resumeWakeWord, continuousConversationRef, handleDidntHear, stopSpeakingInterruptDetection]);

  // ── Start listening ────────────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    setError(null);
    cancelledRef.current  = false;
    // Pause global wake word BEFORE acquiring mic — two services cannot share mic.
    pauseWakeWord();

    try {
      const mimeType = getSupportedMimeType();

      // Fire waking animation before getUserMedia — mic acquisition takes ~300ms,
      // during which the animation plays naturally.  Transition to listening
      // immediately after the mic is ready rather than via a fixed timer.
      triggerEvent('wake_word_detected');

      const stream = await (async () => {
        const audioConstraints: boolean | MediaTrackConstraints =
          selectedAudioInputIdRef.current === 'default'
            ? true
            : { deviceId: { exact: selectedAudioInputIdRef.current } };
        try {
          return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        } catch {
          if (selectedAudioInputIdRef.current !== 'default') {
            console.warn('[Voice] Selected mic device unavailable, falling back to default');
            return await navigator.mediaDevices.getUserMedia({ audio: true });
          }
          throw new Error('Mikrofon erişimi reddedildi');
        }
      })();
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

      // ── Silence detection: disabled (Windows audio driver safe mode) ────────
      //
      // new AudioContext() opens a WASAPI render device while MediaRecorder holds
      // a WASAPI capture session.  On this Windows audio driver that dual concurrent
      // WASAPI access causes STATUS_ACCESS_VIOLATION (exitCode -1073741819), crashing
      // the Electron renderer.
      //
      // Auto-stop is provided by the timeout below.
      // Manual stop: user clicks the Stop (X) button.
      speechDetectedRef.current = false;
      silenceStartRef.current   = null;
      console.log('[Voice] Recording started — manual stop mode (timeout: ' + NO_SPEECH_TIMEOUT_MS + 'ms)');

      // Hard timeout: caps recording at NO_SPEECH_TIMEOUT_MS.
      // Without silence detection speechDetectedRef is never set, so this always
      // fires — providing a guaranteed auto-stop.
      noSpeechTimeoutRef.current = setTimeout(() => {
        console.log('[Voice] Recording timeout, auto-stopping');
        stopSilenceDetection();
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
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

  // Listening hint — user must press the mic button to stop and send.
  const listeningHint = 'Konuşun, bitince mikrofona basın';

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
            {isSpeaking ? '— Dur\'a bas' : isListening ? '— İptal için X' : '— İptal\'e bas'}
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
