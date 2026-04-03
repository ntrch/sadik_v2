import React, { createContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { PomodoroState } from '../api/pomodoro';
import { DeviceStatus } from '../api/device';
import { modesApi } from '../api/modes';
import { deviceApi } from '../api/device';
import { pomodoroApi } from '../api/pomodoro';
import { settingsApi } from '../api/settings';
import { wakeWordService } from '../services/wakeWordService';
import { useWebSocket, WSMessage } from '../hooks/useWebSocket';
import { useAnimationEngine } from '../hooks/useAnimationEngine';
import { EngineState, AnimationEventType } from '../engine/types';

interface AppContextType {
  currentMode: string | null;
  setCurrentMode: (mode: string | null) => void;
  deviceStatus: DeviceStatus;
  setDeviceStatus: (status: DeviceStatus) => void;
  pomodoroState: PomodoroState;
  setPomodoroState: (state: PomodoroState) => void;
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  engineState: EngineState;
  triggerEvent: (event: AnimationEventType, payload?: { text?: string }) => void;
  showText: (text: string) => void;
  returnToIdle: () => void;
  playClipDirect: (name: string) => void;
  getLoadedClipNames: () => string[];
  frameBuffer: Uint8Array;
  frameVersion: number;
  // Wake word
  wakeWordEnabled: boolean;
  wakeWordActive: boolean;
  wakeWordPending: boolean;
  wakeWordSensitivity: string;
  startWakeWord: () => void;
  stopWakeWord: () => void;
  pauseWakeWord: () => void;
  resumeWakeWord: () => void;
  toggleWakeWord: () => void;
  clearWakeWordPending: () => void;
  setWakeWordSensitivity: (level: string) => void;
  // Continuous conversation
  continuousConversation: boolean;
  continuousConversationRef: React.MutableRefObject<boolean>;
  setContinuousConversation: (value: boolean) => void;
}

const defaultPomodoroState: PomodoroState = {
  is_running: false,
  is_paused: false,
  remaining_seconds: 0,
  total_seconds: 0,
  current_session: 0,
  task_id: null,
  phase: 'idle',
};

const defaultDeviceStatus: DeviceStatus = {
  connected: false,
  method: null,
  port: null,
  ip: null,
};

const defaultEngineState: EngineState = {
  playbackMode: 'text',
  currentClipName: null,
  currentFrameIndex: 0,
  totalFrames: 0,
  isPlaying: false,
  idleSubState: 'idle_loop',
  textContent: 'SADIK',
  fps: 12,
};

export const AppContext = createContext<AppContextType>({
  currentMode: null,
  setCurrentMode: () => {},
  deviceStatus: defaultDeviceStatus,
  setDeviceStatus: () => {},
  pomodoroState: defaultPomodoroState,
  setPomodoroState: () => {},
  toast: null,
  showToast: () => {},
  engineState: defaultEngineState,
  triggerEvent: () => {},
  showText: () => {},
  returnToIdle: () => {},
  playClipDirect: () => {},
  getLoadedClipNames: () => [],
  frameBuffer: new Uint8Array(1024),
  frameVersion: 0,
  wakeWordEnabled: false,
  wakeWordActive: false,
  wakeWordPending: false,
  wakeWordSensitivity: 'normal',
  startWakeWord: () => {},
  stopWakeWord: () => {},
  pauseWakeWord: () => {},
  resumeWakeWord: () => {},
  toggleWakeWord: () => {},
  clearWakeWordPending: () => {},
  setWakeWordSensitivity: () => {},
  continuousConversation: false,
  continuousConversationRef: { current: false },
  setContinuousConversation: () => {},
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentMode, setCurrentMode] = useState<string | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>(defaultDeviceStatus);
  const [pomodoroState, setPomodoroState] = useState<PomodoroState>(defaultPomodoroState);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [wakeWordEnabled,     setWakeWordEnabled]     = useState(false);
  const [wakeWordActive,      setWakeWordActive]      = useState(false);
  const [wakeWordPending,     setWakeWordPending]     = useState(false);
  const [wakeWordSensitivity, setWakeWordSensitivityState] = useState('normal');
  const [continuousConversation, setContinuousConversationState] = useState(false);

  // Refs mirror state — avoids stale closures in callbacks.
  // All are updated on every render so they are always current.
  const wakeWordEnabledRef       = useRef(false);
  const wakeWordSensitivityRef   = useRef('normal');
  const continuousConversationRef = useRef(false);
  wakeWordEnabledRef.current       = wakeWordEnabled;
  wakeWordSensitivityRef.current   = wakeWordSensitivity;
  continuousConversationRef.current = continuousConversation;

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const {
    engineState,
    frameBuffer,
    frameVersion,
    triggerEvent,
    showText,
    returnToIdle,
    playClipDirect,
    getLoadedClipNames,
  } = useAnimationEngine(deviceStatus.connected);

  // ── Wake word functions ────────────────────────────────────────────────────

  const startWakeWord = useCallback(() => {
    wakeWordService.start(
      () => {
        setWakeWordPending(true);
        triggerEvent('wake_word_detected');
      },
      (msg) => console.warn('[WakeWord] Error:', msg),
      (active) => setWakeWordActive(active),
    );
  }, [triggerEvent]);

  // Stable ref to startWakeWord — always current, safe for async callbacks.
  const startWakeWordRef = useRef(startWakeWord);
  startWakeWordRef.current = startWakeWord;

  const stopWakeWord = useCallback(() => {
    wakeWordService.stop();
    setWakeWordActive(false);
  }, []);

  const pauseWakeWord = useCallback(() => {
    wakeWordService.stop();
    setWakeWordActive(false);
  }, []);

  /** Re-arm detection 800 ms after a voice turn ends. Uses refs — never stale. */
  const resumeWakeWord = useCallback(() => {
    if (!wakeWordEnabledRef.current) return;
    console.log('[WakeWord] Resuming in 400 ms...');
    setTimeout(() => {
      if (!wakeWordEnabledRef.current) return;
      startWakeWordRef.current();
    }, 400);
  }, []);

  const toggleWakeWord = useCallback(async () => {
    const next = !wakeWordEnabledRef.current;
    // Update ref immediately so resumeWakeWord cannot race during async persist.
    wakeWordEnabledRef.current = next;
    setWakeWordEnabled(next);
    try {
      await settingsApi.update({ wake_word_enabled: String(next) });
      showToast(
        next ? 'Uyandırma kelimesi aktif' : 'Uyandırma kelimesi devre dışı',
        'info',
      );
    } catch { /* best-effort */ }
    if (next) {
      startWakeWordRef.current();
    } else {
      wakeWordService.stop();
      setWakeWordActive(false);
    }
  }, [showToast]);

  const clearWakeWordPending = useCallback(() => {
    setWakeWordPending(false);
  }, []);

  const setWakeWordSensitivity = useCallback(async (level: string) => {
    wakeWordSensitivityRef.current = level;
    setWakeWordSensitivityState(level);
    wakeWordService.setSensitivity(level);
    try {
      await settingsApi.update({ wake_word_sensitivity: level });
    } catch { /* best-effort */ }
  }, []);

  const setContinuousConversation = useCallback(async (value: boolean) => {
    continuousConversationRef.current = value;
    setContinuousConversationState(value);
    try {
      await settingsApi.update({ continuous_conversation: String(value) });
    } catch { /* best-effort */ }
  }, []);

  // ── Initial data load + wake word bootstrap ────────────────────────────────

  useEffect(() => {
    modesApi.getCurrent().then((m) => setCurrentMode(m.mode)).catch(() => {});
    deviceApi.getStatus().then(setDeviceStatus).catch(() => {});
    pomodoroApi.getState().then(setPomodoroState).catch(() => {});
    settingsApi.getAll()
      .then((s) => {
        const enabled              = s['wake_word_enabled'] !== 'false';
        const sensitivity          = s['wake_word_sensitivity'] ?? 'normal';
        const continuous           = s['continuous_conversation'] === 'true';
        wakeWordEnabledRef.current       = enabled;
        wakeWordSensitivityRef.current   = sensitivity;
        continuousConversationRef.current = continuous;
        setWakeWordEnabled(enabled);
        setWakeWordSensitivityState(sensitivity);
        setContinuousConversationState(continuous);
        wakeWordService.setSensitivity(sensitivity);
        if (enabled) startWakeWordRef.current();
      })
      .catch(() => {});
  }, []);

  // ── Global page-close safety net ───────────────────────────────────────────
  useEffect(() => {
    const handleUnload = () => {
      wakeWordService.stop();
      fetch('http://localhost:8000/api/device/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'RETURN_TO_IDLE' }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      wakeWordService.stop();
    };
  }, []);

  const handleWSMessage = useCallback(
    (msg: WSMessage) => {
      switch (msg.type) {
        case 'timer_tick': {
          const remaining = msg.data.remaining_seconds as number;
          const isRunning = msg.data.is_running as boolean;
          setPomodoroState((prev) => ({
            ...prev,
            remaining_seconds: remaining,
            total_seconds: msg.data.total_seconds as number,
            is_running: isRunning,
            phase: msg.data.phase as PomodoroState['phase'],
          }));
          if (isRunning) {
            const mins = Math.floor(remaining / 60).toString().padStart(2, '0');
            const secs = (remaining % 60).toString().padStart(2, '0');
            showText(`${mins}:${secs}`);
          }
          break;
        }
        case 'mode_changed':
          setCurrentMode(msg.data.mode as string);
          break;
        case 'device_status':
          setDeviceStatus(msg.data as unknown as DeviceStatus);
          break;
        case 'pomodoro_completed':
          showToast('Pomodoro oturumu tamamlandı!', 'success');
          showText('TAMAMLANDI!');
          setTimeout(() => returnToIdle(), 3000);
          break;
      }
    },
    [showToast, showText, returnToIdle]
  );

  useWebSocket(handleWSMessage);

  return (
    <AppContext.Provider
      value={{
        currentMode,
        setCurrentMode,
        deviceStatus,
        setDeviceStatus,
        pomodoroState,
        setPomodoroState,
        toast,
        showToast,
        engineState,
        triggerEvent,
        showText,
        returnToIdle,
        playClipDirect,
        getLoadedClipNames,
        frameBuffer,
        frameVersion,
        wakeWordEnabled,
        wakeWordActive,
        wakeWordPending,
        wakeWordSensitivity,
        startWakeWord,
        stopWakeWord,
        pauseWakeWord,
        resumeWakeWord,
        toggleWakeWord,
        clearWakeWordPending,
        setWakeWordSensitivity,
        continuousConversation,
        continuousConversationRef,
        setContinuousConversation,
      }}
    >
      {children}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-btn text-sm font-medium shadow-lg animate-fade-in transition-all
            ${toast.type === 'success' ? 'bg-accent-green text-white' :
              toast.type === 'error' ? 'bg-accent-red text-white' :
              'bg-accent-blue text-white'}`}
        >
          {toast.message}
        </div>
      )}
    </AppContext.Provider>
  );
}
