import React, { createContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { PomodoroState } from '../api/pomodoro';
import { DeviceStatus } from '../api/device';
import { modesApi } from '../api/modes';
import { deviceApi } from '../api/device';
import { pomodoroApi } from '../api/pomodoro';
import { settingsApi } from '../api/settings';
import { statsApi, AppInsight } from '../api/stats';
import { tasksApi } from '../api/tasks';
import { voiceApi } from '../api/voice';
import { wakeWordService } from '../services/wakeWordService';
import { useWebSocket, WSMessage } from '../hooks/useWebSocket';
import { useAnimationEngine } from '../hooks/useAnimationEngine';
import { EngineState, AnimationEventType } from '../engine/types';

interface AppContextType {
  currentMode: string | null;
  setCurrentMode: (mode: string | null) => void;
  deviceStatus: DeviceStatus;
  setDeviceStatus: (status: DeviceStatus) => void;
  autoConnectDevice: () => Promise<void>;
  oledBrightnessPercent: number;
  setOledBrightness: (percent: number) => Promise<void>;
  oledSleepTimeoutMinutes: number;
  setOledSleepTimeout: (minutes: number) => Promise<void>;
  pomodoroState: PomodoroState;
  setPomodoroState: (state: PomodoroState) => void;
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  engineState: EngineState;
  triggerEvent: (event: AnimationEventType, payload?: { text?: string }) => void;
  showText: (text: string) => void;
  returnToIdle: () => void;
  playClipDirect: (name: string) => void;
  playModClip: (name: string) => void;
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
  // Audio devices
  audioInputDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  selectedAudioInputDeviceId: string;
  selectedAudioOutputDeviceId: string;
  setSelectedAudioInputDeviceId: (id: string) => Promise<void>;
  setSelectedAudioOutputDeviceId: (id: string) => Promise<void>;
  refreshAudioDevices: () => Promise<void>;
  // Proactive insights
  activeInsight: AppInsight | null;
  acceptInsight: () => Promise<void>;
  denyInsight: () => void;
  // Proactive suggestion controls
  proactiveSuggestionsEnabled: boolean;
  setProactiveSuggestionsEnabled: (value: boolean) => Promise<void>;
  proactiveQuietHoursStart: string;
  setProactiveQuietHoursStart: (value: string) => Promise<void>;
  proactiveQuietHoursEnd: string;
  setProactiveQuietHoursEnd: (value: string) => Promise<void>;
  proactiveDailyLimit: number;
  setProactiveDailyLimit: (value: number) => Promise<void>;
  proactiveCooldownMinutes: number;
  setProactiveCooldownMinutes: (value: number) => Promise<void>;
  // Spoken proactive suggestions
  spokenProactiveEnabled: boolean;
  setSpokenProactiveEnabled: (value: boolean) => Promise<void>;
  spokenProactiveDailyLimit: number;
  setSpokenProactiveDailyLimit: (value: number) => Promise<void>;
  /** Called by VoiceAssistant when voiceState changes — gates spoken proactive playback. */
  setVoiceAssistantActive: (active: boolean) => void;
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
  autoConnectDevice: async () => {},
  oledBrightnessPercent: 70,
  setOledBrightness: async () => {},
  oledSleepTimeoutMinutes: 10,
  setOledSleepTimeout: async () => {},
  pomodoroState: defaultPomodoroState,
  setPomodoroState: () => {},
  toast: null,
  showToast: () => {},
  engineState: defaultEngineState,
  triggerEvent: () => {},
  showText: () => {},
  returnToIdle: () => {},
  playClipDirect: () => {},
  playModClip: () => {},
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
  audioInputDevices: [],
  audioOutputDevices: [],
  selectedAudioInputDeviceId: 'default',
  selectedAudioOutputDeviceId: 'default',
  setSelectedAudioInputDeviceId: async () => {},
  setSelectedAudioOutputDeviceId: async () => {},
  refreshAudioDevices: async () => {},
  activeInsight: null,
  acceptInsight: async () => {},
  denyInsight: () => {},
  proactiveSuggestionsEnabled: true,
  setProactiveSuggestionsEnabled: async () => {},
  proactiveQuietHoursStart: '23:00',
  setProactiveQuietHoursStart: async () => {},
  proactiveQuietHoursEnd: '08:00',
  setProactiveQuietHoursEnd: async () => {},
  proactiveDailyLimit: 3,
  setProactiveDailyLimit: async () => {},
  proactiveCooldownMinutes: 60,
  setProactiveCooldownMinutes: async () => {},
  spokenProactiveEnabled: true,
  setSpokenProactiveEnabled: async () => {},
  spokenProactiveDailyLimit: 1,
  setSpokenProactiveDailyLimit: async () => {},
  setVoiceAssistantActive: () => {},
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentMode, setCurrentMode] = useState<string | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>(defaultDeviceStatus);
  const [pomodoroState, setPomodoroState] = useState<PomodoroState>(defaultPomodoroState);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [oledBrightnessPercent, setOledBrightnessPercent] = useState(70);
  const oledBrightnessRef = useRef(70);
  oledBrightnessRef.current = oledBrightnessPercent;

  const [oledSleepTimeoutMinutes, setOledSleepTimeoutMinutes] = useState(10);
  const oledSleepTimeoutRef = useRef(10);
  oledSleepTimeoutRef.current = oledSleepTimeoutMinutes;

  const [wakeWordEnabled,     setWakeWordEnabled]     = useState(false);
  const [wakeWordActive,      setWakeWordActive]      = useState(false);
  const [wakeWordPending,     setWakeWordPending]     = useState(false);
  const [wakeWordSensitivity, setWakeWordSensitivityState] = useState('normal');
  const [continuousConversation, setContinuousConversationState] = useState(false);

  // Audio device state
  const [audioInputDevices,  setAudioInputDevices]  = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInputDeviceId,  setSelectedAudioInputDeviceIdState]  = useState('default');
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceIdState] = useState('default');

  // Proactive insight state
  const [activeInsight, setActiveInsight] = useState<AppInsight | null>(null);
  const activeInsightRef = useRef<AppInsight | null>(null);
  activeInsightRef.current = activeInsight;

  // Proactive suggestion controls state
  const [proactiveSuggestionsEnabled, setProactiveSuggestionsEnabledState] = useState(true);
  const [proactiveQuietHoursStart, setProactiveQuietHoursStartState]       = useState('23:00');
  const [proactiveQuietHoursEnd, setProactiveQuietHoursEndState]           = useState('08:00');
  const [proactiveDailyLimit, setProactiveDailyLimitState]                 = useState(3);
  const [proactiveCooldownMinutes, setProactiveCooldownMinutesState]       = useState(60);

  // Spoken proactive state
  const [spokenProactiveEnabled, setSpokenProactiveEnabledState]       = useState(true);
  const [spokenProactiveDailyLimit, setSpokenProactiveDailyLimitState] = useState(1);

  // Refs mirror state — avoids stale closures in callbacks.
  // All are updated on every render so they are always current.
  const wakeWordEnabledRef       = useRef(false);
  const wakeWordSensitivityRef   = useRef('normal');
  const continuousConversationRef = useRef(false);
  const audioInputDeviceIdRef    = useRef('default');
  const audioOutputDeviceIdRef   = useRef('default');
  const wakeWordResumeTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  wakeWordEnabledRef.current       = wakeWordEnabled;
  wakeWordSensitivityRef.current   = wakeWordSensitivity;
  continuousConversationRef.current = continuousConversation;
  audioInputDeviceIdRef.current    = selectedAudioInputDeviceId;
  audioOutputDeviceIdRef.current   = selectedAudioOutputDeviceId;

  // Proactive suggestion control refs — always current, safe for setInterval closures
  const proactiveSuggestionsEnabledRef = useRef(true);
  const proactiveQuietHoursStartRef    = useRef('23:00');
  const proactiveQuietHoursEndRef      = useRef('08:00');
  const proactiveDailyLimitRef         = useRef(3);
  const proactiveCooldownMinutesRef    = useRef(60);
  const pomodoroStateRef               = useRef(pomodoroState);
  // Spoken proactive refs — always current, safe for setInterval closures
  const spokenProactiveEnabledRef    = useRef(true);
  const spokenProactiveDailyLimitRef = useRef(1);
  /** Set to true by VoiceAssistant when voiceState !== 'idle'; gates spoken proactive. */
  const voiceAssistantActiveRef      = useRef(false);
  /** Set to true while proactive TTS audio is playing; prevents stacking. */
  const isProactiveSpeakingRef       = useRef(false);
  // Separate daily counter for spoken proactive (independent of visual daily limit)
  const spokenDailyCountRef     = useRef(0);
  const spokenDailyCountDateRef = useRef('');
  spokenProactiveEnabledRef.current    = spokenProactiveEnabled;
  spokenProactiveDailyLimitRef.current = spokenProactiveDailyLimit;

  // Rate-limiting refs — in-memory, daily counter resets at midnight
  const lastShownTimestampRef = useRef<number | null>(null);
  const dailyCountRef         = useRef(0);
  const dailyCountDateRef     = useRef('');
  proactiveSuggestionsEnabledRef.current = proactiveSuggestionsEnabled;
  proactiveQuietHoursStartRef.current    = proactiveQuietHoursStart;
  proactiveQuietHoursEndRef.current      = proactiveQuietHoursEnd;
  proactiveDailyLimitRef.current         = proactiveDailyLimit;
  proactiveCooldownMinutesRef.current    = proactiveCooldownMinutes;
  pomodoroStateRef.current               = pomodoroState;

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const autoConnectDevice = useCallback(async () => {
    try {
      const result = await deviceApi.autoConnect();
      const status = await deviceApi.getStatus();
      setDeviceStatus(status);
      if (result.connected) {
        showToast(result.message || 'SADIK cihazı bağlandı', 'success');
      } else {
        showToast(result.message || 'Cihaz bulunamadı', 'error');
      }
    } catch {
      showToast('Otomatik bağlantı başarısız', 'error');
    }
  }, [showToast]);

  const setOledBrightness = useCallback(async (percent: number) => {
    const clamped = Math.max(0, Math.min(100, percent));
    setOledBrightnessPercent(clamped);
    oledBrightnessRef.current = clamped;
    try {
      await settingsApi.update({ oled_brightness_percent: String(clamped) });
    } catch { /* best-effort */ }
    if (deviceStatus.connected) {
      deviceApi.setBrightness(clamped).catch(() => {});
    }
  }, [deviceStatus.connected]);

  const setOledSleepTimeout = useCallback(async (minutes: number) => {
    const clamped = Math.max(0, minutes);
    setOledSleepTimeoutMinutes(clamped);
    oledSleepTimeoutRef.current = clamped;
    try {
      await settingsApi.update({ oled_sleep_timeout_minutes: String(clamped) });
    } catch { /* best-effort */ }
    if (deviceStatus.connected) {
      deviceApi.setSleepTimeout(clamped).catch(() => {});
    }
  }, [deviceStatus.connected]);

  const {
    engineState,
    frameBuffer,
    frameVersion,
    triggerEvent,
    showText,
    returnToIdle,
    playClipDirect,
    playModClip,
    getLoadedClipNames,
  } = useAnimationEngine(deviceStatus.connected);

  // ── Wake word functions ────────────────────────────────────────────────────

  const startWakeWord = useCallback(() => {
    wakeWordService.start(
      () => {
        setWakeWordPending(true);
        triggerEvent('wake_word_detected');
      },
      (msg) => {
        console.warn('[WakeWord] Error:', msg);
        showToast('Uyandırma kelimesi başlatılamadı — mikrofon kontrol edin', 'error');
      },
      (active) => setWakeWordActive(active),
    );
  }, [triggerEvent, showToast]);

  // Stable ref to startWakeWord — always current, safe for async callbacks.
  const startWakeWordRef = useRef(startWakeWord);
  startWakeWordRef.current = startWakeWord;

  const stopWakeWord = useCallback(() => {
    wakeWordService.stop();
    setWakeWordActive(false);
  }, []);

  const pauseWakeWord = useCallback(() => {
    // Cancel any pending resume timer to prevent the wake word service from
    // restarting during an active voice session.  On Windows WASAPI, a competing
    // getUserMedia call from the wake word service kills the persistent voice
    // stream's tracks.
    if (wakeWordResumeTimerRef.current !== null) {
      clearTimeout(wakeWordResumeTimerRef.current);
      wakeWordResumeTimerRef.current = null;
    }
    wakeWordService.stop();
    setWakeWordActive(false);
  }, []);

  /** Re-arm detection 400 ms after a voice turn ends. Uses refs — never stale. */
  const resumeWakeWord = useCallback(() => {
    if (!wakeWordEnabledRef.current) return;
    // Cancel any previous pending resume.
    if (wakeWordResumeTimerRef.current !== null) {
      clearTimeout(wakeWordResumeTimerRef.current);
    }
    console.log('[WakeWord] Resuming in 400 ms...');
    wakeWordResumeTimerRef.current = setTimeout(() => {
      wakeWordResumeTimerRef.current = null;
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

  // ── Audio device callbacks ─────────────────────────────────────────────────

  /** Enumerate available microphones and speakers; validates saved selections. */
  const refreshAudioDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs  = devices.filter((d) => d.kind === 'audioinput');
      const outputs = devices.filter((d) => d.kind === 'audiooutput');
      setAudioInputDevices(inputs);
      setAudioOutputDevices(outputs);
      // Validate saved input device — fall back to 'default' if gone
      if (
        audioInputDeviceIdRef.current !== 'default' &&
        !inputs.some((d) => d.deviceId === audioInputDeviceIdRef.current)
      ) {
        console.warn('[AudioDevices] Saved input device not found, falling back to default');
        audioInputDeviceIdRef.current = 'default';
        setSelectedAudioInputDeviceIdState('default');
        wakeWordService.setInputDeviceId('default');
      }
      // Validate saved output device
      if (
        audioOutputDeviceIdRef.current !== 'default' &&
        !outputs.some((d) => d.deviceId === audioOutputDeviceIdRef.current)
      ) {
        console.warn('[AudioDevices] Saved output device not found, falling back to default');
        audioOutputDeviceIdRef.current = 'default';
        setSelectedAudioOutputDeviceIdState('default');
      }
    } catch (e) {
      console.warn('[AudioDevices] enumerateDevices failed:', e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSelectedAudioInputDeviceId = useCallback(async (id: string) => {
    audioInputDeviceIdRef.current = id;
    setSelectedAudioInputDeviceIdState(id);
    wakeWordService.setInputDeviceId(id);
    // Restart wake word with the new device if it is currently enabled.
    // This ensures device selection changes take effect immediately and also
    // acts as a reliable recovery path when the service is stuck in a
    // non-active state (e.g. initial mic acquisition failed silently).
    if (wakeWordEnabledRef.current) {
      wakeWordService.stop();
      setWakeWordActive(false);
      setTimeout(() => {
        if (wakeWordEnabledRef.current) startWakeWordRef.current();
      }, 200);
    }
    try {
      await settingsApi.update({ audio_input_device_id: id });
    } catch { /* best-effort */ }
  }, []);

  const setSelectedAudioOutputDeviceId = useCallback(async (id: string) => {
    audioOutputDeviceIdRef.current = id;
    setSelectedAudioOutputDeviceIdState(id);
    try {
      await settingsApi.update({ audio_output_device_id: id });
    } catch { /* best-effort */ }
  }, []);

  // ── Proactive suggestion control callbacks ─────────────────────────────────

  const setProactiveSuggestionsEnabled = useCallback(async (value: boolean) => {
    proactiveSuggestionsEnabledRef.current = value;
    setProactiveSuggestionsEnabledState(value);
    try { await settingsApi.update({ proactive_suggestions_enabled: String(value) }); } catch { /* best-effort */ }
  }, []);

  const setProactiveQuietHoursStart = useCallback(async (value: string) => {
    proactiveQuietHoursStartRef.current = value;
    setProactiveQuietHoursStartState(value);
    try { await settingsApi.update({ proactive_quiet_hours_start: value }); } catch { /* best-effort */ }
  }, []);

  const setProactiveQuietHoursEnd = useCallback(async (value: string) => {
    proactiveQuietHoursEndRef.current = value;
    setProactiveQuietHoursEndState(value);
    try { await settingsApi.update({ proactive_quiet_hours_end: value }); } catch { /* best-effort */ }
  }, []);

  const setProactiveDailyLimit = useCallback(async (value: number) => {
    proactiveDailyLimitRef.current = value;
    setProactiveDailyLimitState(value);
    try { await settingsApi.update({ proactive_daily_limit: String(value) }); } catch { /* best-effort */ }
  }, []);

  const setProactiveCooldownMinutes = useCallback(async (value: number) => {
    proactiveCooldownMinutesRef.current = value;
    setProactiveCooldownMinutesState(value);
    try { await settingsApi.update({ proactive_cooldown_minutes: String(value) }); } catch { /* best-effort */ }
  }, []);

  const setSpokenProactiveEnabled = useCallback(async (value: boolean) => {
    spokenProactiveEnabledRef.current = value;
    setSpokenProactiveEnabledState(value);
    try { await settingsApi.update({ spoken_proactive_enabled: String(value) }); } catch { /* best-effort */ }
  }, []);

  const setSpokenProactiveDailyLimit = useCallback(async (value: number) => {
    spokenProactiveDailyLimitRef.current = value;
    setSpokenProactiveDailyLimitState(value);
    try { await settingsApi.update({ spoken_proactive_daily_limit: String(value) }); } catch { /* best-effort */ }
  }, []);

  /** Called by VoiceAssistant on every voiceState transition — no React state, ref-only. */
  const setVoiceAssistantActive = useCallback((active: boolean) => {
    voiceAssistantActiveRef.current = active;
  }, []);

  // ── Proactive insight polling ──────────────────────────────────────────────
  //
  // Polls GET /api/stats/app-usage/insights every 5 minutes.
  // Shows a toast + brief OLED text when a new or escalated insight arrives.
  // Deduplication key: app_name + level — same suggestion is never spammed.
  // The "latest ref" pattern ensures the interval closure is never stale.

  /** Key of the last insight that triggered a toast/OLED notification. */
  const lastShownInsightKeyRef = useRef<string | null>(null);
  /** Apps denied by the user in this session — skip them in rotation. */
  const deniedAppInsightsRef = useRef<Set<string>>(new Set());

  // These refs always point to the latest function instances so the
  // setInterval callback never captures a stale closure.
  const _showToastRef    = useRef(showToast);
  const _showTextRef     = useRef(showText);
  const _returnToIdleRef = useRef(returnToIdle);
  const acceptInsightRef = useRef<() => Promise<void>>(async () => {});
  _showToastRef.current    = showToast;
  _showTextRef.current     = showText;
  _returnToIdleRef.current = returnToIdle;

  /**
   * Play a short spoken proactive suggestion through the selected output device.
   * Manages its own OLED feedback and returns to idle when audio ends.
   * Never opens the mic or enters voice conversation flow.
   */
  const speakProactive = useCallback(async (text: string) => {
    if (isProactiveSpeakingRef.current) return;
    isProactiveSpeakingRef.current = true;
    try {
      const audioBlob = await voiceApi.tts(text);
      const url   = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);

      // Route to the user's selected speaker if the browser supports setSinkId
      if (audioOutputDeviceIdRef.current !== 'default') {
        const audioWithSink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        if (typeof audioWithSink.setSinkId === 'function') {
          try { await audioWithSink.setSinkId(audioOutputDeviceIdRef.current); } catch { /* best-effort */ }
        }
      }

      _showTextRef.current('MOLA!');

      audio.onended = () => {
        URL.revokeObjectURL(url);
        isProactiveSpeakingRef.current = false;
        _returnToIdleRef.current();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        isProactiveSpeakingRef.current = false;
      };
      await audio.play();
    } catch {
      isProactiveSpeakingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentional: reads all state through refs — no deps needed

  // Stable ref so the poll interval closure can call the latest instance
  const _speakProactiveRef = useRef(speakProactive);
  _speakProactiveRef.current = speakProactive;

  useEffect(() => {
    /** Returns true when the current time falls inside the quiet-hours window.
     *  Handles overnight ranges correctly (e.g. 23:00 → 08:00 wraps midnight). */
    const isInQuietHours = (start: string, end: string): boolean => {
      const now = new Date();
      const cur = now.getHours() * 60 + now.getMinutes();
      const [sh = 0, sm = 0] = start.split(':').map(Number);
      const [eh = 0, em = 0] = end.split(':').map(Number);
      const s = sh * 60 + sm;
      const e = eh * 60 + em;
      // Same-day window (e.g. 09:00 → 17:00)
      if (s <= e) return cur >= s && cur < e;
      // Overnight window (e.g. 23:00 → 08:00): active after start OR before end
      return cur >= s || cur < e;
    };

    const checkTaskInsight = async (): Promise<AppInsight | null> => {
      try {
        const tasks = await tasksApi.list();
        const now = Date.now();
        const activeTasks = tasks.filter(t => t.status === 'todo' || t.status === 'in_progress');

        // Check for overdue or approaching deadlines
        let bestInsight: AppInsight | null = null;
        for (const t of activeTasks) {
          if (!t.due_date) continue;
          const due = new Date(t.due_date).getTime();
          const diffMin = (due - now) / 60000;

          if (diffMin < 0) {
            // Overdue
            const overMin = Math.abs(diffMin);
            const msg = overMin > 60
              ? `"${t.title}" görevi ${Math.round(overMin / 60)} saattir gecikmiş durumda!`
              : `"${t.title}" görevi ${Math.round(overMin)} dakikadır gecikmiş!`;
            bestInsight = { has_insight: true, level: 'strong', message: msg, source: 'task' };
            break; // Overdue is highest priority
          } else if (diffMin <= 30) {
            bestInsight = { has_insight: true, level: 'strong', message: `"${t.title}" görevinin teslim süresi 30 dakikadan az!`, source: 'task' };
          } else if (diffMin <= 120 && !bestInsight) {
            const h = Math.floor(diffMin / 60);
            const m = Math.round(diffMin % 60);
            const timeStr = h > 0 ? `${h} saat ${m} dakika` : `${Math.round(diffMin)} dakika`;
            bestInsight = { has_insight: true, level: 'gentle', message: `"${t.title}" görevinin teslim süresine ${timeStr} kaldı.`, source: 'task' };
          }
        }
        return bestInsight;
      } catch {
        return null;
      }
    };

    const poll = async () => {
      try {
        const [appInsight, taskInsight] = await Promise.all([
          statsApi.appInsights(),
          checkTaskInsight(),
        ]);

        // Pick the first non-denied app insight from the full list
        let pickedAppInsight: AppInsight | null = null;
        if (appInsight.has_insight && appInsight.insights && appInsight.insights.length > 0) {
          const available = appInsight.insights.find(
            (i) => !deniedAppInsightsRef.current.has(i.app_name)
          );
          if (available) {
            pickedAppInsight = {
              has_insight: true,
              app_name: available.app_name,
              level: available.level,
              message: available.message,
              insights: appInsight.insights,
              source: 'app_usage',
            };
          }
        } else if (appInsight.has_insight && !deniedAppInsightsRef.current.has(appInsight.app_name ?? '')) {
          pickedAppInsight = { ...appInsight, source: 'app_usage' };
        }

        // Priority: strong task > app usage > gentle task
        let insight: AppInsight;
        if (taskInsight && taskInsight.level === 'strong') {
          insight = taskInsight;
        } else if (pickedAppInsight) {
          insight = pickedAppInsight;
        } else if (taskInsight) {
          insight = taskInsight;
        } else {
          setActiveInsight(null);
          lastShownInsightKeyRef.current = null;
          return;
        }

        // Always update the dashboard card — it shows regardless of suppression
        setActiveInsight(insight);

        // Deduplication — only notify when the insight is new or escalated
        const key = `${insight.source}:${insight.app_name ?? insight.message?.slice(0, 30)}:${insight.level}`;
        if (key === lastShownInsightKeyRef.current) return; // identical — already notified

        // ── Suppression rules (gate toast + OLED only) ────────────────────────

        // Rule A: feature disabled
        if (!proactiveSuggestionsEnabledRef.current) return;

        // Rule B: quiet hours (overnight-aware)
        if (isInQuietHours(proactiveQuietHoursStartRef.current, proactiveQuietHoursEndRef.current)) return;

        // Rule C: Pomodoro / focus suppression
        if (pomodoroStateRef.current.is_running) return;

        // Rule D: cooldown between suggestions
        const now = Date.now();
        const cooldownMs = proactiveCooldownMinutesRef.current * 60 * 1000;
        if (lastShownTimestampRef.current !== null && now - lastShownTimestampRef.current < cooldownMs) return;

        // Rule E: daily limit — reset counter at midnight
        const today = new Date().toDateString();
        if (dailyCountDateRef.current !== today) {
          dailyCountDateRef.current = today;
          dailyCountRef.current = 0;
        }
        if (dailyCountRef.current >= proactiveDailyLimitRef.current) return;

        // ── All rules passed — deliver notification ───────────────────────────
        lastShownInsightKeyRef.current = key;
        lastShownTimestampRef.current  = now;
        dailyCountRef.current         += 1;

        _showToastRef.current(insight.message ?? '💡 Mola önerisi var', 'info');

        // ── Windows native notification (Electron IPC) ─────────────────────────
        const electron = (window as any).sadikElectron;
        if (electron?.showNotification) {
          const isTask = insight.source === 'task';
          electron.showNotification(
            isTask ? 'SADIK — Görev Hatırlatma' : 'SADIK — Mola Önerisi',
            insight.message ?? 'Kısa bir mola zamanı!',
          );
        }

        // ── Spoken proactive (strong insights only) ───────────────────────────
        // Gates: spoken enabled + voice assistant idle + not already speaking +
        // spoken daily limit not reached.  speakProactive handles OLED + idle return.
        let willSpeak = false;
        if (
          insight.level === 'strong' &&
          spokenProactiveEnabledRef.current &&
          !voiceAssistantActiveRef.current &&
          !isProactiveSpeakingRef.current
        ) {
          const spokenToday = new Date().toDateString();
          if (spokenDailyCountDateRef.current !== spokenToday) {
            spokenDailyCountDateRef.current = spokenToday;
            spokenDailyCountRef.current     = 0;
          }
          if (spokenDailyCountRef.current < spokenProactiveDailyLimitRef.current) {
            spokenDailyCountRef.current += 1;
            willSpeak = true;
            _speakProactiveRef.current(insight.message ?? 'Kısa bir mola zamanı!');
          }
        }

        // Silent OLED feedback only when not speaking (speakProactive owns OLED when active)
        if (!willSpeak) {
          _showTextRef.current(insight.level === 'strong' ? 'MOLA!' : 'MOLA?');
          setTimeout(() => _returnToIdleRef.current(), 4000);
        }
      } catch {
        // Best-effort — backend may be starting or have no data yet
      }
    };

    // First poll after 30 s (backend settles, recent sessions committed)
    const initialDelay = setTimeout(poll, 30_000);
    // Then every 5 minutes
    const interval = setInterval(poll, 5 * 60 * 1000);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentional: uses latest-ref pattern — no deps needed

  // ── Proactive accept / deny ────────────────────────────────────────────────

  const acceptInsight = useCallback(async () => {
    try {
      await modesApi.setMode('break');
      setCurrentMode('break');
      triggerEvent('confirmation_success');
      showToast('Mola moduna geçildi', 'success');
      // Start break animation after brief confirmation, or fall back to text
      setTimeout(() => {
        if (getLoadedClipNames().includes('mod_break')) {
          playModClip('mod_break');
        } else {
          showText('MOLA');
        }
      }, 1200);
    } catch {
      showToast('Mod değiştirilemedi', 'error');
    }
    setActiveInsight(null);
  }, [triggerEvent, showText, showToast, playModClip, getLoadedClipNames]);

  const denyInsight = useCallback(() => {
    const current = activeInsightRef.current;
    if (current?.app_name && current.source === 'app_usage') {
      deniedAppInsightsRef.current.add(current.app_name);
    }
    setActiveInsight(null);
    returnToIdle();
  }, [returnToIdle]);

  acceptInsightRef.current = acceptInsight;

  // ── Safe startup policy ────────────────────────────────────────────────────
  //
  // STARTUP_WAKE_WORD_SAFE_MODE = true:
  //   Wake word service is NEVER started automatically at app launch, regardless
  //   of the user's saved wake_word_enabled setting.  This hard-blocks the crash-
  //   prone audio pipeline (getUserMedia → MediaRecorder → WASAPI) from running
  //   during Electron startup.
  //
  //   What still works:
  //     • The UI toggle ("Uyandırma Açık/Kapalı") — user can enable wake word
  //       manually after the app is running.  toggleWakeWord() calls startWakeWord()
  //       which is the safe, user-initiated path.
  //     • All non-voice features (dashboard, tasks, OLED, text chat, etc.) — unaffected.
  //     • Saved setting is still read and displayed correctly in the UI.
  //
  //   enumerateDevices is also skipped at startup for the same reason: calling it
  //   while WASAPI is uninitialised can trigger a crash on some Windows drivers.
  //   Audio device list populates when the user clicks Refresh in Settings.
  //
  //   Set to false here (and restore startWakeWordRef.current() below) only after
  //   the wake word pipeline has been confirmed crash-free on this system.
  const STARTUP_WAKE_WORD_SAFE_MODE = false;

  // ── Initial data load ─────────────────────────────────────────────────────

  useEffect(() => {
    // `cancelled` is set by the cleanup function so the async settingsApi.getAll()
    // callback can tell whether this effect invocation is still alive.
    //
    // Problem this solves: React StrictMode mounts effects twice in development.
    // The cleanup runs immediately after the first mount, BEFORE the settingsApi
    // promise resolves.  This means `audioInitTimer` is still null when cleanup
    // runs — clearTimeout(null) is a no-op and cancels nothing.  When the promise
    // resolves, BOTH effect invocations' callbacks fire and BOTH schedule timers,
    // causing Phase 1 and Phase 2 to each run twice (two concurrent getUserMedia
    // calls → WASAPI crash, exitCode -1073741819).
    //
    // Fix: each invocation tracks its own `cancelled` flag.  The cleanup sets it
    // to true so the already-resolved (or later-resolving) promise callback from
    // the first invocation bails out before scheduling any timers.
    let cancelled        = false;
    let audioInitTimer:    ReturnType<typeof setTimeout> | null = null;
    let enumDevicesTimer:  ReturnType<typeof setTimeout> | null = null;

    // Listen for notification clicks from Electron main process
    const electron = (window as any).sadikElectron;
    if (electron?.onNotificationClick) {
      electron.onNotificationClick(() => {
        // Accept the current insight (enter break mode) if it's an app usage insight
        if (activeInsightRef.current?.source !== 'task') {
          acceptInsightRef.current();
        }
      });
    }

    modesApi.getCurrent().then((m) => setCurrentMode(m.mode)).catch(() => {});
    deviceApi.getStatus().then((status) => {
      setDeviceStatus(status);
      // One best-effort auto-connect attempt if device is not already connected
      if (!status.connected) {
        deviceApi.autoConnect().then((result) => {
          if (result.connected) {
            deviceApi.getStatus().then(setDeviceStatus).catch(() => {});
          }
        }).catch(() => {});
      }
    }).catch(() => {});
    pomodoroApi.getState().then(setPomodoroState).catch(() => {});
    settingsApi.getAll()
      .then((s) => {
        // Bail out if this effect invocation was already cleaned up (StrictMode
        // second-mount cancellation).  Without this check both invocations' promise
        // callbacks would run and schedule duplicate audio-init timers.
        if (cancelled) return;

        const enabled              = s['wake_word_enabled'] === 'true';
        const sensitivity          = s['wake_word_sensitivity'] ?? 'normal';
        const continuous           = s['continuous_conversation'] === 'true';
        const brightness           = parseInt(s['oled_brightness_percent'] ?? '70', 10);
        const sleepTimeout         = parseInt(s['oled_sleep_timeout_minutes'] ?? '10', 10);
        wakeWordEnabledRef.current       = enabled;
        wakeWordSensitivityRef.current   = sensitivity;
        continuousConversationRef.current = continuous;
        setWakeWordEnabled(enabled);
        setWakeWordSensitivityState(sensitivity);
        setContinuousConversationState(continuous);
        oledBrightnessRef.current = brightness;
        setOledBrightnessPercent(brightness);
        oledSleepTimeoutRef.current = sleepTimeout;
        setOledSleepTimeoutMinutes(sleepTimeout);
        wakeWordService.setSensitivity(sensitivity);
        // Load and validate audio device selections
        const audioInputId  = s['audio_input_device_id']  ?? 'default';
        const audioOutputId = s['audio_output_device_id'] ?? 'default';
        audioInputDeviceIdRef.current  = audioInputId;
        audioOutputDeviceIdRef.current = audioOutputId;
        setSelectedAudioInputDeviceIdState(audioInputId);
        setSelectedAudioOutputDeviceIdState(audioOutputId);
        wakeWordService.setInputDeviceId(audioInputId);

        // Audio startup:
        //   STARTUP_WAKE_WORD_SAFE_MODE=true → skip Phase 1 & Phase 2 entirely.
        //   When safe mode is lifted, restore: if (enabled) startWakeWordRef.current()
        //   followed by a 1 s deferred enumerateDevices.
        if (STARTUP_WAKE_WORD_SAFE_MODE) {
          console.log(
            '[SADIK][AudioInit] STARTUP_WAKE_WORD_SAFE_MODE active — ' +
            'wake word auto-start and enumerateDevices suppressed. ' +
            'Use the UI toggle to enable wake word manually.',
          );
        } else {
          audioInitTimer = setTimeout(() => {
            audioInitTimer = null;
            if (cancelled) return;
            if (enabled) {
              console.log('[SADIK][AudioInit] Phase 1 — wake word start (getUserMedia)');
              startWakeWordRef.current();
              enumDevicesTimer = setTimeout(() => {
                enumDevicesTimer = null;
                if (cancelled) return;
                console.log('[SADIK][AudioInit] Phase 2 — enumerateDevices');
                refreshAudioDevices();
              }, 1000);
            } else {
              console.log('[SADIK][AudioInit] Wake word disabled — skipping audio startup');
            }
          }, 2000);
        }

        // Load proactive suggestion controls
        const proactiveEnabled   = s['proactive_suggestions_enabled'] !== 'false';
        const quietStart         = s['proactive_quiet_hours_start']   ?? '23:00';
        const quietEnd           = s['proactive_quiet_hours_end']     ?? '08:00';
        const dailyLimit         = parseInt(s['proactive_daily_limit']        ?? '3',  10);
        const cooldownMins       = parseInt(s['proactive_cooldown_minutes']   ?? '60', 10);
        proactiveSuggestionsEnabledRef.current = proactiveEnabled;
        proactiveQuietHoursStartRef.current    = quietStart;
        proactiveQuietHoursEndRef.current      = quietEnd;
        proactiveDailyLimitRef.current         = isNaN(dailyLimit)   ? 3  : dailyLimit;
        proactiveCooldownMinutesRef.current    = isNaN(cooldownMins) ? 60 : cooldownMins;
        setProactiveSuggestionsEnabledState(proactiveEnabled);
        setProactiveQuietHoursStartState(quietStart);
        setProactiveQuietHoursEndState(quietEnd);
        setProactiveDailyLimitState(isNaN(dailyLimit)   ? 3  : dailyLimit);
        setProactiveCooldownMinutesState(isNaN(cooldownMins) ? 60 : cooldownMins);
        // Load spoken proactive settings
        const spokenEnabled = s['spoken_proactive_enabled'] !== 'false';
        const spokenLimit   = parseInt(s['spoken_proactive_daily_limit'] ?? '1', 10);
        spokenProactiveEnabledRef.current    = spokenEnabled;
        spokenProactiveDailyLimitRef.current = isNaN(spokenLimit) ? 1 : spokenLimit;
        setSpokenProactiveEnabledState(spokenEnabled);
        setSpokenProactiveDailyLimitState(isNaN(spokenLimit) ? 1 : spokenLimit);
      })
      .catch(() => {});

    return () => {
      // Mark this invocation as cancelled so the async settingsApi.getAll()
      // callback (if it hasn't resolved yet) will bail out without scheduling timers.
      cancelled = true;
      if (audioInitTimer   !== null) { clearTimeout(audioInitTimer);   audioInitTimer   = null; }
      if (enumDevicesTimer !== null) { clearTimeout(enumDevicesTimer); enumDevicesTimer = null; }
    };
  }, [refreshAudioDevices]);

  // Apply saved brightness and sleep timeout whenever the device connects.
  const prevConnectedRef = useRef(false);
  useEffect(() => {
    if (deviceStatus.connected && !prevConnectedRef.current) {
      deviceApi.setBrightness(oledBrightnessRef.current).catch(() => {});
      deviceApi.setSleepTimeout(oledSleepTimeoutRef.current).catch(() => {});
    }
    prevConnectedRef.current = deviceStatus.connected;
  }, [deviceStatus.connected]);

  // ── Re-enumerate devices when hardware changes (plug/unplug) ──────────────
  //
  // Guard: skip enumerateDevices while the wake word service holds a WASAPI
  // capture session.  On some Windows drivers the `devicechange` event fires
  // ~1.5 s after getUserMedia opens the mic (delayed HAL notification).
  // Calling enumerateDevices() concurrently with an active WASAPI capture
  // session can trigger a STATUS_ACCESS_VIOLATION in the renderer.
  useEffect(() => {
    const safeRefresh = () => {
      if (wakeWordService.isActive()) {
        console.warn('[SADIK][DeviceChange] skipped enumerateDevices — wake word WASAPI session active');
        return;
      }
      refreshAudioDevices();
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', safeRefresh);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', safeRefresh);
    };
  }, [refreshAudioDevices]);

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
          triggerEvent('confirmation_success');
          showToast('Pomodoro oturumu tamamlandı!', 'success');
          showText('TAMAMLANDI!');
          setTimeout(() => returnToIdle(), 3000);
          break;
      }
    },
    [showToast, showText, returnToIdle, triggerEvent]
  );

  useWebSocket(handleWSMessage);

  return (
    <AppContext.Provider
      value={{
        currentMode,
        setCurrentMode,
        deviceStatus,
        setDeviceStatus,
        autoConnectDevice,
        oledBrightnessPercent,
        setOledBrightness,
        oledSleepTimeoutMinutes,
        setOledSleepTimeout,
        pomodoroState,
        setPomodoroState,
        toast,
        showToast,
        engineState,
        triggerEvent,
        showText,
        returnToIdle,
        playClipDirect,
        playModClip,
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
        audioInputDevices,
        audioOutputDevices,
        selectedAudioInputDeviceId,
        selectedAudioOutputDeviceId,
        setSelectedAudioInputDeviceId,
        setSelectedAudioOutputDeviceId,
        refreshAudioDevices,
        activeInsight,
        acceptInsight,
        denyInsight,
        proactiveSuggestionsEnabled,
        setProactiveSuggestionsEnabled,
        proactiveQuietHoursStart,
        setProactiveQuietHoursStart,
        proactiveQuietHoursEnd,
        setProactiveQuietHoursEnd,
        proactiveDailyLimit,
        setProactiveDailyLimit,
        proactiveCooldownMinutes,
        setProactiveCooldownMinutes,
        spokenProactiveEnabled,
        setSpokenProactiveEnabled,
        spokenProactiveDailyLimit,
        setSpokenProactiveDailyLimit,
        setVoiceAssistantActive,
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
