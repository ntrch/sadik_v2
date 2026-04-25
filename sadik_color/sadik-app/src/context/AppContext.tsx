import React, { createContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { PomodoroState } from '../api/pomodoro';
import { DeviceStatus } from '../api/device';
import { modesApi } from '../api/modes';
import { deviceApi } from '../api/device';
import { pomodoroApi } from '../api/pomodoro';
import { settingsApi } from '../api/settings';
import http from '../api/http';
import { statsApi, AppInsight } from '../api/stats';
import { tasksApi } from '../api/tasks';
import { workspacesApi } from '../api/workspaces';
import { voiceApi } from '../api/voice';
import { weatherApi, CurrentWeather } from '../api/weather';
import { integrationsApi, IntegrationStatus } from '../api/integrations';
import { wakeWordService } from '../services/wakeWordService';
import { useWebSocket, WSMessage } from '../hooks/useWebSocket';
import { useAnimationEngine } from '../hooks/useAnimationEngine';
import { getAnimationEngine } from '../engine/AnimationEngine';
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
  playModSequence: (intro: string, loop: string) => void;
  playModSequenceWithCallback: (intro: string, loop: string, onIntroFinish?: () => void) => void;
  playModIntroOnce: (intro: string, onFinish?: () => void) => void;
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
  /** True while VoiceAssistant is in listening/processing/speaking — surface in UI. */
  voiceAssistantActive: boolean;
  /** True when ChatPage's voice tab is active — drives persistent VoiceAssistant visibility. */
  voiceUiVisible: boolean;
  setVoiceUiVisible: (visible: boolean) => void;
  // DND
  dndActive: boolean;
  setDndActive: (v: boolean) => void;
  // Sadık's position (affects focus-look direction)
  sadikPosition: 'left' | 'right' | 'top';
  setSadikPosition: (pos: 'left' | 'right' | 'top') => Promise<void>;
  // Weather
  weatherEnabled: boolean;
  setWeatherEnabled: (v: boolean) => Promise<void>;
  weatherApiKey: string;
  setWeatherApiKey: (v: string) => Promise<void>;
  weatherLocationLabel: string;
  weatherLat: string;
  weatherLon: string;
  setWeatherLocation: (loc: { label: string; lat: number; lon: number }) => Promise<void>;
  clearWeatherLocation: () => Promise<void>;
  weatherData: CurrentWeather | null;
  weatherError: string | null;
  refreshWeather: () => Promise<void>;
  // Debug — for manual proactive testing from Dashboard
  debugForcePoll: () => void;
  debugTestTTS: (text?: string) => void;
  debugResetCounters: () => void;
  debugSimulateInsight: (appName: string, minutes: number) => void;
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
  isLooping: false,
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
  playModSequence: () => {},
  playModSequenceWithCallback: () => {},
  playModIntroOnce: () => {},
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
  spokenProactiveDailyLimit: 3,
  setSpokenProactiveDailyLimit: async () => {},
  setVoiceAssistantActive: () => {},
  voiceAssistantActive: false,
  voiceUiVisible: false,
  setVoiceUiVisible: () => {},
  dndActive: false,
  setDndActive: () => {},
  sadikPosition: 'left',
  setSadikPosition: async () => {},
  weatherEnabled: false,
  setWeatherEnabled: async () => {},
  weatherApiKey: '',
  setWeatherApiKey: async () => {},
  weatherLocationLabel: '',
  weatherLat: '',
  weatherLon: '',
  setWeatherLocation: async () => {},
  clearWeatherLocation: async () => {},
  weatherData: null,
  weatherError: null,
  refreshWeather: async () => {},
  debugForcePoll: () => {},
  debugTestTTS: () => {},
  debugResetCounters: () => {},
  debugSimulateInsight: () => {},
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
  const [voiceUiVisible, setVoiceUiVisible] = useState(false);

  // Audio device state
  const [audioInputDevices,  setAudioInputDevices]  = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInputDeviceId,  setSelectedAudioInputDeviceIdState]  = useState('default');
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceIdState] = useState('default');

  // Proactive insight state
  const [activeInsight, setActiveInsight] = useState<AppInsight | null>(null);
  const activeInsightRef = useRef<AppInsight | null>(null);
  activeInsightRef.current = activeInsight;

  // Mode ref — keeps latest mode available inside setInterval closures
  const currentModeRef = useRef<string | null>(null);
  currentModeRef.current = currentMode;

  // Proactive suggestion controls state
  const [proactiveSuggestionsEnabled, setProactiveSuggestionsEnabledState] = useState(true);
  const [proactiveQuietHoursStart, setProactiveQuietHoursStartState]       = useState('23:00');
  const [proactiveQuietHoursEnd, setProactiveQuietHoursEndState]           = useState('08:00');
  const [proactiveDailyLimit, setProactiveDailyLimitState]                 = useState(3);
  const [proactiveCooldownMinutes, setProactiveCooldownMinutesState]       = useState(60);

  // Spoken proactive state
  const [spokenProactiveEnabled, setSpokenProactiveEnabledState]       = useState(true);
  const [spokenProactiveDailyLimit, setSpokenProactiveDailyLimitState] = useState(3);

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
  const spokenProactiveDailyLimitRef = useRef(3);
  /** Set to true by VoiceAssistant when voiceState !== 'idle'; gates spoken proactive. */
  const voiceAssistantActiveRef      = useRef(false);
  /** Set to true while proactive TTS audio is playing; prevents stacking. */
  const isProactiveSpeakingRef       = useRef(false);
  // Holds the currently playing proactive-TTS <audio> element (+ its object
  // URL) so a manual accept/deny can interrupt it cleanly without waiting
  // for the sentence to finish.
  const currentProactiveAudioRef     = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
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

  // ── Sadık position (must be declared before useAnimationEngine) ──────────────
  const [sadikPosition, setSadikPositionState] = useState<'left' | 'right' | 'top'>('left');

  const setSadikPosition = useCallback(async (pos: 'left' | 'right' | 'top') => {
    setSadikPositionState(pos);
    try { await settingsApi.update({ sadik_position: pos }); } catch { /* best-effort */ }
  }, []);

  // ── Persona slug — selects animation pack under /animations/personas/<slug>/ ──
  const [personaSlug] = useState<string>('sadik');

  // ── Weather state ────────────────────────────────────────────────────────────
  const [weatherEnabled, setWeatherEnabledState] = useState(false);
  const [weatherApiKey, setWeatherApiKeyState]   = useState('');
  const [weatherLocationLabel, setWeatherLocationLabelState] = useState('');
  const [weatherLat, setWeatherLatState]         = useState('');
  const [weatherLon, setWeatherLonState]         = useState('');
  const [weatherData, setWeatherData]            = useState<CurrentWeather | null>(null);
  const [weatherError, setWeatherError]          = useState<string | null>(null);
  const weatherEnabledRef = useRef(false);
  weatherEnabledRef.current = weatherEnabled;

  const refreshWeather = useCallback(async () => {
    if (!weatherEnabledRef.current) return;
    try {
      const data = await weatherApi.getCurrent();
      setWeatherData(data);
      setWeatherError(null);
    } catch (e: any) {
      setWeatherData(null);
      setWeatherError(e?.response?.data?.detail ?? 'weather_fetch_failed');
    }
  }, []);

  const setWeatherEnabled = useCallback(async (v: boolean) => {
    setWeatherEnabledState(v);
    try { await settingsApi.update({ weather_enabled: String(v) }); } catch { /* best-effort */ }
    if (v) {
      refreshWeather();
    } else {
      setWeatherData(null);
      setWeatherError(null);
    }
  }, [refreshWeather]);

  const setWeatherApiKey = useCallback(async (v: string) => {
    setWeatherApiKeyState(v);
    try { await settingsApi.update({ weather_api_key: v }); } catch { /* best-effort */ }
    if (weatherEnabledRef.current) refreshWeather();
  }, [refreshWeather]);

  const setWeatherLocation = useCallback(async (loc: { label: string; lat: number; lon: number }) => {
    setWeatherLocationLabelState(loc.label);
    setWeatherLatState(String(loc.lat));
    setWeatherLonState(String(loc.lon));
    try {
      await settingsApi.update({
        weather_location_label: loc.label,
        weather_lat: String(loc.lat),
        weather_lon: String(loc.lon),
        // clear legacy city field so backend uses coords
        weather_city: '',
      });
    } catch { /* best-effort */ }
    if (weatherEnabledRef.current) refreshWeather();
  }, [refreshWeather]);

  const clearWeatherLocation = useCallback(async () => {
    setWeatherLocationLabelState('');
    setWeatherLatState('');
    setWeatherLonState('');
    try {
      await settingsApi.update({
        weather_location_label: '',
        weather_lat: '',
        weather_lon: '',
        weather_city: '',
      });
    } catch { /* best-effort */ }
    setWeatherData(null);
    setWeatherError(null);
  }, []);

  // Poll weather every 10 min while enabled
  useEffect(() => {
    if (!weatherEnabled) return;
    refreshWeather();
    const id = setInterval(refreshWeather, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [weatherEnabled, refreshWeather]);

  const {
    engineState,
    frameBuffer,
    frameVersion,
    triggerEvent,
    showText,
    returnToIdle,
    playClipDirect,
    playModClip,
    playModSequence,
    playModSequenceWithCallback,
    playModIntroOnce,
    getLoadedClipNames,
  } = useAnimationEngine(deviceStatus.connected, sadikPosition, personaSlug);

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
    // Keep the WS + backend mic open; just suppress detections. Tearing down
    // and rebuilding across turns proved unreliable on Windows (second detection
    // frequently missed).  Backend mic and frontend voice mic are separate
    // streams, so they can coexist without a teardown dance.
    if (wakeWordResumeTimerRef.current !== null) {
      clearTimeout(wakeWordResumeTimerRef.current);
      wakeWordResumeTimerRef.current = null;
    }
    wakeWordService.pause();
    setWakeWordActive(false);
  }, []);

  /** Re-arm detection 400 ms after a voice turn ends. Uses refs — never stale. */
  const resumeWakeWord = useCallback(() => {
    if (!wakeWordEnabledRef.current) return;
    if (wakeWordResumeTimerRef.current !== null) {
      clearTimeout(wakeWordResumeTimerRef.current);
    }
    wakeWordResumeTimerRef.current = setTimeout(() => {
      wakeWordResumeTimerRef.current = null;
      if (!wakeWordEnabledRef.current) return;
      // If the service was stopped (e.g. explicit cancel), start it fresh.
      // Otherwise just unpause — WS and backend mic are already running.
      if (wakeWordService.isActive()) {
        wakeWordService.resume();
        setWakeWordActive(true);
      } else {
        startWakeWordRef.current();
      }
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

  /** Called by VoiceAssistant on every voiceState transition. */
  const [voiceAssistantActive, setVoiceAssistantActiveState] = useState(false);
  const setVoiceAssistantActive = useCallback((active: boolean) => {
    voiceAssistantActiveRef.current = active;
    setVoiceAssistantActiveState(active);
  }, []);

  // ── DND state ──────────────────────────────────────────────────────────────
  const [dndActive, setDndActiveState] = useState(false);
  const dndActiveRef = useRef(false);
  dndActiveRef.current = dndActive;

  const setDndActive = useCallback((v: boolean) => {
    setDndActiveState(v);
    dndActiveRef.current = v;
    // Persist
    settingsApi.update({ dnd_active: String(v) }).catch(() => {});
    // OS-level DND via Electron IPC
    try { (window as any).electronAPI?.setDnd?.(v); } catch { /* best-effort */ }
  }, []);

  // ── OLED burn-in protection — idle detection ───────────────────────────────
  //
  // Authority model:
  //   • App connected  → app is authority; use user's oled_sleep_timeout_minutes
  //                       to decide when to pause frame streaming + FORCE_SLEEP.
  //   • App disconnected → firmware is authority; it handles sleep on its own
  //                         (via CMD_SET_SLEEP_TIMEOUT sent on reconnect). We
  //                         take no action here.
  // timeout = 0 means "disabled" (never auto-sleep).
  const isIdleRef = useRef(false);
  const connectedRef = useRef(false);
  connectedRef.current = deviceStatus.connected;
  useEffect(() => {
    (window as any).sadikElectron?.onIdleTick?.(({ idleSeconds }: { idleSeconds: number }) => {
      if (!connectedRef.current) return;
      const timeoutMin = oledSleepTimeoutRef.current;
      if (timeoutMin <= 0) {
        if (isIdleRef.current) {
          isIdleRef.current = false;
          getAnimationEngine().setStreamingEnabled(true);
        }
        return;
      }
      const threshold = timeoutMin * 60;
      const shouldIdle = idleSeconds >= threshold;
      if (shouldIdle && !isIdleRef.current) {
        isIdleRef.current = true;
        console.log(`[BurnIn] Idle ${idleSeconds}s ≥ ${threshold}s — pausing stream + FORCE_SLEEP`);
        getAnimationEngine().setStreamingEnabled(false);
        deviceApi.sendCommand('FORCE_SLEEP').catch(() => {});
      } else if (!shouldIdle && isIdleRef.current) {
        isIdleRef.current = false;
        console.log('[BurnIn] User returned — resuming frame stream');
        getAnimationEngine().setStreamingEnabled(true);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Proactive insight polling ──────────────────────────────────────────────
  //
  // Polls GET /api/stats/app-usage/insights every 5 minutes.
  // Shows a toast + brief OLED text when a new or escalated insight arrives.
  // Deduplication key: app_name + level — same suggestion is never spammed.
  // The "latest ref" pattern ensures the interval closure is never stale.

  /** Key of the last insight that triggered a toast/OLED notification. */
  const lastShownInsightKeyRef = useRef<string | null>(null);
  /** Key of the last insight for which TTS was successfully started. Separate from
   *  visual dedup so that a failed/blocked TTS attempt can be retried on the next poll. */
  const lastSpokenInsightKeyRef = useRef<string | null>(null);
  /**
   * Level-aware rejection map. Key = source:identifier (no level).
   * - On gentle reject  → block until the same key escalates to 'strong'.
   * - On strong reject  → block for 2 hours from rejection timestamp.
   * Memory-only, resets on app restart or on debugResetCounters.
   * Cleared for the key when the user accepts (so future suggestions resume).
   */
  const REJECTION_STORAGE_KEY = 'sadik.proactive.rejections.v1';
  const loadRejectionMap = (): Map<string, { level: 'gentle' | 'strong'; at: number }> => {
    try {
      const raw = localStorage.getItem(REJECTION_STORAGE_KEY);
      if (!raw) return new Map();
      const obj = JSON.parse(raw) as Record<string, { level: 'gentle' | 'strong'; at: number }>;
      return new Map(Object.entries(obj));
    } catch { return new Map(); }
  };
  const persistRejectionMap = (m: Map<string, { level: 'gentle' | 'strong'; at: number }>) => {
    try {
      const obj: Record<string, { level: 'gentle' | 'strong'; at: number }> = {};
      m.forEach((v, k) => { obj[k] = v; });
      localStorage.setItem(REJECTION_STORAGE_KEY, JSON.stringify(obj));
    } catch { /* quota/private mode — ignore */ }
  };
  const rejectionMapRef = useRef<Map<string, { level: 'gentle' | 'strong'; at: number }>>(loadRejectionMap());
  const STRONG_REJECT_COOLDOWN_MS = 2 * 60 * 60 * 1000;
  const rejectionBaseKey = (ins: { source?: string; app_name?: string | null; message?: string | null }) =>
    `${ins.source ?? ''}:${ins.app_name ?? (ins.message ?? '').slice(0, 30)}`;
  const shouldSuppressByRejection = (ins: { source?: string; app_name?: string | null; message?: string | null; level?: string }) => {
    const rej = rejectionMapRef.current.get(rejectionBaseKey(ins));
    if (!rej) return false;
    if (rej.level === 'gentle') return ins.level !== 'strong';
    return (Date.now() - rej.at) < STRONG_REJECT_COOLDOWN_MS;
  };

  // These refs always point to the latest function instances so the
  // setInterval callback never captures a stale closure.
  const _showToastRef    = useRef(showToast);
  const _showTextRef     = useRef(showText);
  const _returnToIdleRef = useRef(returnToIdle);
  const acceptInsightRef = useRef<() => Promise<void>>(async () => {});
  const denyInsightRef   = useRef<() => void>(() => {});
  _showToastRef.current    = showToast;
  _showTextRef.current     = showText;
  _returnToIdleRef.current = returnToIdle;

  /**
   * Play a short spoken proactive suggestion through the selected output device.
   * Manages its own OLED feedback and returns to idle when audio ends.
   * Never opens the mic or enters voice conversation flow.
   */
  // Ref storing the current active insight so the STT accept/reject window can
  // trigger the correct handlers without a closure over changing state.
  const _acceptInsightForSttRef = useRef<() => Promise<void>>(async () => {});
  const _denyInsightForSttRef   = useRef<() => void>(() => {});
  // Dedup guard: stores the insight key for which the STT window was already
  // armed.  Prevents double-arming when speakProactive is somehow called twice
  // for the same suggestion (e.g. a stale TTS retry).
  const _sttArmedForKeyRef = useRef<string | null>(null);

  // Stores the app-usage insight that was accepted (break started).
  // When the break completes (naturally or via early cancel) we clear the
  // rejection map for that app so future suggestions resume normally.
  const breakAcceptedInsightRef = useRef<AppInsight | null>(null);
  // Clears rejection for the accepted insight + resets dedup keys so the next
  // organic poll can surface a fresh suggestion for the same app.
  const clearBreakAcceptedInsight = useCallback(() => {
    const ins = breakAcceptedInsightRef.current;
    if (!ins) return;
    breakAcceptedInsightRef.current = null;
    // Clear rejection map so the app can be suggested again in the future
    rejectionMapRef.current.delete(rejectionBaseKey(ins));
    persistRejectionMap(rejectionMapRef.current);
    // Clear dedup keys so the app insight can surface on the next poll
    lastShownInsightKeyRef.current  = null;
    lastSpokenInsightKeyRef.current = null;
    console.log('[Proactive] Break completion/cancel — counter reset for', rejectionBaseKey(ins));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const clearBreakAcceptedInsightRef = useRef(clearBreakAcceptedInsight);
  clearBreakAcceptedInsightRef.current = clearBreakAcceptedInsight;

  // Timestamp of the last habit TTS fire — used to defer app-usage TTS by 60s
  // when a habit and an app-usage suggestion coincide (spec: habits fire
  // immediately, app-usage waits +1 min).
  const lastHabitFiredAtRef = useRef<number>(0);
  // Queue of pending app-usage insights waiting for the 1-min post-habit gap.
  // Stored as [insight, scheduledAt] pairs; processed by a 30s sweep timer.
  const pendingInsightQueueRef = useRef<Array<{ insight: AppInsight; notBefore: number }>>([]);
  const queueSweepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Change 1: intensity-aware spoken proactive suggestion.
   * - "strong" level → prepend "Dikkat! …" (assertive framing).
   * - "gentle" level → prepend "Küçük bir öneri: …" (soft framing).
   * NOTE: The TTS backend (ElevenLabs/OpenAI/edge-tts) does not expose a
   * style/speed/voice variant through the /api/voice/tts endpoint — it accepts
   * only { text }.  Intensity distinction is therefore wording-only (no style param).
   *
   * Change 2: after TTS finishes, arm an 8-second one-shot STT window IF the
   * voice assistant is idle.  Recognised words resolve to accept/reject/timeout.
   * Accept and reject trigger the same handlers as the UI buttons.  If the voice
   * assistant is busy (voiceAssistantActiveRef = true) the STT window is skipped —
   * buttons remain the only path.
   */
  const speakProactive = useCallback(async (text: string, intensity?: 'gentle' | 'strong', insightKey?: string) => {
    if (isProactiveSpeakingRef.current) return;
    isProactiveSpeakingRef.current = true;
    try {
      // Change 1: prepend intensity-based prefix to the spoken text
      let spokenText = text;
      if (intensity === 'strong') {
        spokenText = `Dikkat! ${text}`;
      } else if (intensity === 'gentle') {
        spokenText = `Küçük bir öneri: ${text}`;
      }

      const audioBlob = await voiceApi.tts(spokenText);
      const url   = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      currentProactiveAudioRef.current = { audio, url };

      // Route to the user's selected speaker if the browser supports setSinkId
      if (audioOutputDeviceIdRef.current !== 'default') {
        const audioWithSink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        if (typeof audioWithSink.setSinkId === 'function') {
          try { await audioWithSink.setSinkId(audioOutputDeviceIdRef.current); } catch { /* best-effort */ }
        }
      }

      // Show the talking animation (same one used during voice assistant TTS)
      // while the proactive suggestion plays, instead of the static MOLA text.
      getAnimationEngine().triggerEvent('assistant_speaking');

      audio.onended = () => {
        URL.revokeObjectURL(url);
        isProactiveSpeakingRef.current = false;
        if (currentProactiveAudioRef.current?.audio === audio) {
          currentProactiveAudioRef.current = null;
        }

        // Change 2: arm STT window only when:
        //   - voice assistant is not active
        //   - intensity is set (only break/task insights, not break-end announcements)
        //   - not already armed for this exact suggestion (dedup guard)
        const sttKey = insightKey ?? text;
        const alreadyArmed = _sttArmedForKeyRef.current === sttKey;
        if (!voiceAssistantActiveRef.current && intensity !== undefined && !alreadyArmed) {
          _sttArmedForKeyRef.current = sttKey;
          armProactiveSttWindowRef.current();
        } else {
          if (alreadyArmed) console.log('[Proactive][STT] skipped — already armed for this key');
          _returnToIdleRef.current();
        }
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        isProactiveSpeakingRef.current = false;
        if (currentProactiveAudioRef.current?.audio === audio) {
          currentProactiveAudioRef.current = null;
        }
        _returnToIdleRef.current();
      };
      await audio.play();
    } catch {
      isProactiveSpeakingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentional: reads all state through refs — no deps needed

  /**
   * Change 2: one-shot 8-second STT window for proactive accept/reject.
   * Records from the selected input device, sends to Whisper, resolves to
   * 'accept' | 'reject' | 'timeout', then triggers the appropriate handler.
   * Called via stable ref from speakProactive's onended — never leaks into VAD.
   */
  const armProactiveSttWindow = useCallback(async () => {
    // Skip entirely if voice assistant is busy — buttons remain the only path.
    if (voiceAssistantActiveRef.current) return;

    const ACCEPT_WORDS = ['evet', 'tamam', 'olur', 'kabul', 'mola ver', 'başlat'];
    const REJECT_WORDS = ['hayır', 'yok', 'reddet', 'istemiyorum', 'sonra', 'geç'];
    const WINDOW_MS    = 8000;

    // ── Mic contention fix: pause wake word before grabbing the device ──────
    // Windows WASAPI does not allow two concurrent capture sessions on the same
    // physical device.  If wakeWordService is recording, calling getUserMedia
    // here produces silent/invalid audio and stacks up backend Whisper requests.
    const wakeWordWasActive = wakeWordService.isActive();
    if (wakeWordWasActive) {
      wakeWordService.stop();
      // Give the OS ~200 ms to fully release the WASAPI capture session.
      await new Promise<void>((r) => setTimeout(r, 200));
    }

    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];

    try {
      const constraints: MediaStreamConstraints = {
        audio: audioInputDeviceIdRef.current !== 'default'
          ? { deviceId: { exact: audioInputDeviceIdRef.current } }
          : true,
      };
      stream   = await navigator.mediaDevices.getUserMedia(constraints);
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.start();

      // Animate listening state on OLED (user_speaking is the closest available event)
      getAnimationEngine().triggerEvent('user_speaking');

      await new Promise<void>((resolve) => setTimeout(resolve, WINDOW_MS));

      recorder.stop();
      // Wait for final chunk
      await new Promise<void>((resolve) => { recorder!.onstop = () => resolve(); });

    } catch {
      // getUserMedia failed (e.g. device busy) — fall through to timeout
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      // ── Resume wake word if it was active before we borrowed the mic ────────
      if (wakeWordWasActive && wakeWordEnabledRef.current) {
        startWakeWordRef.current();
      }
    }

    _returnToIdleRef.current();

    if (chunks.length === 0) return; // timeout path — card stays visible

    try {
      const blob  = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
      const transcript = await voiceApi.stt(blob);
      const lower = transcript.toLowerCase().trim();
      console.log('[Proactive][STT] transcript:', transcript);

      const isAccept = ACCEPT_WORDS.some((w) => lower.includes(w));
      const isReject = REJECT_WORDS.some((w) => lower.includes(w));

      if (isAccept) {
        console.log('[Proactive][STT] → accept');
        await _acceptInsightForSttRef.current();
      } else if (isReject) {
        console.log('[Proactive][STT] → reject');
        _denyInsightForSttRef.current();
      } else {
        console.log('[Proactive][STT] → timeout (no keyword matched)');
        // Card stays visible — buttons remain the only path
      }
    } catch {
      // STT failed — card stays visible
    } finally {
      // Clear the dedup key so the next suggestion (different key) can arm STT again.
      _sttArmedForKeyRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // reads all state via refs

  const armProactiveSttWindowRef = useRef(armProactiveSttWindow);
  armProactiveSttWindowRef.current = armProactiveSttWindow;

  // Stable ref so the poll interval closure can call the latest instance
  const _speakProactiveRef = useRef(speakProactive);
  _speakProactiveRef.current = speakProactive;

  // Stable refs populated by the useEffect below. Debug buttons invoke these.
  const _pollRef = useRef<() => Promise<void>>(async () => {});
  const _processInsightRef = useRef<(insight: AppInsight) => Promise<void>>(async () => {});

  const debugForcePoll = useCallback(() => {
    console.log('[Proactive][DEBUG] Force-poll invoked');
    _pollRef.current();
  }, []);
  const debugTestTTS = useCallback((text?: string) => {
    const msg = text ?? 'Test proaktif mesaj. Ses hattı çalışıyor.';
    console.log('[Proactive][DEBUG] Direct TTS test:', msg);
    _speakProactiveRef.current(msg);
  }, []);
  const debugResetCounters = useCallback(() => {
    console.log('[Proactive][DEBUG] Resetting daily counters + cooldown');
    dailyCountRef.current = 0;
    spokenDailyCountRef.current = 0;
    lastShownTimestampRef.current = null;
    lastShownInsightKeyRef.current  = null;
    lastSpokenInsightKeyRef.current = null;
    rejectionMapRef.current.clear();
    persistRejectionMap(rejectionMapRef.current);
    pendingInsightQueueRef.current = [];
    breakAcceptedInsightRef.current = null;
    lastHabitFiredAtRef.current = 0;
  }, []);
  const debugSimulateInsight = useCallback((appName: string, minutes: number) => {
    const sec = minutes * 60;
    const level: 'strong' | 'gentle' = sec >= 7200 ? 'strong' : 'gentle';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const duration = h > 0 ? (m > 0 ? `${h} saat ${m} dakika` : `${h} saat`) : `${m} dakika`;
    const message = level === 'strong'
      ? `Yaklaşık ${duration}dır ${appName} kullanıyorsun. Uzun bir mola zamanı geldi.`
      : `Yaklaşık ${duration}dır ${appName} kullanıyorsun. Kısa bir mola iyi gelebilir.`;
    const synthetic: AppInsight = {
      has_insight: true,
      app_name: appName,
      level,
      message,
      source: 'app_usage',
    };
    console.log('[Proactive][DEBUG] Simulating insight (gates bypassed):', synthetic);
    // Always surface the card regardless of gates
    setActiveInsight(synthetic);
    // Wire accept/deny refs so STT window can trigger the same handlers as UI buttons
    _acceptInsightForSttRef.current = acceptInsightRef.current;
    _denyInsightForSttRef.current   = () => denyInsightRef.current();
    // Reset dedup guard so STT arm is not skipped
    const key = `${synthetic.source}:${synthetic.app_name ?? ''}:${synthetic.level}`;
    _sttArmedForKeyRef.current = null;
    // Fire native OS notification (bypasses all gates, same as real delivery path)
    const electronBridge = (window as any).sadikElectron;
    if (electronBridge?.showNotification) {
      electronBridge.showNotification('SADIK — Debug Bildirim', message);
    }
    // Bypass all suppression gates (DND, quiet hours, cooldown, daily limit, etc.)
    // and speak directly — same as debugTestTTS but with intensity + STT arm.
    _speakProactiveRef.current(message, level, key);
  }, []);

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

    /** Run an already-resolved insight through gates (shared by poll + debug). */
    const processInsight = async (insight: AppInsight) => {
      try {
        // Rule G (level-aware rejection): gentle-rejected → wait for escalation;
        // strong-rejected → 2h cooldown. Gate even the dashboard card so denied
        // suggestions disappear completely until eligible again.
        if (shouldSuppressByRejection(insight)) {
          console.log('[Proactive] ✗ Rule G — rejection suppression', rejectionMapRef.current.get(rejectionBaseKey(insight)), 'current level=', insight.level);
          return;
        }

        // Deduplication — only notify (toast + native notification) when the insight is new or escalated
        const key = `${insight.source}:${insight.app_name ?? insight.message?.slice(0, 30)}:${insight.level}`;
        const alreadyNotified = key === lastShownInsightKeyRef.current;
        // TTS dedup is tracked separately: if same insight was already spoken, skip TTS too.
        const alreadySpoken   = key === lastSpokenInsightKeyRef.current;

        // ── Suppression rules ─────────────────────────────────────────────────
        console.log('[Proactive] Insight received:', { key, alreadyNotified, alreadySpoken, level: insight.level, source: insight.source, message: insight.message?.slice(0, 60) });

        // Rule A: feature disabled — blocks both notification and TTS
        if (!proactiveSuggestionsEnabledRef.current) { console.log('[Proactive] ✗ Rule A — feature disabled'); return; }

        // Rule F: DND active — suppress all proactive toast/voice/OLED
        if (dndActiveRef.current) { console.log('[Proactive] ✗ Rule F — DND aktif'); return; }

        // Rule B: quiet hours (overnight-aware) — blocks both notification and TTS
        if (isInQuietHours(proactiveQuietHoursStartRef.current, proactiveQuietHoursEndRef.current)) { console.log('[Proactive] ✗ Rule B — quiet hours', proactiveQuietHoursStartRef.current, '→', proactiveQuietHoursEndRef.current); return; }

        // Rule C: Pomodoro / focus suppression — blocks both notification and TTS
        if (pomodoroStateRef.current.is_running) { console.log('[Proactive] ✗ Rule C — pomodoro running'); return; }

        // Dashboard card: reflect the newly eligible insight (after all hard gates)
        setActiveInsight(insight);

        const now = Date.now();

        if (!alreadyNotified) {
          // Rules D and E only gate the first notification — once notification fired,
          // TTS retries on subsequent polls are not subject to cooldown / daily limit.

          // Rule D: cooldown between suggestions
          const cooldownMs = proactiveCooldownMinutesRef.current * 60 * 1000;
          if (lastShownTimestampRef.current !== null && now - lastShownTimestampRef.current < cooldownMs) { console.log('[Proactive] ✗ Rule D — cooldown', Math.round((cooldownMs - (now - lastShownTimestampRef.current)) / 1000), 's remaining'); return; }

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
        }

        // ── Spoken proactive ──────────────────────────────────────────────────
        // Retry TTS on each poll until it actually plays (voice may have been busy
        // on a previous poll).  Stop retrying once TTS was started (alreadySpoken).
        // Gates: spoken enabled + voice assistant idle + not already speaking +
        // spoken daily limit not reached.  speakProactive handles OLED + idle return.
        if (alreadySpoken) {
          console.log('[Proactive] TTS already spoken for this key — skipping voice');
          return;
        }

        let willSpeak = false;
        // Diagnostic: trace gate evaluation so we can see WHY voice didn't fire.
        console.log('[Proactive] Gate check:', {
          level: insight.level,
          spokenEnabled: spokenProactiveEnabledRef.current,
          voiceAssistantActive: voiceAssistantActiveRef.current,
          isProactiveSpeaking: isProactiveSpeakingRef.current,
          spokenDailyCount: spokenDailyCountRef.current,
          spokenDailyLimit: spokenProactiveDailyLimitRef.current,
        });
        if (
          (insight.level === 'strong' || insight.level === 'gentle') &&
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
            // Mark TTS as spoken so subsequent polls don't re-fire it.
            lastSpokenInsightKeyRef.current = key;
            willSpeak = true;
            // Wire accept/reject refs so the STT window (armed after TTS)
            // can trigger the same handlers as the UI buttons.
            _acceptInsightForSttRef.current = acceptInsightRef.current;
            _denyInsightForSttRef.current   = () => denyInsightRef.current();
            console.log('[Proactive] ✓ Speaking (intensity=%s):', insight.level, insight.message);
            // Reset the dedup key so the new suggestion can arm STT
            _sttArmedForKeyRef.current = null;
            // Pass intensity + dedup key so speakProactive can prefix the text
            // and armProactiveSttWindow is only armed once per suggestion.
            _speakProactiveRef.current(insight.message ?? 'Kısa bir mola zamanı!', insight.level, key);
          } else {
            console.log('[Proactive] ✗ Daily spoken limit reached — skipping voice');
          }
        } else {
          const failed: string[] = [];
          if (!(insight.level === 'strong' || insight.level === 'gentle')) failed.push(`level=${insight.level}`);
          if (!spokenProactiveEnabledRef.current)       failed.push('spoken disabled');
          if (voiceAssistantActiveRef.current)          failed.push('voice assistant active (will retry next poll)');
          if (isProactiveSpeakingRef.current)           failed.push('already speaking (will retry next poll)');
          console.log('[Proactive] ✗ Gate failed — voice skipped (%s)', failed.join(', '));
        }

        // Silent OLED feedback only when not speaking (speakProactive owns OLED when active)
        if (!willSpeak && !alreadyNotified) {
          _showTextRef.current(insight.level === 'strong' ? 'MOLA!' : 'MOLA?');
          setTimeout(() => _returnToIdleRef.current(), 4000);
        }
      } catch {
        // Best-effort — backend may be starting or have no data yet
      }
    };

    /**
     * Queue sweep: fires pending insights that have passed their notBefore time.
     * One insight per sweep tick — successive insights get natural spacing because
     * the sweep itself runs every 30 s and isProactiveSpeakingRef gates TTS.
     * Habit-deferred app-usage insights land here after the 60 s gap.
     */
    const sweepQueue = async () => {
      const now = Date.now();
      const queue = pendingInsightQueueRef.current;
      if (queue.length > 0) {
        console.log('[Proactive][Queue] Sweep tick — pending:', queue.length, queue.map((e) => `${e.insight.app_name}/${e.insight.level} in ${Math.round((e.notBefore - now) / 1000)}s`));
      }
      // Find first entry whose notBefore has elapsed
      const idx = queue.findIndex((e) => now >= e.notBefore);
      if (idx === -1) return;
      const [entry] = queue.splice(idx, 1);
      console.log('[Proactive][Queue] Firing deferred insight:', entry.insight.app_name, entry.insight.level);
      await processInsight(entry.insight);
    };

    /** Fetch real insights from backend + tasks, then pipe through processInsight. */
    const poll = async () => {
      console.log('[Proactive] Poll: START', new Date().toLocaleTimeString());
      try {
        const [appInsight, taskInsight] = await Promise.all([
          statsApi.appInsights(),
          checkTaskInsight(),
        ]);

        // ── Collect ALL eligible app-usage insights (sorted by duration desc,
        //    i.e. strongest first — backend already returns them that way).
        const eligibleAppInsights: AppInsight[] = [];
        if (appInsight.has_insight && appInsight.insights && appInsight.insights.length > 0) {
          // Sort by duration descending (strong before gentle, longest first)
          const sorted = [...appInsight.insights].sort((a, b) => {
            const lvlScore = (l: string) => (l === 'strong' ? 1 : 0);
            return lvlScore(b.level) - lvlScore(a.level);
          });
          for (const i of sorted) {
            if (!shouldSuppressByRejection({ source: 'app_usage', app_name: i.app_name, level: i.level, message: i.message })) {
              eligibleAppInsights.push({
                has_insight: true,
                app_name: i.app_name,
                level: i.level,
                message: i.message,
                insights: appInsight.insights,
                source: 'app_usage',
              });
            }
          }
        } else if (appInsight.has_insight && !shouldSuppressByRejection({ ...appInsight, source: appInsight.source ?? 'app_usage' })) {
          // Preserve the backend-provided source (e.g. 'behavioral') — the old
          // default of overwriting to 'app_usage' swallowed behavioral insights.
          eligibleAppInsights.push({ ...appInsight, source: appInsight.source ?? 'app_usage' });
        }

        // ── Behavioral insight nested under app-usage response ───────────────
        // When both fire, backend attaches behavioral as `response.behavioral`.
        // Surface it so it's eligible alongside the app-usage items.
        if (appInsight.behavioral && appInsight.behavioral.has_insight) {
          const b = appInsight.behavioral;
          if (!shouldSuppressByRejection({ ...b, source: 'behavioral' })) {
            eligibleAppInsights.push({ ...b, source: 'behavioral' });
          }
        }

        // ── Priority: strong task > app usage (longest first) > gentle task ──
        // Task insight fires immediately, not via queue.
        let primaryInsight: AppInsight | null = null;
        if (taskInsight && taskInsight.level === 'strong') {
          primaryInsight = taskInsight;
        } else if (eligibleAppInsights.length > 0) {
          // Check habit-collision: if a habit fired within the last 60 s,
          // defer ALL app-usage insights by the remaining gap (spec: habits
          // fire immediately, app-usage waits +1 min).
          const habitGapMs = 60_000;
          const timeSinceHabit = Date.now() - lastHabitFiredAtRef.current;
          if (lastHabitFiredAtRef.current > 0 && timeSinceHabit < habitGapMs) {
            const deferMs = habitGapMs - timeSinceHabit;
            console.log(`[Proactive][Queue] Habit fired ${Math.round(timeSinceHabit / 1000)}s ago — deferring app-usage insights by ${Math.round(deferMs / 1000)}s`);
            const now = Date.now();
            // Add with 60s stagger between each
            eligibleAppInsights.forEach((ins, idx) => {
              const notBefore = now + deferMs + idx * 60_000;
              // Don't double-queue (check if same key already pending)
              const key = `${ins.source}:${ins.app_name ?? ''}:${ins.level}`;
              const alreadyQueued = pendingInsightQueueRef.current.some(
                (e) => `${e.insight.source}:${e.insight.app_name ?? ''}:${e.insight.level}` === key
              );
              if (!alreadyQueued) {
                pendingInsightQueueRef.current.push({ insight: ins, notBefore });
              }
            });
          } else {
            // No habit collision — fire first immediately, queue rest with 60s stagger
            primaryInsight = eligibleAppInsights[0];
            if (eligibleAppInsights.length > 1) {
              const now = Date.now();
              eligibleAppInsights.slice(1).forEach((ins, idx) => {
                const key = `${ins.source}:${ins.app_name ?? ''}:${ins.level}`;
                const alreadyQueued = pendingInsightQueueRef.current.some(
                  (e) => `${e.insight.source}:${e.insight.app_name ?? ''}:${e.insight.level}` === key
                );
                if (!alreadyQueued) {
                  pendingInsightQueueRef.current.push({ insight: ins, notBefore: now + (idx + 1) * 60_000 });
                  console.log('[Proactive][Queue] Enqueued secondary insight:', ins.app_name, ins.level, 'in', (idx + 1) * 60, 's');
                }
              });
            }
          }
        } else if (taskInsight) {
          primaryInsight = taskInsight;
        }

        if (!primaryInsight) {
          console.log('[Proactive] Poll: no insight (no app ≥ 1h today, no pending tasks)');
          if (eligibleAppInsights.length === 0) {
            setActiveInsight(null);
            lastShownInsightKeyRef.current  = null;
            lastSpokenInsightKeyRef.current = null;
          }
          return;
        }

        await processInsight(primaryInsight);
      } catch {
        // Best-effort — backend may be starting or have no data yet
      }
    };

    // Expose both functions so debug buttons can invoke them on demand.
    _pollRef.current = poll;
    _processInsightRef.current = processInsight;

    // First poll after 60 s (backend settles, recent sessions committed)
    const initialDelay = setTimeout(poll, 60_000);
    // Every 5 minutes — app-usage data only changes meaningfully on that cadence,
    // and polling every 60 s was firing tasksApi.list() + statsApi.appInsights()
    // 60× per hour, adding visible backend load and slowing LLM / TTS responses.
    const interval = setInterval(poll, 5 * 60 * 1000);
    // Queue sweep every 30 s — fires habit-deferred / multi-app queued insights
    queueSweepTimerRef.current = setInterval(sweepQueue, 30_000);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
      if (queueSweepTimerRef.current) {
        clearInterval(queueSweepTimerRef.current);
        queueSweepTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentional: uses latest-ref pattern — no deps needed

  // ── Google Meet presence → meeting-mode suggestion ────────────────────────
  // Polls /api/integrations/google_meet/state every 60 s. When the backend
  // confirms (via participants.list) that the user IS in a live Meet
  // conference and the app isn't already in "meeting" mode, surface a
  // proactive switch_mode insight. Once a meeting_code has been suggested
  // in this session it won't be offered again until full reload.
  useEffect(() => {
    const wasInMeetingRef = { current: false };
    const suggestedCodesRef = new Set<string>();

    const pollMeet = async () => {
      try {
        const res = await integrationsApi.getMeetState();
        if (!res.scope_granted) return;

        const { state } = res;
        const prev = wasInMeetingRef.current;
        wasInMeetingRef.current = state.in_meeting;

        // Transition false → true only
        if (!state.in_meeting || prev) return;
        if (!state.meeting_code) return;
        if (suggestedCodesRef.has(state.meeting_code)) return;

        // Respect current mode — user already in meeting mode? skip.
        if (currentModeRef.current === 'meeting') return;

        // Don't clobber an existing active insight.
        if (activeInsightRef.current) return;

        suggestedCodesRef.add(state.meeting_code);

        const titleLine = state.event_title
          ? `"${state.event_title}" toplantısına katıldın.`
          : 'Bir toplantıya katıldın.';

        const syntheticInsight: AppInsight = {
          has_insight: true,
          source: 'meeting',
          level: 'strong',
          message: `${titleLine} Toplantı moduna geçelim mi?`,
          action: { type: 'switch_mode', mode: 'meeting' },
        };

        setActiveInsight(syntheticInsight);

        // Native OS bildirimi — butonlardan gelen yanıt IPC üzerinden
        // AppContext içindeki accept/deny'i tetikler.
        try {
          (window as any).electronAPI?.showMeetingNotification?.({
            title: 'SADIK — Toplantı',
            body: `${titleLine} Toplantı moduna geçelim mi?`,
          });
        } catch { /* notification optional — ignore */ }
      } catch {
        // Backend down / not connected — silent
      }
    };

    // First poll after 15 s (let calendar sync run once), then every 60 s.
    const initial = setTimeout(pollMeet, 15_000);
    const interval = setInterval(pollMeet, 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // uses refs + closure-captured setters — no deps needed

  // Native meeting toast butonları → accept/deny'e yönlendir.
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onMeetingNotificationAction) return;
    const unsub = api.onMeetingNotificationAction((action: 'accept' | 'deny') => {
      if (action === 'accept') acceptInsightRef.current();
      else denyInsightRef.current();
    });
    return () => { try { unsub?.(); } catch { /* noop */ } };
  }, []);

  // ── Proactive accept / deny ────────────────────────────────────────────────

  /** Stop any proactive TTS currently playing. Used when the user presses the
   *  accept/deny button (or voice-accept triggers) before the sentence ends —
   *  continuing to speak over the animation transition is jarring. */
  const stopProactiveSpeech = () => {
    const entry = currentProactiveAudioRef.current;
    if (!entry) return;
    const { audio, url } = entry;
    try {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.src = '';
    } catch { /* best-effort */ }
    URL.revokeObjectURL(url);
    currentProactiveAudioRef.current = null;
    isProactiveSpeakingRef.current = false;
  };

  const acceptInsight = useCallback(async () => {
    stopProactiveSpeech();
    const insight = activeInsightRef.current;
    console.log('[Proactive] Accept — insight:', insight ? `${rejectionBaseKey(insight)} level=${insight.level} action=${insight.action?.type ?? 'break'}` : 'none');
    // Clear any stored rejection for this key — user accepted, so resume normal cadence.
    if (insight) {
      rejectionMapRef.current.delete(rejectionBaseKey(insight));
      persistRejectionMap(rejectionMapRef.current);
      // Store for post-break counter reset (natural or early cancel)
      if (insight.source === 'app_usage') {
        breakAcceptedInsightRef.current = insight;
      }
    }

    // ── Action dispatch ────────────────────────────────────────────────────
    // Behavioral / workspace insights carry a typed `action` payload.
    // Legacy app-usage path (no action) keeps its original break behavior.
    const action = insight?.action;

    if (action?.type === 'switch_mode') {
      try {
        await modesApi.setMode(action.mode);
        setCurrentMode(action.mode);
        showToast(`${action.mode} moduna geçildi`, 'success');
        triggerEvent('confirmation_success');
      } catch {
        showToast('Mod değiştirilemedi', 'error');
      }
      setActiveInsight(null);
      return;
    }

    if (action?.type === 'open_workspace') {
      try {
        const ws = await workspacesApi.get(action.workspace_id);
        if (ws.mode_sync) {
          try {
            await modesApi.setMode(ws.mode_sync);
            setCurrentMode(ws.mode_sync);
          } catch { /* best-effort, still launch actions */ }
        }
        const electronAPI = (window as any).electronAPI;
        if (electronAPI?.executeWorkspace) {
          await electronAPI.executeWorkspace({
            actions: ws.actions,
            workspaceName: ws.name,
            workspaceRunId: (globalThis.crypto?.randomUUID?.() ?? `proactive-${Date.now()}`),
          });
        }
        showToast(`${ws.name} başlatıldı`, 'success');
        triggerEvent('confirmation_success');
      } catch (err) {
        console.error('[Proactive] open_workspace failed', err);
        showToast('Çalışma alanı başlatılamadı', 'error');
      }
      setActiveInsight(null);
      return;
    }

    // ── Fallback: legacy app-usage break behavior ─────────────────────────
    // Map intensity to break minutes: gentle → 5 min, strong → 15 min
    const breakMinutes = insight?.level === 'strong' ? 15 : 5;
    console.log('[Proactive] Break start — level:', insight?.level, 'breakMinutes:', breakMinutes);

    try {
      await modesApi.setMode('break');
      setCurrentMode('break');
      showToast('Mola moduna geçildi', 'success');

      // mod_break intro plays fully, then startTimer kicks off the pomodoro
      // break. The countdown (MM:SS) from timer_tick replaces the held frame.
      const engine = getAnimationEngine();
      const loaded = getLoadedClipNames();
      const startTimer = async () => {
        try {
          const newState = await pomodoroApi.startBreak(breakMinutes);
          setPomodoroState(newState);
        } catch { /* best-effort */ }
      };
      if (loaded.includes('mod_break')) {
        engine.playModIntroOnce('mod_break', startTimer);
      } else {
        showText('MOLA');
        await startTimer();
      }
    } catch {
      showToast('Mod değiştirilemedi', 'error');
    }
    setActiveInsight(null);
  }, [showText, showToast, getLoadedClipNames, triggerEvent]);

  const denyInsight = useCallback(() => {
    // Capture whether proactive TTS was active BEFORE stopping it.
    // speakProactive triggers 'assistant_speaking' — if interrupted mid-play
    // we must return the engine to idle explicitly.
    const wasProactiveSpeaking = isProactiveSpeakingRef.current;
    stopProactiveSpeech();
    const current = activeInsightRef.current;
    if (current) {
      // Level-aware rejection:
      //   gentle reject → block until escalation to 'strong'
      //   strong reject → block for 2 hours
      const lvl = (current.level === 'strong' ? 'strong' : 'gentle') as 'gentle' | 'strong';
      rejectionMapRef.current.set(rejectionBaseKey(current), { level: lvl, at: Date.now() });
      persistRejectionMap(rejectionMapRef.current);
      console.log('[Proactive] Deny — insight:', rejectionBaseKey(current), 'level recorded:', lvl);
      // Reset the dedup key so a different insight can surface immediately
      lastShownInsightKeyRef.current = null;
    }
    setActiveInsight(null);
    // If proactive TTS was playing, it triggered 'assistant_speaking' on the
    // animation engine — return to idle so the OLED doesn't stay in talking state.
    // resumeWakeWord is idempotent: no-op if wake word was never paused.
    if (wasProactiveSpeaking) {
      resumeWakeWord();
      _returnToIdleRef.current();
    }
  }, [resumeWakeWord]);

  acceptInsightRef.current = acceptInsight;
  denyInsightRef.current   = denyInsight;

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

    // Send local timezone to backend so habit scheduler fires at the right local time
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      http.post('/api/settings/timezone', { timezone: tz }).catch(() => {});
    } catch { /* best-effort */ }

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
        const spokenLimit   = parseInt(s['spoken_proactive_daily_limit'] ?? '3', 10);
        spokenProactiveEnabledRef.current    = spokenEnabled;
        spokenProactiveDailyLimitRef.current = isNaN(spokenLimit) ? 1 : spokenLimit;
        setSpokenProactiveEnabledState(spokenEnabled);
        setSpokenProactiveDailyLimitState(isNaN(spokenLimit) ? 1 : spokenLimit);
        // Load DND
        const savedDnd = s['dnd_active'] === 'true';
        setDndActiveState(savedDnd);
        dndActiveRef.current = savedDnd;
        // Load Sadık position
        const savedPos = s['sadik_position'];
        if (savedPos === 'left' || savedPos === 'right' || savedPos === 'top') {
          setSadikPositionState(savedPos);
        }
        // Load weather
        const wEnabled = s['weather_enabled'] === 'true';
        setWeatherEnabledState(wEnabled);
        weatherEnabledRef.current = wEnabled;
        setWeatherApiKeyState(s['weather_api_key'] ?? '');
        setWeatherLocationLabelState(s['weather_location_label'] ?? s['weather_city'] ?? '');
        setWeatherLatState(s['weather_lat'] ?? '');
        setWeatherLonState(s['weather_lon'] ?? '');
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

  const skipNextBreakStopWatcherRef = useRef(false);
  // Suppresses MM:SS showText in timer_tick — true while the mod_break intro
  // is still playing so the countdown doesn't overwrite the intro clip frames.
  const suppressBreakTimerDisplayRef = useRef(false);

  const handleWSMessage = useCallback(
    (msg: WSMessage) => {
      switch (msg.type) {
        case 'timer_tick': {
          const remaining = msg.data.remaining_seconds as number;
          const isRunning = msg.data.is_running as boolean;
          const phase     = msg.data.phase as PomodoroState['phase'];
          setPomodoroState((prev) => ({
            ...prev,
            remaining_seconds: remaining,
            total_seconds: msg.data.total_seconds as number,
            is_running: isRunning,
            phase,
          }));
          // OLED countdown is only shown during the break phase, and only
          // after the mod_break intro clip has finished rendering.
          const isBreakPhase = phase === 'break' || phase === 'long_break';
          if (isRunning && isBreakPhase && !suppressBreakTimerDisplayRef.current) {
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
          // Work phase finished — backend immediately starts the break phase.
          // Transition to break mode, play the mod_break intro fully, then let
          // upcoming timer_tick ticks render the MM:SS countdown.
          showToast('Pomodoro oturumu tamamlandı!', 'success');
          suppressBreakTimerDisplayRef.current = true;
          modesApi.setMode('break').then(() => setCurrentMode('break')).catch(() => {});
          {
            const engine = getAnimationEngine();
            const loaded = getLoadedClipNames();
            const clearSuppress = () => { suppressBreakTimerDisplayRef.current = false; };
            if (loaded.includes('mod_break')) {
              engine.playModIntroOnce('mod_break', clearSuppress);
            } else {
              clearSuppress();
            }
          }
          break;
        case 'break_completed':
          // Natural break completion — suppress the manual-stop watcher that
          // would otherwise fire on the subsequent is_running→false transition.
          skipNextBreakStopWatcherRef.current = true;
          // Spec: natural break end → counter reset (suggestion "completed")
          console.log('[Proactive] Break completed (natural) — counter reset');
          clearBreakAcceptedInsightRef.current();
          _speakProactiveRef.current('Mola bitti. Hazırsan devam edelim.');
          showToast('Mola sona erdi!', 'info');
          getAnimationEngine().triggerEvent('return_to_idle');
          modesApi.endCurrent().then(() => setCurrentMode(null)).catch(() => {});
          break;
        case 'habit_reminder': {
          console.log('[habits] WS event received', msg.data);
          const habitName        = msg.data.name as string;
          const habitDesc        = msg.data.description as string | null | undefined;
          const minutesBefore    = msg.data.minutes_before as number;
          const spokenName       = (habitDesc ? `${habitName}. ${habitDesc}` : habitName);
          const whenPhrase       = minutesBefore > 0 ? `${minutesBefore} dakika sonra başlayacak` : 'şimdi başlıyor';
          const ttsText          = `Alışkanlık hatırlatması: ${spokenName}. ${whenPhrase}.`;
          const panelMessage     = habitDesc
            ? `${habitName} — ${habitDesc} (${minutesBefore > 0 ? `${minutesBefore} dk sonra` : 'şimdi'})`
            : `${habitName} (${minutesBefore > 0 ? `${minutesBefore} dk sonra` : 'şimdi'})`;

          // Dashboard suggestion panel
          setActiveInsight({
            has_insight: true,
            level: 'strong',
            message: panelMessage,
            source: 'habit',
          });

          // Toast
          showToast(`Alışkanlık: ${habitName}`, 'info');

          // OLED
          getAnimationEngine().triggerEvent('confirmation_success');

          // Electron native notification
          try {
            const electron = (window as any).sadikElectron;
            if (electron?.showNotification) {
              electron.showNotification('Alışkanlık', habitName);
            } else {
              new Notification('Alışkanlık', { body: habitName });
            }
          } catch { /* best-effort */ }

          // TTS — pause/resume wake word around playback.
          // Mark isProactiveSpeaking so app-usage poll gates TTS during habit playback.
          // Record lastHabitFiredAt so app-usage insights are deferred 1 min (spec).
          lastHabitFiredAtRef.current = Date.now();
          (async () => {
            try {
              isProactiveSpeakingRef.current = true;
              pauseWakeWord();
              const blob  = await voiceApi.tts(ttsText);
              const url   = URL.createObjectURL(blob);
              const audio = new Audio(url);
              audio.onended = () => {
                URL.revokeObjectURL(url);
                isProactiveSpeakingRef.current = false;
                resumeWakeWord();
                returnToIdle();
              };
              audio.onerror = () => {
                URL.revokeObjectURL(url);
                isProactiveSpeakingRef.current = false;
                resumeWakeWord();
                returnToIdle();
              };
              // Show speaking animation while habit reminder TTS plays
              getAnimationEngine().triggerEvent('assistant_speaking');
              await audio.play();
            } catch {
              // TTS failed — wake word was paused; resume it
              isProactiveSpeakingRef.current = false;
              resumeWakeWord();
              returnToIdle();
            }
          })();
          break;
        }
      }
    },
    [showToast, showText, returnToIdle, triggerEvent, getLoadedClipNames, pauseWakeWord, resumeWakeWord]
  );

  useWebSocket(handleWSMessage);

  // Manual pomodoro-stop mid-break: if the user hit "Bitir" on the Pomodoro
  // timer during a break phase while break mode is active, exit break mode
  // and play the confirming clip. Natural completion is handled separately
  // by the `break_completed` WS handler above.
  const prevBreakRunningRef = useRef(false);
  useEffect(() => {
    const wasRunning = prevBreakRunningRef.current;
    const isRunning  = pomodoroState.is_running && pomodoroState.phase === 'break';
    prevBreakRunningRef.current = isRunning;
    if (wasRunning && !pomodoroState.is_running && currentMode === 'break') {
      if (skipNextBreakStopWatcherRef.current) {
        skipNextBreakStopWatcherRef.current = false;
        return;
      }
      // Spec: early break cancel → counter reset, suggestion "completed+accepted"
      console.log('[Proactive] Break cancelled early — counter reset');
      clearBreakAcceptedInsightRef.current();
      modesApi.endCurrent().then(() => setCurrentMode(null)).catch(() => {});
      getAnimationEngine().triggerEvent('confirmation_success');
    }
  }, [pomodoroState.is_running, pomodoroState.phase, currentMode]);

  // ── Focus-triggered calendar sync ──────────────────────────────────────────
  // When the app window regains focus, opportunistically sync google_calendar
  // if it's connected. Throttled to at most once per 30 s to avoid hammering
  // on rapid Alt+Tab. Failures are silently swallowed — this is best-effort.
  const focusSyncLastRef = useRef<number>(0);
  const connectedIntegrationsRef = useRef<IntegrationStatus[]>([]);

  // Keep a fresh list of connected integrations on mount (lightweight, ~1 request).
  useEffect(() => {
    integrationsApi.list()
      .then((list) => { connectedIntegrationsRef.current = list.filter((i) => i.status === 'connected'); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.onAppFocusChanged) return;

    electronAPI.onAppFocusChanged((focused: boolean) => {
      if (!focused) return;
      const now = Date.now();
      if (now - focusSyncLastRef.current < 30_000) return;
      focusSyncLastRef.current = now;

      // Refresh connected list then sync any google_calendar entry.
      integrationsApi.list()
        .then((list) => {
          connectedIntegrationsRef.current = list.filter((i) => i.status === 'connected');
          const gcConnected = list.find((i) => i.provider === 'google_calendar' && i.status === 'connected');
          if (gcConnected) {
            integrationsApi.syncNow('google_calendar').catch(() => {});
          }
        })
        .catch(() => {});
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        playModSequence,
        playModSequenceWithCallback,
        playModIntroOnce,
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
        voiceAssistantActive,
        voiceUiVisible,
        setVoiceUiVisible,
        dndActive,
        setDndActive,
        sadikPosition,
        setSadikPosition,
        weatherEnabled,
        setWeatherEnabled,
        weatherApiKey,
        setWeatherApiKey,
        weatherLocationLabel,
        weatherLat,
        weatherLon,
        setWeatherLocation,
        clearWeatherLocation,
        weatherData,
        weatherError,
        refreshWeather,
        debugForcePoll,
        debugTestTTS,
        debugResetCounters,
        debugSimulateInsight,
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
