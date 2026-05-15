import React, { useState, useEffect, useContext, useRef } from 'react';
import {
  Eye, EyeOff, RefreshCw, AlertTriangle, ChevronDown,
  Bot, Sun, Moon, Radio, Timer, Sparkles, Mic, Headphones, Monitor, Bell,
  LucideIcon, Link2, Calendar, StickyNote, MessageSquare, Video, X, Shield, User, BarChart3, RefreshCcw, Palette,
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import {
  ACTIVITIES,
  PRESET_MODE_POOL,
  type ActivityId,
  recommendModes,
  deriveDominantPersona,
} from '../lib/activityCatalog';
import googleCalIcon from '../assets/brand/google-calender-icon.svg';
import notionIcon from '../assets/brand/notion-icon.svg';
import slackIcon from '../assets/brand/slack-icon.svg';
import zoomIcon from '../assets/brand/zoom-icon.svg';
import { settingsApi, Settings } from '../api/settings';
import { privacyApi } from '../api/privacy';
import { telemetryApi } from '../api/telemetry';
import { invalidateCrashReporterConsent } from '../services/crashReporter';
import { integrationsApi, IntegrationStatus, MEET_REQUIRED_SCOPE } from '../api/integrations';
import { notionApi, NotionStatus, NotionDatabase } from '../api/notion';
import { deviceApi, SerialPort } from '../api/device';
import { chatApi } from '../api/chat';
import { billingApi, BillingStatus } from '../api/billing';
import { wakeApi, WakeModel } from '../api/wake';
import { AppContext } from '../context/AppContext';
import { KVKK_NOTICE } from '../content/kvkkNotice';
import FeedbackButton from '../components/feedback/FeedbackButton';
import UsageStatsCard from '../components/usage/UsageStatsCard';

const DEFAULT_SETTINGS: Settings = {
  openai_api_key: '',
  gemini_api_key: '',
  llm_model: 'gpt-4o-mini',
  connection_method: 'serial',
  serial_port: 'auto',
  serial_baudrate: '460800',
  wifi_device_ip: '',
  pomodoro_work_minutes: '25',
  pomodoro_break_minutes: '5',
  pomodoro_long_break_minutes: '15',
  pomodoro_sessions_before_long_break: '4',
  microphone_device: 'default',
  speaker_device: 'default',
  wake_word_enabled: 'true',
user_name: '',
  greeting_style: 'dostum',
  close_to_tray: 'true',
};

const GREETING_PRESETS = [
  { value: 'dostum',   label: 'Dostum' },
  { value: 'patronum', label: 'Patronum' },
  { value: 'efendim',  label: 'Efendim' },
  { value: 'kankam',   label: 'Kankam' },
  { value: 'hocam',    label: 'Hocam' },
];


interface SettingsPageProps {
  onOpenFeedback?: () => void;
}

export default function SettingsPage({ onOpenFeedback }: SettingsPageProps = {}) {
  const { theme, toggle: toggleTheme } = useTheme();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [wakeModels, setWakeModels] = useState<WakeModel[]>([]);
  // Draft wake model path — committed to backend only on Save.
  const [wakeModelPath, setWakeModelPath] = useState<string>('');
  const savedWakeModelPathRef = useRef<string>('');
  // Wake detection draft — defaults match backend (0.35 / 1.9). Persisted via wakeApi only.
  const [wakeThreshold, setWakeThreshold] = useState(0.35);
  const [wakeInputGain, setWakeInputGain] = useState(1.9);
  const savedWakeThresholdRef = useRef(0.35);
  const savedWakeInputGainRef = useRef(1.9);
  // Tracks the last-persisted personalization values so we can detect changes on save.
  const savedPersonalizationRef = useRef({ user_name: '', greeting_style: '' });
  // Tracks the last-persisted snapshot of editable settings so dirty/cancel can compare.
  const savedSettingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  // In-app navigation guard — set true while user has unsaved changes.
  const [dirty, setDirty] = useState(false);
  const [unsavedDialog, setUnsavedDialog] = useState<null | { onConfirm: () => void }>(null);
  const [appVersion, setAppVersion] = useState<string>('');
  const {
    showToast, triggerEvent,
    wakeWordEnabled, toggleWakeWord,
    wakeWordSensitivity, setWakeWordSensitivity,
    continuousConversation, setContinuousConversation,
    oledSleepTimeoutMinutes, setOledSleepTimeout,
    audioInputDevices,
    audioOutputDevices,
    selectedAudioInputDeviceId,
    selectedAudioOutputDeviceId,
    setSelectedAudioInputDeviceId,
    setSelectedAudioOutputDeviceId,
    refreshAudioDevices,
    proactiveSuggestionsEnabled, setProactiveSuggestionsEnabled,
    proactiveQuietHoursStart,    setProactiveQuietHoursStart,
    proactiveQuietHoursEnd,      setProactiveQuietHoursEnd,
    proactiveDailyLimit,         setProactiveDailyLimit,
    proactiveCooldownMinutes,    setProactiveCooldownMinutes,
    spokenProactiveEnabled,      setSpokenProactiveEnabled,
    spokenProactiveDailyLimit,   setSpokenProactiveDailyLimit,
    sadikPosition,               setSadikPosition,
    weatherEnabled,              setWeatherEnabled,
    weatherApiKey,               setWeatherApiKey,
    weatherLocationLabel,        setWeatherLocation,       clearWeatherLocation,
    weatherData,                 weatherError,
    refreshWeather,
  } = useContext(AppContext);

  // ---------------------------------------------------------------------------
  // Draft mirrors for AppContext-backed settings.
  // The UI binds to these drafts; AppContext setters (which write to backend)
  // are only invoked from handleSave. Initialised lazily from the live context
  // values once they hydrate from the DB.
  // ---------------------------------------------------------------------------
  const [draftWakeWordEnabled,        setDraftWakeWordEnabled]        = useState(wakeWordEnabled);
  const [draftWakeWordSensitivity,    setDraftWakeWordSensitivity]    = useState(wakeWordSensitivity);
  const [draftContinuousConversation, setDraftContinuousConversation] = useState(continuousConversation);
  const [draftOledSleepTimeout,       setDraftOledSleepTimeout]       = useState(oledSleepTimeoutMinutes);
  const [draftAudioInputDeviceId,     setDraftAudioInputDeviceId]     = useState(selectedAudioInputDeviceId);
  const [draftAudioOutputDeviceId,    setDraftAudioOutputDeviceId]    = useState(selectedAudioOutputDeviceId);
  const [draftProactiveEnabled,       setDraftProactiveEnabled]       = useState(proactiveSuggestionsEnabled);
  const [draftProactiveQuietStart,    setDraftProactiveQuietStart]    = useState(proactiveQuietHoursStart);
  const [draftProactiveQuietEnd,      setDraftProactiveQuietEnd]      = useState(proactiveQuietHoursEnd);
  const [draftProactiveDailyLimit,    setDraftProactiveDailyLimit]    = useState(proactiveDailyLimit);
  const [draftProactiveCooldown,      setDraftProactiveCooldown]      = useState(proactiveCooldownMinutes);
  const [draftSpokenEnabled,          setDraftSpokenEnabled]          = useState(spokenProactiveEnabled);
  const [draftSpokenDailyLimit,       setDraftSpokenDailyLimit]       = useState(spokenProactiveDailyLimit);
  const [draftSadikPosition,          setDraftSadikPosition]          = useState(sadikPosition);
  const [draftWeatherEnabled,         setDraftWeatherEnabled]         = useState(weatherEnabled);
  const [draftWeatherLocationLabel,   setDraftWeatherLocationLabel]   = useState(weatherLocationLabel);
  const [draftWeatherLocation,        setDraftWeatherLocation]        = useState<{ label: string; lat: number; lon: number } | null>(null);
  const [draftWeatherCleared,         setDraftWeatherCleared]         = useState(false);
  const [draftPrivacyTierAction, setDraftPrivacyTierAction] = useState<null | 'full' | 'hybrid' | 'local'>(null);

  // First-time hydration: when AppContext finishes loading, sync drafts so we
  // mirror the saved state. Subsequent updates only happen via the user.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    setDraftWakeWordEnabled(wakeWordEnabled);
    setDraftWakeWordSensitivity(wakeWordSensitivity);
    setDraftContinuousConversation(continuousConversation);
    setDraftOledSleepTimeout(oledSleepTimeoutMinutes);
    setDraftAudioInputDeviceId(selectedAudioInputDeviceId);
    setDraftAudioOutputDeviceId(selectedAudioOutputDeviceId);
    setDraftProactiveEnabled(proactiveSuggestionsEnabled);
    setDraftProactiveQuietStart(proactiveQuietHoursStart);
    setDraftProactiveQuietEnd(proactiveQuietHoursEnd);
    setDraftProactiveDailyLimit(proactiveDailyLimit);
    setDraftProactiveCooldown(proactiveCooldownMinutes);
    setDraftSpokenEnabled(spokenProactiveEnabled);
    setDraftSpokenDailyLimit(spokenProactiveDailyLimit);
    setDraftSadikPosition(sadikPosition);
    setDraftWeatherEnabled(weatherEnabled);
    setDraftWeatherLocationLabel(weatherLocationLabel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeWordEnabled, oledSleepTimeoutMinutes, weatherEnabled]);

  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [telemetryConsent, setTelemetryConsent] = useState(false);
  const [privacyExporting, setPrivacyExporting] = useState(false);
  const [privacyTier, setPrivacyTier] = useState<'full' | 'hybrid' | 'local' | 'custom'>('hybrid');
  const [privacyAdvancedOpen, setPrivacyAdvancedOpen] = useState(false);
  const [purgeModal, setPurgeModal] = useState<'closed' | 'step1' | 'step2'>('closed');
  const [purgeToken, setPurgeToken] = useState('');
  const [purgeTokenInput, setPurgeTokenInput] = useState('');
  const [purgeCountdown, setPurgeCountdown] = useState(0);
  const [purgeRequesting, setPurgeRequesting] = useState(false);
  const [purgeConfirming, setPurgeConfirming] = useState(false);
  const [kvkkModal, setKvkkModal] = useState(false);
  const purgeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Billing (feature flag — hidden when enabled=false)
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showWeatherKey, setShowWeatherKey] = useState(false);
  const [weatherKeyDraft, setWeatherKeyDraft] = useState('');
  const [locQuery, setLocQuery] = useState('');
  const [locResults, setLocResults] = useState<import('../api/weather').GeocodeResult[]>([]);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError]     = useState<string | null>(null);
  const locTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setWeatherKeyDraft(weatherApiKey); }, [weatherApiKey]);

  useEffect(() => {
    (window as any).electronAPI?.getAppVersion?.().then((v: string) => setAppVersion(v)).catch(() => {});
  }, []);

  // Debounced geocode search
  useEffect(() => {
    if (locTimerRef.current) clearTimeout(locTimerRef.current);
    if (!draftWeatherEnabled) { setLocResults([]); return; }
    const q = locQuery.trim();
    if (q.length < 2) { setLocResults([]); setLocError(null); return; }
    locTimerRef.current = setTimeout(async () => {
      setLocLoading(true);
      setLocError(null);
      try {
        const { weatherApi } = await import('../api/weather');
        const res = await weatherApi.geocode(q);
        setLocResults(res);
      } catch (e: any) {
        setLocError(e?.response?.data?.detail ?? 'geocode_failed');
        setLocResults([]);
      } finally {
        setLocLoading(false);
      }
    }, 350);
    return () => { if (locTimerRef.current) clearTimeout(locTimerRef.current); };
  }, [locQuery, draftWeatherEnabled]);

  useEffect(() => {
    settingsApi.getAll().then((s) => {
      // Strip wake_threshold/wake_input_gain — we manage these via wakeApi only,
      // so they must not be round-tripped through settingsApi.update (stale-write bug).
      const { wake_threshold, wake_input_gain, ...rest } = s;
      const merged = { ...DEFAULT_SETTINGS, ...rest };
      setSettings(merged);
      savedSettingsRef.current = merged;
      savedPersonalizationRef.current = {
        user_name:      s['user_name']      ?? '',
        greeting_style: s['greeting_style'] ?? '',
      };
      if (wake_threshold)  { const v = parseFloat(wake_threshold);  savedWakeThresholdRef.current = v; setWakeThreshold(v); }
      if (wake_input_gain) { const v = parseFloat(wake_input_gain); savedWakeInputGainRef.current = v; setWakeInputGain(v); }
    }).catch(() => {});
    deviceApi.listPorts().then(setPorts).catch(() => {});
    wakeApi.listModels().then((r) => {
      setWakeModels(r.models);
      setWakeModelPath(r.current);
      savedWakeModelPathRef.current = r.current;
    }).catch(() => {});
    integrationsApi.list().then(setIntegrations).catch(() => {});
    telemetryApi.getConsent().then((r) => setTelemetryConsent(r.enabled)).catch(() => {});
    billingApi.getStatus().then(setBillingStatus).catch(() => {});
  }, []);

  // Polling effect — starts when user clicks "Pro'ya Yükselt", detects free→pro flip.
  useEffect(() => {
    if (!polling) return;
    const startedAt = Date.now();
    const previousTier = billingStatus?.tier; // "free" snapshot at polling start
    const interval = setInterval(async () => {
      if (Date.now() - startedAt > 5 * 60 * 1000) {
        // 5 min hard timeout, silently stop
        clearInterval(interval);
        setPolling(false);
        return;
      }
      try {
        const status = await billingApi.getStatus();
        if (previousTier === 'free' && status.tier === 'pro') {
          clearInterval(interval);
          setPolling(false);
          setBillingStatus(status); // UI refresh — button switches to "Aboneliği Yönet"
          setShowSuccess(true);
        }
      } catch { /* ignore, retry next tick */ }
    }, 3000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, billingStatus?.tier]);

  // Auto-dismiss success toast after 6 seconds.
  useEffect(() => {
    if (!showSuccess) return;
    const timer = setTimeout(() => setShowSuccess(false), 6000);
    return () => clearTimeout(timer);
  }, [showSuccess]);

  // ---------------------------------------------------------------------------
  // Dirty tracking — recompute whenever any draft / settings field changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const baseline = savedSettingsRef.current;
    const settingsChanged = Object.keys(settings).some(
      (k) => (settings[k] ?? '') !== (baseline[k] ?? ''),
    );
    const draftChanged =
      draftWakeWordEnabled        !== wakeWordEnabled        ||
      draftWakeWordSensitivity    !== wakeWordSensitivity    ||
      draftContinuousConversation !== continuousConversation ||
      draftOledSleepTimeout       !== oledSleepTimeoutMinutes ||
      draftAudioInputDeviceId     !== selectedAudioInputDeviceId ||
      draftAudioOutputDeviceId    !== selectedAudioOutputDeviceId ||
      draftProactiveEnabled       !== proactiveSuggestionsEnabled ||
      draftProactiveQuietStart    !== proactiveQuietHoursStart ||
      draftProactiveQuietEnd      !== proactiveQuietHoursEnd ||
      draftProactiveDailyLimit    !== proactiveDailyLimit ||
      draftProactiveCooldown      !== proactiveCooldownMinutes ||
      draftSpokenEnabled          !== spokenProactiveEnabled ||
      draftSpokenDailyLimit       !== spokenProactiveDailyLimit ||
      draftSadikPosition          !== sadikPosition ||
      draftWeatherEnabled         !== weatherEnabled ||
      draftWeatherLocation        !== null ||
      draftWeatherCleared          ||
      draftPrivacyTierAction       !== null;
    const wakeChanged =
      wakeThreshold !== savedWakeThresholdRef.current ||
      wakeInputGain !== savedWakeInputGainRef.current ||
      wakeModelPath !== savedWakeModelPathRef.current;
    setDirty(settingsChanged || draftChanged || wakeChanged);
  }, [
    settings,
    draftWakeWordEnabled, draftWakeWordSensitivity, draftContinuousConversation,
    draftOledSleepTimeout, draftAudioInputDeviceId, draftAudioOutputDeviceId,
    draftProactiveEnabled, draftProactiveQuietStart, draftProactiveQuietEnd,
    draftProactiveDailyLimit, draftProactiveCooldown, draftSpokenEnabled,
    draftSpokenDailyLimit, draftSadikPosition, draftWeatherEnabled,
    draftWeatherLocation, draftWeatherCleared, draftPrivacyTierAction,
    wakeThreshold, wakeInputGain, wakeModelPath,
    wakeWordEnabled, wakeWordSensitivity, continuousConversation,
    oledSleepTimeoutMinutes, selectedAudioInputDeviceId, selectedAudioOutputDeviceId,
    proactiveSuggestionsEnabled, proactiveQuietHoursStart, proactiveQuietHoursEnd,
    proactiveDailyLimit, proactiveCooldownMinutes, spokenProactiveEnabled,
    spokenProactiveDailyLimit, sadikPosition, weatherEnabled,
  ]);

  // beforeunload guard — warn if user closes window with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // In-app navigation guard. Intercepts clicks on app navigation elements
  // (anchors, sidebar buttons) at the document level. If draft is dirty,
  // shows a confirmation dialog before allowing the navigation to proceed.
  useEffect(() => {
    if (!dirty) return;
    const handler = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      // Find nearest <a> or [data-nav-link] ancestor — those represent route
      // changes outside the SettingsPage container.
      const navEl = target.closest('a[href], [data-nav-link]') as HTMLElement | null;
      if (!navEl) return;
      // Ignore clicks inside the SettingsPage main content (it has no nav
      // anchors of its own that change route).
      if (navEl.closest('[data-settings-page]')) return;
      ev.preventDefault();
      ev.stopPropagation();
      const click = () => navEl.click();
      setUnsavedDialog({ onConfirm: () => { savedSettingsRef.current = settings; setDirty(false); setTimeout(click, 0); } });
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [dirty, settings]);

  const set = (key: string, value: string) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  // Reset every draft + the editable-settings object back to the last
  // persisted snapshot. Used by "Vazgeç" and the unsaved-changes dialog.
  const cancelDraft = () => {
    setSettings(savedSettingsRef.current);
    setWakeThreshold(savedWakeThresholdRef.current);
    setWakeInputGain(savedWakeInputGainRef.current);
    setWakeModelPath(savedWakeModelPathRef.current);
    setDraftWakeWordEnabled(wakeWordEnabled);
    setDraftWakeWordSensitivity(wakeWordSensitivity);
    setDraftContinuousConversation(continuousConversation);
    setDraftOledSleepTimeout(oledSleepTimeoutMinutes);
    setDraftAudioInputDeviceId(selectedAudioInputDeviceId);
    setDraftAudioOutputDeviceId(selectedAudioOutputDeviceId);
    setDraftProactiveEnabled(proactiveSuggestionsEnabled);
    setDraftProactiveQuietStart(proactiveQuietHoursStart);
    setDraftProactiveQuietEnd(proactiveQuietHoursEnd);
    setDraftProactiveDailyLimit(proactiveDailyLimit);
    setDraftProactiveCooldown(proactiveCooldownMinutes);
    setDraftSpokenEnabled(spokenProactiveEnabled);
    setDraftSpokenDailyLimit(spokenProactiveDailyLimit);
    setDraftSadikPosition(sadikPosition);
    setDraftWeatherEnabled(weatherEnabled);
    setDraftWeatherLocationLabel(weatherLocationLabel);
    setDraftWeatherLocation(null);
    setDraftWeatherCleared(false);
    setDraftPrivacyTierAction(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 1) Generic settings (everything except wake_threshold/wake_input_gain).
      await settingsApi.update(settings);

      // 2) Wake model — only if changed.
      if (wakeModelPath !== savedWakeModelPathRef.current) {
        try {
          await wakeApi.selectModel(wakeModelPath);
        } catch (e: any) {
          showToast(e?.response?.data?.detail ?? 'Wake modeli yüklenemedi', 'error');
        }
      }

      // 3) Wake detection params — always commit so the slider changes stick
      // even if `settings` happens to be otherwise equal.
      if (
        wakeThreshold !== savedWakeThresholdRef.current ||
        wakeInputGain !== savedWakeInputGainRef.current
      ) {
        await wakeApi.updateSettings({
          wake_threshold: wakeThreshold,
          wake_input_gain: wakeInputGain,
        });
      }

      // 4) AppContext-backed setters (each writes to backend internally).
      const tasks: Promise<unknown>[] = [];
      if (draftWakeWordEnabled !== wakeWordEnabled)               tasks.push(Promise.resolve(toggleWakeWord()));
      if (draftWakeWordSensitivity !== wakeWordSensitivity)       tasks.push(Promise.resolve(setWakeWordSensitivity(draftWakeWordSensitivity)));
      if (draftContinuousConversation !== continuousConversation) tasks.push(Promise.resolve(setContinuousConversation(draftContinuousConversation)));
      if (draftOledSleepTimeout !== oledSleepTimeoutMinutes)      tasks.push(setOledSleepTimeout(draftOledSleepTimeout));
      if (draftAudioInputDeviceId !== selectedAudioInputDeviceId) tasks.push(setSelectedAudioInputDeviceId(draftAudioInputDeviceId));
      if (draftAudioOutputDeviceId !== selectedAudioOutputDeviceId) tasks.push(setSelectedAudioOutputDeviceId(draftAudioOutputDeviceId));
      if (draftProactiveEnabled !== proactiveSuggestionsEnabled)  tasks.push(setProactiveSuggestionsEnabled(draftProactiveEnabled));
      if (draftProactiveQuietStart !== proactiveQuietHoursStart)  tasks.push(setProactiveQuietHoursStart(draftProactiveQuietStart));
      if (draftProactiveQuietEnd !== proactiveQuietHoursEnd)      tasks.push(setProactiveQuietHoursEnd(draftProactiveQuietEnd));
      if (draftProactiveDailyLimit !== proactiveDailyLimit)       tasks.push(setProactiveDailyLimit(draftProactiveDailyLimit));
      if (draftProactiveCooldown !== proactiveCooldownMinutes)    tasks.push(setProactiveCooldownMinutes(draftProactiveCooldown));
      if (draftSpokenEnabled !== spokenProactiveEnabled)          tasks.push(setSpokenProactiveEnabled(draftSpokenEnabled));
      if (draftSpokenDailyLimit !== spokenProactiveDailyLimit)    tasks.push(setSpokenProactiveDailyLimit(draftSpokenDailyLimit));
      if (draftSadikPosition !== sadikPosition)                   tasks.push(setSadikPosition(draftSadikPosition));
      if (draftWeatherEnabled !== weatherEnabled)                 tasks.push(setWeatherEnabled(draftWeatherEnabled));
      if (weatherKeyDraft !== weatherApiKey)                      tasks.push(setWeatherApiKey(weatherKeyDraft));
      if (draftWeatherCleared)                                    tasks.push(Promise.resolve(clearWeatherLocation()));
      if (draftWeatherLocation)                                   tasks.push(setWeatherLocation(draftWeatherLocation));
      await Promise.allSettled(tasks);

      // 5) Privacy tier — applied last so its broadcast flag updates win.
      if (draftPrivacyTierAction) {
        try {
          const res = await privacyApi.setTier(draftPrivacyTierAction);
          setPrivacyTier(res.tier);
          Object.entries(res.flags).forEach(([k, v]) => set(k, v ? 'true' : 'false'));
          set('privacy_tier', res.tier);
        } catch {
          showToast('Gizlilik modu güncellenemedi', 'error');
        }
      }

      // Snapshot the new persisted state.
      savedSettingsRef.current = settings;
      savedWakeThresholdRef.current = wakeThreshold;
      savedWakeInputGainRef.current = wakeInputGain;
      savedWakeModelPathRef.current = wakeModelPath;
      setDraftWeatherLocation(null);
      setDraftWeatherCleared(false);
      setDraftPrivacyTierAction(null);

      const prevName  = savedPersonalizationRef.current.user_name;
      const prevStyle = savedPersonalizationRef.current.greeting_style;
      const personalizationChanged =
        (settings.user_name      ?? '') !== prevName ||
        (settings.greeting_style ?? '') !== prevStyle;

      triggerEvent('confirmation_success');
      if (personalizationChanged) {
        await chatApi.clearHistory();
        savedPersonalizationRef.current = {
          user_name:      settings.user_name      ?? '',
          greeting_style: settings.greeting_style ?? '',
        };
        showToast('Kişiselleştirme güncellendi, konuşma geçmişi sıfırlandı.', 'success');
      } else {
        showToast('Ayarlar kaydedildi', 'success');
      }
      setDirty(false);
    } catch {
      showToast('Ayarlar kaydedilemedi', 'error');
    }
    setSaving(false);
  };

  const refreshPorts = async () => {
    const p = await deviceApi.listPorts().catch(() => []);
    setPorts(p);
  };

  const handlePrivacyToggle = (key: string, value: boolean) => {
    // Draft-only — committed on Save. Mark tier custom in the local snapshot.
    setSettings((prev) => ({ ...prev, [key]: value ? 'true' : 'false', privacy_tier: 'custom' }));
    setPrivacyTier('custom');
    setDraftPrivacyTierAction(null);
  };

  const handleTierSelect = (tier: 'full' | 'hybrid' | 'local') => {
    // Draft-only — actual privacyApi.setTier call deferred to handleSave.
    setDraftPrivacyTierAction(tier);
    setPrivacyTier(tier);
  };

  useEffect(() => {
    privacyApi.getTier()
      .then((res) => setPrivacyTier(res.tier))
      .catch(() => {});
  }, []);

  const handleTelemetryToggle = async (enabled: boolean) => {
    setTelemetryConsent(enabled);
    invalidateCrashReporterConsent(enabled);
    try {
      await telemetryApi.setConsent(enabled);
    } catch {
      setTelemetryConsent(!enabled);
      invalidateCrashReporterConsent(!enabled);
      showToast('Telemetri ayarı kaydedilemedi', 'error');
    }
  };

  const handleExportData = async () => {
    setPrivacyExporting(true);
    try {
      const blob = await privacyApi.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `sadik-backup-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Veri indirildi', 'success');
    } catch {
      showToast('Veri indirilemedi', 'error');
    } finally {
      setPrivacyExporting(false);
    }
  };

  const handleRequestPurgeToken = async () => {
    setPurgeRequesting(true);
    try {
      const res = await privacyApi.requestPurgeToken();
      setPurgeToken(res.token);
      setPurgeCountdown(res.expires_in);
      setPurgeModal('step2');
      if (purgeTimerRef.current) clearInterval(purgeTimerRef.current);
      purgeTimerRef.current = setInterval(() => {
        setPurgeCountdown((c) => {
          if (c <= 1) {
            clearInterval(purgeTimerRef.current!);
            purgeTimerRef.current = null;
            setPurgeModal('closed');
            setPurgeToken('');
            setPurgeTokenInput('');
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    } catch {
      showToast('Onay kodu alınamadı', 'error');
    } finally {
      setPurgeRequesting(false);
    }
  };

  const handleConfirmPurge = async () => {
    if (purgeTokenInput.trim() !== purgeToken) {
      showToast('Kod hatalı', 'error');
      return;
    }
    setPurgeConfirming(true);
    try {
      await privacyApi.confirmPurge(purgeToken);
      showToast('Tüm veriler silindi', 'success');
      setPurgeModal('closed');
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      showToast('Silme işlemi başarısız', 'error');
    } finally {
      setPurgeConfirming(false);
    }
  };

  const closePurgeModal = () => {
    if (purgeTimerRef.current) { clearInterval(purgeTimerRef.current); purgeTimerRef.current = null; }
    setPurgeModal('closed');
    setPurgeToken('');
    setPurgeTokenInput('');
    setPurgeCountdown(0);
  };

  return (
    <>
    <div data-settings-page className="h-full overflow-y-auto p-6 page-transition">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-text-primary mb-6">Ayarlar</h1>

        {/* API key warning banner */}
        {!settings.openai_api_key && (
          <div className="flex items-start gap-3 bg-accent-yellow/10 border border-accent-yellow/30 rounded-card px-4 py-3 mb-4">
            <AlertTriangle size={15} className="text-accent-yellow flex-shrink-0 mt-0.5" />
            <p className="text-xs text-accent-yellow leading-relaxed">
              OpenAI erişim anahtarı ayarlanmamış. Sohbet ve sesli asistan özellikleri çalışmayacak.
              Lütfen aşağıdan erişim anahtarınızı girin ve kaydedin.
            </p>
          </div>
        )}

        {/* ── 0. GÖRÜNÜM ───────────────────────────────────────────────────────── */}
        <Section title="Görünüm" icon={Palette} color="purple">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-text-primary">Tema</p>
              <p className="text-xs text-text-muted mt-0.5">Arayüz renk temasını seç</p>
            </div>
            <div className="flex items-center gap-1 bg-bg-input border border-border rounded-btn p-0.5">
              <button
                onClick={() => theme === 'light' && toggleTheme()}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-sm font-medium transition-all ${
                  theme === 'dark'
                    ? 'bg-bg-card text-text-primary shadow-sm border border-border'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <Moon size={14} /> Koyu
              </button>
              <button
                onClick={() => theme === 'dark' && toggleTheme()}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-sm font-medium transition-all ${
                  theme === 'light'
                    ? 'bg-bg-card text-text-primary shadow-sm border border-border'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <Sun size={14} /> Açık
              </button>
            </div>
          </div>
        </Section>

        {/* ── 1. GENEL ─────────────────────────────────────────────────────────── */}
        <Section title="Genel" icon={Monitor} color="green">
          {/* Hava Durumu */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Hava Durumu</p>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">Hava durumunu üst çubukta göster</p>
                <p className="text-xs text-text-muted leading-relaxed">
                  Açıldığında saat yanındaki ikona küçük bir hava durumu rozeti eklenir; solda derece (°C) yazar.
                </p>
              </div>
              <button
                onClick={() => setDraftWeatherEnabled((v) => !v)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors
                  ${draftWeatherEnabled ? 'bg-accent-purple' : 'bg-bg-input border border-border'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                  ${draftWeatherEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {draftWeatherEnabled && (
              <>
                <Field label="OpenWeatherMap Erişim Anahtarı">
                  <div className="relative">
                    <input
                      type={showWeatherKey ? 'text' : 'password'}
                      value={weatherKeyDraft}
                      onChange={(e) => setWeatherKeyDraft(e.target.value)}
                      placeholder="openweathermap.org üzerinden ücretsiz alınabilir"
                      className="input-field pr-10"
                    />
                    <button
                      onClick={() => setShowWeatherKey(!showWeatherKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                    >
                      {showWeatherKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </Field>
                <Field label="Konum">
                  {(() => {
                    const effectiveLabel = draftWeatherCleared
                      ? ''
                      : (draftWeatherLocation?.label ?? weatherLocationLabel);
                    return effectiveLabel;
                  })() ? (
                    <div className="flex items-center justify-between gap-3 bg-bg-input border border-border rounded-btn px-3 py-2">
                      <span className="text-sm text-text-primary truncate">
                        {draftWeatherLocation?.label ?? weatherLocationLabel}
                      </span>
                      <button
                        onClick={() => { setDraftWeatherCleared(true); setDraftWeatherLocation(null); setLocQuery(''); }}
                        className="text-xs text-text-muted hover:text-accent-red transition-colors flex-shrink-0"
                      >
                        Değiştir
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        type="text"
                        value={locQuery}
                        onChange={(e) => setLocQuery(e.target.value)}
                        placeholder="Mahalle, semt, şehir veya cadde ara…"
                        className="input-field"
                      />
                      {(locLoading || locResults.length > 0 || locError) && (
                        <div className="absolute z-10 left-0 right-0 mt-1 bg-bg-card border border-border rounded-btn shadow-lg max-h-60 overflow-auto">
                          {locLoading && (
                            <div className="px-3 py-2 text-xs text-text-muted">Aranıyor…</div>
                          )}
                          {locError && !locLoading && (
                            <div className="px-3 py-2 text-xs text-accent-red">{locError}</div>
                          )}
                          {!locLoading && !locError && locResults.length === 0 && locQuery.trim().length >= 2 && (
                            <div className="px-3 py-2 text-xs text-text-muted">Sonuç bulunamadı</div>
                          )}
                          {locResults.map((r) => (
                            <button
                              key={`${r.lat},${r.lon},${r.label}`}
                              onClick={() => {
                                setDraftWeatherLocation({ label: r.label, lat: r.lat, lon: r.lon });
                                setDraftWeatherCleared(false);
                                setLocQuery('');
                                setLocResults([]);
                              }}
                              className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-hover transition-colors border-b border-border last:border-0"
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-[11px] text-text-muted mt-1.5">
                    OpenWeatherMap üzerinden mahalle/semt seviyesinde arama. Erişim anahtarı gerekir.
                  </p>
                </Field>
                <div className="flex items-center justify-between gap-3 pt-1">
                  <div className="text-xs text-text-muted">
                    {weatherData
                      ? `Güncel: ${Math.round(weatherData.temp_c)}°C • ${weatherData.description} • ${weatherData.city}`
                      : weatherError
                        ? `Hata: ${weatherError}`
                        : 'Henüz veri yok.'}
                  </div>
                  <button
                    onClick={() => refreshWeather()}
                    className="px-3 py-1.5 text-xs rounded-btn bg-bg-input border border-border text-text-secondary hover:text-text-primary transition-colors"
                  >
                    Şimdi yenile
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="border-t border-border pt-4 mt-2 space-y-3">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Cihaz Bağlantısı</p>
            <p className="text-xs text-text-muted leading-relaxed">
              Sadık cihazı çoğu durumda otomatik algılanır. Gerekirse portu manuel seçebilirsiniz. OLED parlaklığı soldaki yan panelden ayarlanabilir.
            </p>
            <Field label="Ekran uyku süresi">
              <select
                value={String(draftOledSleepTimeout)}
                onChange={(e) => setDraftOledSleepTimeout(Number(e.target.value))}
                className="input-field"
              >
                <option value="0">Kapalı</option>
                <option value="1">1 dakika (test)</option>
                <option value="3">3 dakika</option>
                <option value="5">5 dakika</option>
                <option value="10">10 dakika</option>
                <option value="15">15 dakika</option>
                <option value="30">30 dakika</option>
              </select>
              <p className="text-[11px] text-text-muted mt-1.5">
                OLED ekranı korumak için belirli bir süre işlem olmazsa ekran kapanır.
              </p>
            </Field>
            <Field label="Bağlantı Yöntemi">
              <div className="flex gap-4">
                {['serial', 'wifi'].map((m) => (
                  <label key={m} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="connection_method" value={m}
                      checked={settings.connection_method === m}
                      onChange={() => set('connection_method', m)}
                      className="accent-accent-purple" />
                    <span className="text-sm text-text-primary">{m === 'serial' ? 'USB Serial' : 'WiFi'}</span>
                  </label>
                ))}
              </div>
            </Field>
            {settings.connection_method === 'serial' && (
              <>
                <Field label="Seri Port">
                  <div className="flex gap-2">
                    <select value={settings.serial_port} onChange={(e) => set('serial_port', e.target.value)}
                      className="flex-1 input-field">
                      <option value="auto">Otomatik</option>
                      {ports.map((p) => (
                        <option key={p.port} value={p.port}>{p.port} — {p.description}</option>
                      ))}
                    </select>
                    <button onClick={refreshPorts}
                      className="p-2 bg-bg-input border border-border rounded-btn text-text-muted hover:text-text-primary transition-colors">
                      <RefreshCw size={15} />
                    </button>
                  </div>
                </Field>
                <Field label="Baudrate">
                  <input type="text" value={settings.serial_baudrate}
                    onChange={(e) => set('serial_baudrate', e.target.value)}
                    className="input-field" />
                </Field>
              </>
            )}
            {settings.connection_method === 'wifi' && (
              <Field label="WiFi IP Adresi">
                <input type="text" value={settings.wifi_device_ip}
                  onChange={(e) => set('wifi_device_ip', e.target.value)}
                  placeholder="192.168.1.x" className="input-field" />
              </Field>
            )}
          </div>

          <div className="border-t border-border pt-4 mt-2 space-y-3">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Uygulama Davranışı</p>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-text-secondary mb-0.5">
                  Kapatınca sistem tepsisine küçült
                </p>
                <p className="text-xs text-text-muted leading-relaxed">
                  Bu ayar açıksa pencereyi kapatmak uygulamayı tamamen kapatmaz; Sadık arka planda
                  çalışmaya devam eder. Sistem tepsisi simgesinden tekrar açabilir ya da çıkış yapabilirsiniz.
                </p>
              </div>
              <button
                onClick={() =>
                  set('close_to_tray', settings['close_to_tray'] === 'false' ? 'true' : 'false')
                }
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors
                  ${settings['close_to_tray'] !== 'false'
                    ? 'bg-accent-purple'
                    : 'bg-bg-input border border-border'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                    ${settings['close_to_tray'] !== 'false' ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>
          </div>

          <div className="border-t border-border pt-4 mt-2 space-y-3">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Pomodoro</p>
            <p className="text-xs text-text-muted">Odaklanma seansı süreleri.</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Çalışma Süresi (dk)">
                <input type="number" value={settings.pomodoro_work_minutes}
                  onChange={(e) => set('pomodoro_work_minutes', e.target.value)}
                  className="input-field" min={1} max={120} />
              </Field>
              <Field label="Mola Süresi (dk)">
                <input type="number" value={settings.pomodoro_break_minutes}
                  onChange={(e) => set('pomodoro_break_minutes', e.target.value)}
                  className="input-field" min={1} max={60} />
              </Field>
              <Field label="Uzun Mola Süresi (dk)">
                <input type="number" value={settings.pomodoro_long_break_minutes}
                  onChange={(e) => set('pomodoro_long_break_minutes', e.target.value)}
                  className="input-field" min={1} max={60} />
              </Field>
              <Field label="Uzun Mola Öncesi Oturum">
                <input type="number" value={settings.pomodoro_sessions_before_long_break}
                  onChange={(e) => set('pomodoro_sessions_before_long_break', e.target.value)}
                  className="input-field" min={1} max={10} />
              </Field>
            </div>
          </div>
        </Section>

        {/* ── 2. SES ───────────────────────────────────────────────────────────── */}
        <Section title="Ses" icon={Mic} color="purple">
          <div className="border-t border-border pt-4 mt-2 space-y-3">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Ses Aygıtları</p>
            <p className="text-xs text-text-muted leading-relaxed">
              Sadık için hangi mikrofon ve hoparlörün kullanılacağını seçin.
            </p>
            <Field label="Mikrofon">
              <div className="flex gap-2">
                <select
                  value={draftAudioInputDeviceId}
                  onChange={(e) => setDraftAudioInputDeviceId(e.target.value)}
                  className="flex-1 input-field"
                >
                  <option value="default">Sistem varsayılanı</option>
                  {audioInputDevices.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Mikrofon ${i + 1}`}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => refreshAudioDevices()}
                  title="Aygıtları yenile"
                  className="p-2 bg-bg-input border border-border rounded-btn text-text-muted hover:text-text-primary transition-colors"
                >
                  <RefreshCw size={15} />
                </button>
              </div>
            </Field>
            <Field label="Hoparlör / Çıkış">
              <select
                value={draftAudioOutputDeviceId}
                onChange={(e) => setDraftAudioOutputDeviceId(e.target.value)}
                className="input-field"
              >
                <option value="default">Sistem varsayılanı</option>
                {audioOutputDevices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Çıkış ${i + 1}`}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="border-t border-border pt-4 mt-2 space-y-3">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Uyandırma Kelimesi</p>
            <Field label="Uyandırma Kelimesi Aktif">
              <button
                onClick={() => setDraftWakeWordEnabled((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                  ${draftWakeWordEnabled ? 'bg-accent-purple' : 'bg-bg-input border border-border'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                  ${draftWakeWordEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <p className="text-[11px] text-text-muted mt-1.5">
                Yerel ses algılama — uygulama açıkken aktif olur. Şu an söylenmesi gereken uyandırma kelimesi: <strong>"Hey Jarvis"</strong>
              </p>
            </Field>

            <Field label="Uyandırma Modeli">
              <select
                value={wakeModelPath}
                onChange={(e) => setWakeModelPath(e.target.value)}
                className="input-field"
              >
                <option value="">Varsayılan — Hey Jarvis (yerleşik)</option>
                {wakeModels.map((m) => (
                  <option key={m.path} value={m.path}>{m.name}</option>
                ))}
              </select>
              <p className="text-[11px] text-text-muted mt-1.5">
                <code>sadik-backend/app/wake_models/</code> klasörüne .onnx dosyası ekleyip listeden seçin. Değişiklik Kaydet'e basınca uygulanır.
              </p>
            </Field>

            {draftWakeWordEnabled && (
              <Field label="Uyandırma Hassasiyeti">
                <select
                  value={draftWakeWordSensitivity}
                  onChange={(e) => setDraftWakeWordSensitivity(e.target.value)}
                  className="input-field"
                >
                  <option value="very_high">Çok hassas — uzak mikrofon için</option>
                  <option value="high">Hassas</option>
                  <option value="normal">Normal (önerilen)</option>
                  <option value="low">Düşük — gürültülü ortam için</option>
                </select>
              </Field>
            )}

            <Field label={`Algılama Eşiği — ${wakeThreshold.toFixed(2)}`}>
              <input
                type="range"
                min={0.1} max={0.9} step={0.05}
                value={wakeThreshold}
                onChange={(e) => setWakeThreshold(parseFloat(e.target.value))}
                className="w-full accent-accent-purple"
              />
              <p className="text-[11px] text-text-muted mt-1">
                Düşük değer = daha kolay tetiklenir (yanlış pozitif riski artar). Custom model için önerilen: 0.35.
              </p>
            </Field>

            <Field label={`Giriş Kazancı — ${wakeInputGain.toFixed(1)}×`}>
              <input
                type="range"
                min={1.0} max={3.0} step={0.1}
                value={wakeInputGain}
                onChange={(e) => setWakeInputGain(parseFloat(e.target.value))}
                className="w-full accent-accent-purple"
              />
              <p className="text-[11px] text-text-muted mt-1">
                Mikrofon sesi düşükse artır. Çok yüksek ses / yakın mikrofonda 1.0 bırak.
              </p>
            </Field>

            {/* continuous_conversation: beta'da gizlendi — tek-turn enforced (T9.5.7). */}
          </div>
        </Section>

        {/* ── 3. ENTEGRASYONLAR ─────────────────────────────────────────────── */}
        <Section title="Entegrasyonlar" icon={Link2} color="cyan">
          <IntegrationsPanel
            integrations={integrations}
            showToast={showToast}
            onDisconnect={async (provider) => {
              await integrationsApi.disconnect(provider);
              const updated = await integrationsApi.list();
              setIntegrations(updated);
            }}
            onRefresh={async () => {
              const updated = await integrationsApi.list();
              setIntegrations(updated);
            }}
          />
        </Section>

        {/* ── 4. KİŞİSELLEŞTİRME ──────────────────────────────────────────── */}
        <Section title="Kişiselleştirme" icon={Sparkles} color="pink">
          <Field label="Adınız">
            <input
              type="text"
              value={settings.user_name ?? ''}
              onChange={(e) => set('user_name', e.target.value)}
              placeholder="örn. Eren"
              className="input-field"
            />
          </Field>

          <Field label="Hitap şekli">
            <div className="flex flex-wrap gap-2 mb-2">
              {GREETING_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => set('greeting_style', p.value)}
                  className={`px-3 py-1.5 rounded-btn text-xs font-medium transition-colors
                    ${settings.greeting_style === p.value
                      ? 'bg-accent-purple text-white border border-accent-purple'
                      : 'bg-bg-input text-text-secondary border border-border hover:border-accent-purple/40 hover:text-text-primary'}`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => set('greeting_style', '')}
                className={`px-3 py-1.5 rounded-btn text-xs font-medium transition-colors
                  ${!GREETING_PRESETS.some((p) => p.value === settings.greeting_style)
                    ? 'bg-accent-purple text-white border border-accent-purple'
                    : 'bg-bg-input text-text-secondary border border-border hover:border-accent-purple/40 hover:text-text-primary'}`}
              >
                Özel
              </button>
            </div>
            {!GREETING_PRESETS.some((p) => p.value === settings.greeting_style) && (
              <input
                type="text"
                value={settings.greeting_style ?? ''}
                onChange={(e) => set('greeting_style', e.target.value)}
                placeholder="örn. Üstat"
                className="input-field"
                autoFocus
              />
            )}
          </Field>
          <p className="text-[11px] text-text-muted -mt-1">
            Ad veya hitap değiştiğinde konuşma geçmişi sıfırlanır.
          </p>

          <Field label="Sadık'ın Konumu">
            <select
              value={draftSadikPosition}
              onChange={(e) => setDraftSadikPosition(e.target.value as 'left' | 'right' | 'top')}
              className="input-field"
            >
              <option value="left">Sol</option>
              <option value="right">Sağ</option>
              <option value="top">Üst</option>
            </select>
            <p className="text-[11px] text-text-muted mt-1">
              Sadık'ın fiziksel konumu — odaklanma animasyonu buna göre ayarlanır.
            </p>
          </Field>

          <div className="border-t border-border pt-4 mt-2 space-y-3">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Aktiviteler &amp; Modlar</p>
            <p className="text-xs text-text-muted leading-relaxed">
              Bilgisayarda yaptığın aktivitelere göre Sadık'ın dili ve önerilen modlar ayarlanır.
            </p>

            {/* Aktivite checklist */}
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {ACTIVITIES.map((a) => {
                const currentActivities = (settings.user_activities || '').split(',').map((s: string) => s.trim()).filter(Boolean) as ActivityId[];
                const active = currentActivities.includes(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => {
                      const current = (settings.user_activities || '').split(',').map((s: string) => s.trim()).filter(Boolean) as ActivityId[];
                      const updated = active
                        ? current.filter((id) => id !== a.id)
                        : [...current, a.id];
                      set('user_activities', updated.join(','));
                      // Persona'yı da güncelle
                      if (updated.length > 0) {
                        set('user_persona', deriveDominantPersona(updated));
                      }
                    }}
                    className={`text-left p-2 rounded-btn border transition-colors flex flex-col gap-1 ${
                      active
                        ? 'bg-accent-purple/10 border-accent-purple'
                        : 'bg-bg-input border-border hover:border-accent-purple/40'
                    }`}
                  >
                    <div className={`rounded-lg bg-bg-input p-1.5 w-fit ${active ? 'bg-accent-purple/20' : ''}`}>
                      <a.icon size={16} className={active ? 'text-accent-purple' : 'text-text-muted'} />
                    </div>
                    <span className="text-[11px] font-semibold text-text-primary leading-tight">{a.label}</span>
                    {active && <span className="text-[10px] text-accent-purple">✓</span>}
                  </button>
                );
              })}
            </div>

            {/* Aktif modlar */}
            <div className="pt-2">
              <p className="text-xs font-medium text-text-secondary mb-1.5">Aktif Modlar</p>
              {(() => {
                const currentModeKeys = (settings.user_preset_modes || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                const displayKeys = currentModeKeys.length > 0 ? currentModeKeys : ['working', 'learning', 'break', 'meeting'];
                return (
                  <div className="flex flex-wrap gap-1.5">
                    {displayKeys.map((key: string) => {
                      const def = PRESET_MODE_POOL.find((p) => p.key === key);
                      return (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-btn text-xs bg-accent-purple/10 border border-accent-purple/30 text-accent-purple"
                        >
                          {def?.label ?? key}
                          <button
                            onClick={() => {
                              const updated = displayKeys.filter((k: string) => k !== key);
                              set('user_preset_modes', updated.join(','));
                            }}
                            className="text-accent-purple/60 hover:text-accent-purple ml-0.5"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                    {/* Havuzdan ekle inline select */}
                    <select
                      value=""
                      onChange={(e) => {
                        const key = e.target.value;
                        if (!key) return;
                        const current = (settings.user_preset_modes || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                        if (!current.includes(key)) {
                          set('user_preset_modes', [...current, key].join(','));
                        }
                      }}
                      className="px-2 py-1 rounded-btn text-xs bg-bg-input border border-border text-text-secondary outline-none hover:border-accent-purple/40 focus:border-accent-purple/60"
                    >
                      <option value="">+ Ekle</option>
                      {PRESET_MODE_POOL
                        .filter((p) => {
                          const current = (settings.user_preset_modes || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                          return !current.includes(p.key);
                        })
                        .map((p) => (
                          <option key={p.key} value={p.key}>{p.label}</option>
                        ))}
                    </select>
                  </div>
                );
              })()}
            </div>

            {/* Önerilenleri uygula butonu */}
            <button
              onClick={() => {
                const currentActivities = (settings.user_activities || '').split(',').map((s: string) => s.trim()).filter(Boolean) as ActivityId[];
                if (currentActivities.length === 0) return;
                const recommended = recommendModes(currentActivities);
                set('user_preset_modes', recommended.join(','));
              }}
              className="flex items-center gap-1.5 text-xs text-accent-purple hover:text-accent-purple/80 transition-colors"
            >
              <RefreshCcw size={12} />
              Önerilenleri uygula
            </button>
          </div>

          <div className="border-t border-border pt-4 mt-2 space-y-3">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Proaktif Öneriler</p>
            <p className="text-xs text-text-muted leading-relaxed">
              Sadık kullanım alışkanlıklarınıza göre mola ve dikkat önerileri gösterebilir.
            </p>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-text-secondary mb-0.5">Proaktif öneriler</p>
                <p className="text-xs text-text-muted leading-relaxed">
                  Etkinleştirildiğinde Sadık günlük uygulama kullanımınıza göre mola önerisinde bulunur.
                </p>
              </div>
              <button
                onClick={() => setDraftProactiveEnabled((v) => !v)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors
                  ${draftProactiveEnabled ? 'bg-accent-purple' : 'bg-bg-input border border-border'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                  ${draftProactiveEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {draftProactiveEnabled && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Sessiz saat başlangıcı">
                    <select
                      value={draftProactiveQuietStart}
                      onChange={(e) => setDraftProactiveQuietStart(e.target.value)}
                      className="input-field"
                    >
                      {Array.from({ length: 24 }, (_, h) => {
                        const val = `${String(h).padStart(2, '0')}:00`;
                        return <option key={val} value={val}>{val}</option>;
                      })}
                    </select>
                  </Field>
                  <Field label="Sessiz saat bitişi">
                    <select
                      value={draftProactiveQuietEnd}
                      onChange={(e) => setDraftProactiveQuietEnd(e.target.value)}
                      className="input-field"
                    >
                      {Array.from({ length: 24 }, (_, h) => {
                        const val = `${String(h).padStart(2, '0')}:00`;
                        return <option key={val} value={val}>{val}</option>;
                      })}
                    </select>
                  </Field>
                </div>
                <p className="text-[11px] text-text-muted -mt-2">
                  Bu saatler arasında bildirim gönderilmez. Gece geçişini destekler (ör. 23:00 → 08:00).
                </p>

                <Field label="Günlük maksimum öneri">
                  <select
                    value={String(draftProactiveDailyLimit)}
                    onChange={(e) => setDraftProactiveDailyLimit(Number(e.target.value))}
                    className="input-field"
                  >
                    <option value="1">1 öneri</option>
                    <option value="2">2 öneri</option>
                    <option value="3">3 öneri (önerilen)</option>
                    <option value="5">5 öneri</option>
                    <option value="8">8 öneri</option>
                    <option value="10">10 öneri</option>
                    <option value="15">15 öneri</option>
                    <option value="0">Sınırsız</option>
                  </select>
                </Field>

                <Field label="Öneriler arası bekleme">
                  <select
                    value={String(draftProactiveCooldown)}
                    onChange={(e) => setDraftProactiveCooldown(Number(e.target.value))}
                    className="input-field"
                  >
                    <option value="15">15 dakika</option>
                    <option value="30">30 dakika</option>
                    <option value="45">45 dakika</option>
                    <option value="60">60 dakika (önerilen)</option>
                    <option value="90">90 dakika</option>
                    <option value="120">120 dakika</option>
                  </select>
                </Field>

                <div className="border-t border-border-subtle pt-4 mt-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-text-primary font-medium">Sesli proaktif öneriler</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        Sadık uygun durumlarda kısa sesli mola önerileri sunabilir.
                      </p>
                    </div>
                    <button
                      onClick={() => setDraftSpokenEnabled((v) => !v)}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors
                        ${draftSpokenEnabled ? 'bg-accent-purple' : 'bg-bg-input border border-border'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                        ${draftSpokenEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  {draftSpokenEnabled && (
                    <div className="mt-3">
                      <Field label="Günlük sesli öneri sınırı">
                        <select
                          value={String(draftSpokenDailyLimit)}
                          onChange={(e) => setDraftSpokenDailyLimit(Number(e.target.value))}
                          className="input-field"
                        >
                          <option value="0">Kapalı</option>
                          <option value="1">1 öneri (önerilen)</option>
                          <option value="2">2 öneri</option>
                          <option value="3">3 öneri</option>
                          <option value="5">5 öneri</option>
                          <option value="8">8 öneri</option>
                          <option value="10">10 öneri</option>
                        </select>
                      </Field>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </Section>

        {/* ── 5. GİZLİLİK & TELEMETRİ ─────────────────────────────────────── */}
        <Section title="Gizlilik & Telemetri" icon={Shield} color="cyan">
          {/* Crash raporları */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">Crash raporları gönder</p>
              <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
                Uygulama çöktüğünde anonim hata bilgisini geliştiriciye gönderir. Kişisel veri gönderilmez.
              </p>
            </div>
            <button
              onClick={() => handleTelemetryToggle(!telemetryConsent)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors mt-0.5
                ${telemetryConsent ? 'bg-accent-cyan' : 'bg-bg-input border border-border'}`}
              aria-label="Crash raporları gönder"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                ${telemetryConsent ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* AI Deneyim Modu */}
          <div className="border-t border-border pt-4 mt-2 space-y-2">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">AI Deneyim Modu</p>
            <p className="text-xs text-text-muted leading-relaxed">
              Sadık'ın OpenAI'a ne kadar veri paylaşacağını belirler. İstediğin zaman değiştirebilirsin.
            </p>
            <div className="grid grid-cols-1 gap-2 pt-1">
              {([
                { id: 'full',   title: '🔓 Tam',       sub: 'Maksimum zeka — tüm veri + araçlar + öğrenme' },
                { id: 'hybrid', title: '⚖️ Dengeli',    sub: 'Okuma/silme araçları, davranış öğrenme kapalı' },
                { id: 'local',  title: '🔒 Yerel',     sub: 'Sadık sadece sohbet eder; veriye erişmez' },
              ] as const).map(({ id, title, sub }) => {
                const active = privacyTier === id;
                return (
                  <button
                    key={id}
                    onClick={() => handleTierSelect(id)}
                    className={`text-left p-3 rounded-btn border transition-colors disabled:opacity-60
                      ${active
                        ? 'bg-accent-purple/10 border-accent-purple'
                        : 'bg-bg-input border-border hover:border-accent-purple/40'}`}
                  >
                    <p className="text-sm font-semibold text-text-primary">{title}</p>
                    <p className="text-xs text-text-muted mt-0.5">{sub}</p>
                  </button>
                );
              })}
            </div>
            {privacyTier === 'custom' && (
              <p className="text-[11px] text-accent-orange pt-1">
                Özel ayar aktif — gelişmiş bölümden tek tek değiştirdin.
              </p>
            )}
          </div>

          {/* Gelişmiş accordion */}
          <div className="border-t border-border pt-4">
            <button
              onClick={() => setPrivacyAdvancedOpen((o) => !o)}
              className="w-full flex items-center justify-between text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              <span>Gelişmiş Ayarlar</span>
              <span className="text-text-muted">{privacyAdvancedOpen ? '▲' : '▼'}</span>
            </button>
          </div>

          {privacyAdvancedOpen && (
          <>
          {(
            [
              { key: 'privacy_behavioral_learning', label: 'Davranış Öğrenme', desc: 'Kullanım alışkanlıklarını öğrenip sana daha iyi öneriler getirsin.' },
              { key: 'privacy_calendar_push',       label: 'Takvim Bilgisini Yapay Zekaya Aktar', desc: 'Google Calendar etkinlikleri Sadık\'ın sesli cevaplarında kullanılabilsin.' },
              { key: 'privacy_notion_push',         label: 'Notion İçeriğini Yapay Zekaya Aktar', desc: 'Notion görevlerin Sadık\'ın yanıtlarına dahil edilsin.' },
              { key: 'privacy_voice_memory',        label: 'Ses Hafızası', desc: 'Önceki sesli sohbetler hatırlansın.' },
            ] as { key: string; label: string; desc: string }[]
          ).map(({ key, label, desc }) => {
            const enabled = settings[key] === 'true';
            return (
              <div key={key} className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-text-secondary mb-0.5">{label}</p>
                  <p className="text-xs text-text-muted leading-relaxed">{desc}</p>
                  <p className={`text-[11px] mt-1 ${enabled ? 'text-accent-orange' : 'text-text-muted'}`}>
                    {enabled
                      ? 'Şu an açık — veri OpenAI\'a gidebilir.'
                      : 'Şu an kapalı — Sadık bu veriyi OpenAI\'a göndermiyor.'}
                  </p>
                </div>
                <button
                  onClick={() => handlePrivacyToggle(key, !enabled)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors
                    ${enabled ? 'bg-accent-purple' : 'bg-bg-input border border-border'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                    ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            );
          })}
          </>
          )}

          <div className="border-t border-border pt-4 flex flex-col gap-3">
            <button
              onClick={handleExportData}
              disabled={privacyExporting}
              className="w-full py-2 text-sm rounded-btn bg-bg-input border border-border text-text-secondary hover:text-text-primary hover:border-accent-green/40 transition-colors disabled:opacity-60"
            >
              {privacyExporting ? 'İndiriliyor…' : 'Verimi İndir'}
            </button>
            <button
              onClick={() => setPurgeModal('step1')}
              className="w-full py-2 text-sm rounded-btn bg-accent-red/10 border border-accent-red/30 text-accent-red hover:bg-accent-red/20 transition-colors font-semibold"
            >
              Tüm Verimi Sil
            </button>
          </div>

          <button
            onClick={() => setKvkkModal(true)}
            className="text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary transition-colors"
          >
            KVKK Aydınlatma Metni
          </button>
        </Section>

        {/* ── 6. HESAP & KULLANIM ──────────────────────────────────────────── */}
        <Section title="Hesap & Kullanım" icon={Bot} color="purple">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">API Ayarları</p>
          <Field label="OpenAI Erişim Anahtarı">
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={settings.openai_api_key}
                onChange={(e) => set('openai_api_key', e.target.value)}
                placeholder="sk-..."
                className="input-field pr-10"
              />
              <button onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors">
                {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>
          <Field label="Gemini Erişim Anahtarı">
            <div className="relative">
              <input
                type={showGeminiKey ? 'text' : 'password'}
                value={settings.gemini_api_key ?? ''}
                onChange={(e) => set('gemini_api_key', e.target.value)}
                placeholder="AIza..."
                className="input-field pr-10"
              />
              <button onClick={() => setShowGeminiKey(!showGeminiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors">
                {showGeminiKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-[11px] text-text-muted mt-1.5">
              Sesli asistan V2 (Gemini Live) için Google AI Studio anahtarı. Voice V2 etkinken gerekli.
            </p>
          </Field>
          <Field label="Yapay zeka modeli">
            <select
              value={settings.llm_model}
              onChange={(e) => set('llm_model', e.target.value)}
              className="input-field"
            >
              <option value="gpt-4o">GPT-4o (önerilen)</option>
              <option value="gpt-4o-mini">GPT-4o Mini — Hızlı, ekonomik</option>
            </select>
            <p className="text-[11px] text-text-muted mt-1.5">
              Daha güçlü modeller daha iyi yanıt verir ancak daha maliyetli olabilir.
            </p>
          </Field>

          <div className="border-t border-border pt-4 mt-2 space-y-2">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Kullanım İstatistikleri</p>
            <p className="text-xs text-text-muted leading-relaxed">
              Sesli asistan kullanımın — maliyet tahmini ve gecikme analizi.
            </p>
            <UsageStatsCard />
          </div>

          {billingStatus?.enabled && (
            <div className="border-t border-border pt-4 mt-2 space-y-3">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Abonelik</p>
              <p className="text-xs text-text-muted leading-relaxed">
                {billingStatus.tier === 'pro'
                  ? `Pro plan aktif${billingStatus.expires_at ? ' — ' + new Date(billingStatus.expires_at).toLocaleDateString('tr-TR') + ' tarihine kadar' : ''}.`
                  : 'Ücretsiz plandasyın. Pro\'ya geçerek limitleri kaldır.'}
              </p>
              {billingStatus.tier === 'free' ? (
                <button
                  disabled={billingLoading}
                  onClick={async () => {
                    setBillingLoading(true);
                    try {
                      const { url } = await billingApi.createCheckout();
                      window.open(url, '_blank');
                      setPolling(true);
                    } catch {
                      showToast('Ödeme sayfası açılamadı. Lütfen tekrar dene.', 'error');
                    } finally {
                      setBillingLoading(false);
                    }
                  }}
                  className="px-4 py-2 text-sm rounded-btn bg-accent-purple text-white hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  {billingLoading ? 'Yönlendiriliyor…' : "Pro'ya Yükselt"}
                </button>
              ) : (
                <button
                  disabled={billingLoading}
                  onClick={async () => {
                    setBillingLoading(true);
                    try {
                      const { url } = await billingApi.openPortal();
                      window.open(url, '_blank');
                    } catch {
                      showToast('Abonelik portalı açılamadı. Lütfen tekrar dene.', 'error');
                    } finally {
                      setBillingLoading(false);
                    }
                  }}
                  className="px-4 py-2 text-sm rounded-btn bg-bg-input border border-border text-text-primary hover:border-accent-purple/40 transition-colors disabled:opacity-60"
                >
                  {billingLoading ? 'Yönlendiriliyor…' : 'Aboneliği Yönet'}
                </button>
              )}
            </div>
          )}
        </Section>

        {dirty && (
          <p className="text-xs text-accent-orange text-center mt-2">
            Kaydedilmemiş değişiklikler var.
          </p>
        )}
        <div className="flex gap-2 mt-2">
          <button onClick={cancelDraft} disabled={saving || !dirty}
            className="flex-1 py-3 bg-bg-input border border-border text-text-secondary hover:text-text-primary font-medium rounded-btn transition-colors disabled:opacity-40 text-sm">
            Vazgeç
          </button>
          <button onClick={handleSave} disabled={saving || !dirty}
            className="flex-[2] py-3 bg-accent-purple hover:bg-accent-purple-hover text-white font-semibold rounded-btn transition-colors disabled:opacity-60 text-sm">
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>

        {appVersion && (
          <div className="text-center text-xs text-gray-500 opacity-60 py-4">
            v{appVersion}
          </div>
        )}
      </div>
    </div>

    {/* Purge modal */}
    {purgeModal !== 'closed' && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-bg-card border border-border rounded-card w-full max-w-md mx-4 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-accent-red">Tüm Verimi Sil</h3>
            <button onClick={closePurgeModal} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
          </div>

          {purgeModal === 'step1' && (
            <>
              <div className="bg-accent-red/10 border border-accent-red/30 rounded-btn px-4 py-3">
                <p className="text-sm text-accent-red font-semibold mb-1">Bu işlem geri alınamaz.</p>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Tüm görevlerin, alışkanlıkların, ayarların ve konuşma geçmişin silinecek.
                  Kurulum ekranından yeniden başlayacaksın.
                </p>
              </div>
              <button
                onClick={handleRequestPurgeToken}
                disabled={purgeRequesting}
                className="w-full py-2.5 text-sm rounded-btn bg-accent-red text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {purgeRequesting ? 'Kod isteniyor…' : 'Onay Kodu İste'}
              </button>
              <button onClick={closePurgeModal} className="w-full py-2 text-xs text-text-muted hover:text-text-secondary transition-colors">
                Vazgeç
              </button>
            </>
          )}

          {purgeModal === 'step2' && (
            <>
              <p className="text-sm text-text-secondary leading-relaxed">
                Aşağıdaki kodu gir ve <strong>Sil</strong> butonuna bas. Kod{' '}
                <span className="text-accent-red font-semibold">{purgeCountdown}s</span> içinde geçersiz olacak.
              </p>
              <div className="bg-bg-input border border-border rounded-btn px-4 py-3 text-center">
                <code className="text-lg font-mono font-bold text-text-primary tracking-widest">{purgeToken}</code>
              </div>
              <input
                type="text"
                value={purgeTokenInput}
                onChange={(e) => setPurgeTokenInput(e.target.value)}
                placeholder="Kodu buraya yaz…"
                className="input-field w-full font-mono tracking-widest text-center"
                autoFocus
              />
              <button
                onClick={handleConfirmPurge}
                disabled={purgeConfirming || purgeTokenInput.trim().length === 0}
                className="w-full py-2.5 text-sm rounded-btn bg-accent-red text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {purgeConfirming ? 'Siliniyor…' : 'Sil'}
              </button>
              <button onClick={closePurgeModal} className="w-full py-2 text-xs text-text-muted hover:text-text-secondary transition-colors">
                Vazgeç
              </button>
            </>
          )}
        </div>
      </div>
    )}

    {/* Unsaved changes confirmation */}
    {unsavedDialog && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-bg-card border border-border rounded-card w-full max-w-sm p-6 space-y-4">
          <h3 className="text-base font-bold text-text-primary">Kaydedilmemiş değişiklikler</h3>
          <p className="text-sm text-text-secondary leading-relaxed">
            Bu sayfada kaydedilmemiş değişiklikler var. Çıkmadan önce ne yapmak istersin?
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={async () => { const cb = unsavedDialog.onConfirm; setUnsavedDialog(null); await handleSave(); cb(); }}
              className="w-full py-2.5 text-sm rounded-btn bg-accent-purple text-white font-semibold hover:bg-accent-purple-hover transition-colors"
            >
              Kaydet
            </button>
            <button
              onClick={() => { const cb = unsavedDialog.onConfirm; cancelDraft(); setUnsavedDialog(null); cb(); }}
              className="w-full py-2 text-sm rounded-btn bg-bg-input border border-border text-text-secondary hover:text-text-primary transition-colors"
            >
              Yine de çık (değişiklikleri at)
            </button>
            <button
              onClick={() => setUnsavedDialog(null)}
              className="w-full py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              İptal
            </button>
          </div>
        </div>
      </div>
    )}

    {/* KVKK modal */}
    {kvkkModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-bg-card border border-border rounded-card w-full max-w-2xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h3 className="text-base font-bold text-text-primary">KVKK Aydınlatma Metni</h3>
            <button onClick={() => setKvkkModal(false)} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {KVKK_NOTICE.map((section) => (
              <div key={section.title}>
                <h4 className="text-sm font-semibold text-text-primary mb-2">{section.title}</h4>
                {section.body.map((para, i) => (
                  <p key={i} className="text-sm text-text-muted leading-relaxed whitespace-pre-line mb-2">{para}</p>
                ))}
              </div>
            ))}
          </div>
          <div className="p-6 border-t border-border">
            <button
              onClick={() => setKvkkModal(false)}
              className="w-full py-2 text-sm rounded-btn bg-bg-input border border-border text-text-secondary hover:text-text-primary transition-colors"
            >
              Kapat
            </button>
          </div>
        </div>
      </div>
    )}
    {onOpenFeedback && <FeedbackButton onClick={onOpenFeedback} />}

    {/* Pro upgrade success toast */}
    {showSuccess && (
      <div
        className="fixed top-4 right-4 z-[70] flex items-center gap-3 bg-bg-card border border-accent-purple/40 rounded-card px-4 py-3 shadow-lg text-sm text-text-primary"
        style={{ maxWidth: 320 }}
      >
        <span>🎉 Pro aboneliğiniz aktif — teşekkürler!</span>
        <button
          onClick={() => setShowSuccess(false)}
          className="ml-auto text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
          aria-label="Kapat"
        >
          <X size={14} />
        </button>
      </div>
    )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Integrations panel
// ---------------------------------------------------------------------------

const PROVIDER_UI: Record<string, {
  name: string;
  desc: string;
  icon: LucideIcon;
  color: string;
  iconClass: string;
}> = {
  google_calendar: {
    name: 'Google Takvim',
    desc: 'Etkinlikleri Ajanda sayfasına çek',
    icon: Calendar,
    color: 'cyan',
    iconClass: 'text-accent-cyan',
  },
  notion: {
    name: 'Notion',
    desc: 'Veritabanlarını görevlere dönüştür',
    icon: StickyNote,
    color: 'purple',
    iconClass: 'text-accent-purple',
  },
  slack: {
    name: 'Slack',
    desc: 'Aktif kanal aktivitesini takip et',
    icon: MessageSquare,
    color: 'pink',
    iconClass: 'text-accent-pink',
  },
  zoom: {
    name: 'Zoom',
    desc: 'Aktif toplantıda modu tetikle',
    icon: Video,
    color: 'orange',
    iconClass: 'text-accent-orange',
  },
};

const KNOWN_PROVIDERS = ['google_calendar', 'notion', 'slack', 'zoom'];

/** Simple relative-time formatter (no libraries) */
function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'az önce';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

// ---------------------------------------------------------------------------
// Google Calendar card (full OAuth flow)
// ---------------------------------------------------------------------------

function GoogleCalendarCard({
  status,
  onRefresh,
  showToast,
}: {
  status: IntegrationStatus;
  onRefresh: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isConnected = status.status === 'connected';
  const isError = status.status === 'error';
  const meetScopeMissing = isConnected && !(status.scopes ?? '').includes(MEET_REQUIRED_SCOPE);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { auth_url } = await integrationsApi.getConnectUrl('google_calendar');
      if ((window as any).electronAPI?.shellOpenExternal) {
        await (window as any).electronAPI.shellOpenExternal(auth_url);
      } else {
        window.open(auth_url, '_blank');
      }
      // Poll every 3s for up to 2 min waiting for callback to connect
      let elapsed = 0;
      pollRef.current = setInterval(async () => {
        elapsed += 3000;
        try {
          const list = await integrationsApi.list();
          const entry = list.find((i) => i.provider === 'google_calendar');
          if (entry?.status === 'connected') {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setConnecting(false);
            onRefresh();
            // Sync immediately so events appear without waiting for the 60 s tick.
            setSyncing(true);
            try {
              await integrationsApi.syncNow('google_calendar');
              showToast('Takvim eşitleme tamamlandı', 'success');
              onRefresh();
            } catch { /* best-effort */ } finally { setSyncing(false); }
          }
        } catch { /* ignore */ }
        if (elapsed >= 120000) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setConnecting(false);
        }
      }, 3000);
    } catch {
      setConnecting(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await integrationsApi.syncNow('google_calendar');
      onRefresh();
    } catch { /* ignore */ } finally { setSyncing(false); }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await integrationsApi.disconnect('google_calendar');
      onRefresh();
    } catch { /* ignore */ } finally { setDisconnecting(false); }
  };

  return (
    <div className="bg-bg-card border border-border rounded-card px-4 py-3">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <span className="flex-shrink-0 mt-0.5 text-accent-cyan">
          <Calendar size={20} />
        </span>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary">Google Takvim</p>
          <p className="text-xs text-text-muted leading-relaxed">Etkinlikleri Ajanda sayfasına çek</p>

          {/* Status */}
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0
              ${isConnected ? 'bg-accent-green' : isError ? 'bg-accent-red' : 'bg-text-muted/40'}`} />
            <span className={`text-xs ${isConnected ? 'text-accent-green' : isError ? 'text-accent-red' : 'text-text-muted'}`}>
              {isConnected
                ? `Bağlı${status.account_email ? ': ' + status.account_email : ''}`
                : isError ? 'Hata' : 'Bağlı değil'}
            </span>
          </div>

          {isConnected && status.last_sync_at && (
            <p className="text-[11px] text-text-muted mt-0.5">
              Son eşitleme: {relativeTime(status.last_sync_at)}
            </p>
          )}
          {isError && status.last_error && (
            <p className="text-[11px] text-accent-red mt-0.5 truncate" title={status.last_error}>
              {status.last_error}
            </p>
          )}

          {meetScopeMissing && (
            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-accent-orange">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <span className="leading-snug">
                Google Meet toplantı algılama için yeniden bağlan — mevcut oturumda Meet izni yok.
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="ml-1 underline hover:text-accent-cyan disabled:opacity-50"
                >
                  Tekrar bağlan
                </button>
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 ml-2 mt-0.5 flex items-center gap-1.5">
          {isConnected ? (
            <>
              <button
                onClick={handleSyncNow}
                disabled={syncing}
                className="px-2.5 py-1.5 text-xs rounded-btn bg-bg-input border border-border text-text-secondary hover:text-accent-cyan hover:border-accent-cyan/40 transition-colors disabled:opacity-60"
              >
                {syncing ? '...' : 'Eşitle'}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="px-2.5 py-1.5 text-xs rounded-btn bg-bg-input border border-border text-text-secondary hover:text-accent-red hover:border-accent-red/40 transition-colors disabled:opacity-60"
              >
                {disconnecting ? '...' : 'Kes'}
              </button>
            </>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting}
              title="Google ile bağlan"
              className="px-3 py-1.5 text-xs rounded-btn bg-accent-cyan/15 border border-accent-cyan/30 text-accent-cyan hover:bg-accent-cyan/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {connecting ? 'Bekleniyor…' : 'Bağlan'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notion card (full OAuth flow + database selector)
// ---------------------------------------------------------------------------

function NotionCard({
  onRefresh,
  showToast,
}: {
  onRefresh: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [notionStatus, setNotionStatus] = useState<NotionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [credsMissing, setCredsMissing] = useState(false);
  const [databases, setDatabases] = useState<NotionDatabase[]>([]);
  const [dbsLoading, setDbsLoading] = useState(false);
  const [selectedDbId, setSelectedDbId] = useState<string>('');
  const [selectedDbName, setSelectedDbName] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load status on mount
  useEffect(() => {
    loadStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Load databases when connected
  useEffect(() => {
    if (notionStatus?.connected) {
      loadDatabases();
    } else {
      setDatabases([]);
      setSelectedDbId('');
      setSelectedDbName('');
    }
  }, [notionStatus?.connected]);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const s = await notionApi.getStatus();
      setNotionStatus(s);
      setCredsMissing(false);
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? '';
      if (err?.response?.status === 500 || detail === 'notion_client_id_not_configured') {
        setCredsMissing(true);
      }
      setNotionStatus({ connected: false, workspace_name: null });
    } finally {
      setLoading(false);
    }
  };

  const loadDatabases = async () => {
    setDbsLoading(true);
    try {
      const { databases: dbs } = await notionApi.listDatabases();
      setDatabases(dbs);
    } catch {
      setDatabases([]);
    } finally {
      setDbsLoading(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setCredsMissing(false);
    try {
      const { auth_url } = await notionApi.startOAuth();
      if ((window as any).electronAPI?.shellOpenExternal) {
        await (window as any).electronAPI.shellOpenExternal(auth_url);
      } else {
        window.open(auth_url, '_blank');
      }
      // Poll every 3 s for up to 2 min
      let elapsed = 0;
      pollRef.current = setInterval(async () => {
        elapsed += 3000;
        try {
          const s = await notionApi.getStatus();
          if (s.connected) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setConnecting(false);
            setNotionStatus(s);
            onRefresh();
            showToast('Notion bağlandı', 'success');
          }
        } catch { /* ignore */ }
        if (elapsed >= 120000) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setConnecting(false);
        }
      }, 3000);
    } catch (err: any) {
      setConnecting(false);
      const detail = err?.response?.data?.detail ?? '';
      if (err?.response?.status === 500 || detail === 'notion_client_id_not_configured') {
        setCredsMissing(true);
      }
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Notion bağlantısını kesmek istediğinize emin misiniz?')) return;
    setDisconnecting(true);
    try {
      await notionApi.disconnect();
      setNotionStatus({ connected: false, workspace_name: null });
      setDatabases([]);
      setSelectedDbId('');
      setSelectedDbName('');
      onRefresh();
      showToast('Notion bağlantısı kesildi', 'info');
    } catch { /* ignore */ } finally {
      setDisconnecting(false);
    }
  };

  const handleDatabaseChange = async (dbId: string) => {
    const db = databases.find((d) => d.id === dbId);
    if (!db) return;
    setSelectedDbId(db.id);
    setSelectedDbName(db.title);
    try {
      await notionApi.selectDatabase(db.id, db.title);
      showToast(`Veritabanı seçildi: ${db.title}`, 'success');
    } catch {
      showToast('Veritabanı seçilemedi', 'error');
    }
  };

  const isConnected = notionStatus?.connected ?? false;

  return (
    <div className="bg-bg-card border border-border rounded-card px-4 py-3">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <span className="flex-shrink-0 mt-0.5 text-accent-purple">
          <StickyNote size={20} />
        </span>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary">Notion</p>
          <p className="text-xs text-text-muted leading-relaxed">
            Notion sayfaları görev olarak 5 dakikada bir eşitlenir.
            {' '}'Status' veya 'Durum' alanı 'Tamamlandı' ise görev tamamlanmış sayılır.
          </p>

          {/* Status indicator */}
          {!loading && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0
                ${isConnected ? 'bg-accent-green' : credsMissing ? 'bg-accent-red' : 'bg-text-muted/40'}`} />
              <span className={`text-xs ${isConnected ? 'text-accent-green' : credsMissing ? 'text-accent-red' : 'text-text-muted'}`}>
                {isConnected
                  ? `Bağlı${notionStatus?.workspace_name ? ': ' + notionStatus.workspace_name : ''}`
                  : credsMissing
                  ? 'Notion entegrasyonu yapılandırılmamış'
                  : connecting ? 'Bağlanıyor…' : 'Bağlı değil'}
              </span>
            </div>
          )}

          {/* Selected DB badge */}
          {isConnected && selectedDbName && (
            <p className="text-[11px] text-accent-purple mt-0.5">
              Eşitleme: {selectedDbName}
            </p>
          )}

          {/* Database selector */}
          {isConnected && (
            <div className="mt-2">
              {dbsLoading ? (
                <p className="text-xs text-text-muted">Veritabanları yükleniyor…</p>
              ) : databases.length > 0 ? (
                <select
                  value={selectedDbId}
                  onChange={(e) => handleDatabaseChange(e.target.value)}
                  className="text-xs bg-bg-input border border-border rounded-btn px-2 py-1 text-text-primary w-full max-w-xs focus:outline-none focus:border-accent-purple/50"
                >
                  <option value="">— Veritabanı seç —</option>
                  {databases.map((db) => (
                    <option key={db.id} value={db.id}>{db.title}</option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-text-muted">Erişilebilir veritabanı bulunamadı.</p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 ml-2 mt-0.5 flex items-center gap-1.5">
          {isConnected ? (
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="px-2.5 py-1.5 text-xs rounded-btn bg-bg-input border border-border text-text-secondary hover:text-accent-red hover:border-accent-red/40 transition-colors disabled:opacity-60"
            >
              {disconnecting ? '...' : 'Bağlantıyı Kes'}
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting || credsMissing || loading}
              title={credsMissing ? 'Notion entegrasyonu yapılandırılmamış' : 'Notion ile bağlan'}
              className="px-3 py-1.5 text-xs rounded-btn bg-accent-purple/15 border border-accent-purple/30 text-accent-purple hover:bg-accent-purple/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {connecting ? 'Bekleniyor…' : 'Bağlan'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function IntegrationsPanel({
  integrations,
  onDisconnect,
  onRefresh,
  showToast,
}: {
  integrations: IntegrationStatus[];
  onDisconnect: (provider: string) => Promise<void>;
  onRefresh: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const byProvider = Object.fromEntries(integrations.map((i) => [i.provider, i]));

  const gcStatus = byProvider['google_calendar'] ?? {
    provider: 'google_calendar', status: 'disconnected',
    account_email: null, last_sync_at: null, last_error: null, scopes: null, connected_at: null,
  };

  const otherProviders = KNOWN_PROVIDERS.filter((id) => id !== 'google_calendar' && id !== 'notion');

  return (
    <div className="space-y-3">
      {/* Google Calendar — full OAuth flow */}
      <GoogleCalendarCard status={gcStatus} onRefresh={onRefresh} showToast={showToast} />

      {/* Notion — full OAuth flow + database selector */}
      <NotionCard onRefresh={onRefresh} showToast={showToast} />

      {/* Other providers — disabled for now */}
      {otherProviders.map((id) => {
        const meta = PROVIDER_UI[id];
        const status = byProvider[id] ?? { provider: id, status: 'disconnected', account_email: null, last_sync_at: null, last_error: null, scopes: null, connected_at: null };
        const Icon = meta.icon;
        const isConnected = status.status === 'connected';
        const isError = status.status === 'error';

        return (
          <div
            key={id}
            className="flex items-start gap-3 bg-bg-card border border-border rounded-card px-4 py-3"
          >
            <span className={`flex-shrink-0 mt-0.5 ${meta.iconClass}`}>
              <Icon size={20} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-text-primary">{meta.name}</p>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-text-muted/10 text-text-muted border border-border leading-none">
                  Çok yakında
                </span>
              </div>
              <p className="text-xs text-text-muted leading-relaxed">{meta.desc}</p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0
                  ${isConnected ? 'bg-accent-green' : isError ? 'bg-accent-red' : 'bg-text-muted/40'}`} />
                <span className={`text-xs ${isConnected ? 'text-accent-green' : isError ? 'text-accent-red' : 'text-text-muted'}`}>
                  {isConnected
                    ? `Bağlı${status.account_email ? ': ' + status.account_email : ''}`
                    : isError ? 'Hata' : 'Bağlı değil'}
                </span>
              </div>
            </div>
            <div className="flex-shrink-0 ml-2 mt-0.5">
              {isConnected ? (
                <button
                  disabled={disconnecting === id}
                  onClick={async () => {
                    setDisconnecting(id);
                    try { await onDisconnect(id); } finally { setDisconnecting(null); }
                  }}
                  className="px-3 py-1.5 text-xs rounded-btn bg-bg-input border border-border text-text-secondary hover:text-accent-red hover:border-accent-red/40 transition-colors disabled:opacity-60"
                >
                  {disconnecting === id ? '...' : 'Bağlantıyı Kes'}
                </button>
              ) : (
                <button
                  disabled
                  title="Yakında"
                  className="px-3 py-1.5 text-xs rounded-btn bg-bg-input border border-border text-text-muted opacity-50 cursor-not-allowed"
                >
                  Bağlan
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const COLOR_CLASSES: Record<string, string> = {
  purple: 'bg-accent-purple/15 text-accent-purple',
  cyan:   'bg-accent-cyan/15 text-accent-cyan',
  orange: 'bg-accent-orange/15 text-accent-orange',
  yellow: 'bg-accent-yellow/15 text-accent-yellow',
  pink:   'bg-accent-pink/15 text-accent-pink',
  red:    'bg-accent-red/15 text-accent-red',
  green:  'bg-accent-green/15 text-accent-green',
};

function Section({
  title,
  icon: Icon,
  color,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: LucideIcon;
  color: keyof typeof COLOR_CLASSES;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-bg-card border border-border rounded-card mb-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-bg-input/30 transition-colors"
      >
        <span className={`flex items-center justify-center w-8 h-8 rounded-lg ${COLOR_CLASSES[color]}`}>
          <Icon size={18} />
        </span>
        <h2 className="text-sm font-semibold text-text-primary flex-1 text-left">{title}</h2>
        <ChevronDown
          size={16}
          className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 space-y-4 border-t border-border">{children}</div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-text-secondary mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}
