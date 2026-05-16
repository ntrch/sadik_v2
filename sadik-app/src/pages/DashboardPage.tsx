import React, { useState, useContext, useEffect, useRef } from 'react';
import { Clock, CheckSquare, Flame, Activity, Edit3, ChevronDown, ChevronUp, Calendar, ArrowRight, Briefcase, Code, Coffee, Users, Flag, CalendarClock, ListTodo, BarChart2, Settings, Pencil, GraduationCap, Palette, BookOpen, Gamepad2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppContext } from '../context/AppContext';
import { modesApi } from '../api/modes';
import { pomodoroApi } from '../api/pomodoro';
import { tasksApi, Task } from '../api/tasks';
import { statsApi, ModeStat, AppUsageStat } from '../api/stats';
import { settingsApi } from '../api/settings';
import ActivityChart from '../components/stats/ActivityChart';
import { AnimationEventType } from '../engine/types';
import { useModeColors } from '../utils/modeColors';
import { getIconByKey, DEFAULT_PRESET_ICONS } from '../utils/modeIcons';
import ModeSettingsPopup, { DraftState } from '../components/mode/ModeSettingsPopup';
import WeeklyProfileCard from '../components/dashboard/WeeklyProfileCard';

import { PRESET_MODE_POOL, MODE_LABEL_FROM_POOL } from '../lib/activityCatalog';

// ── Mod adları — canonical Türkçe label sözlüğü ──────────────────────────────
// Geri uyum: WorkspacePage bu export'u DashboardPage'den import ediyor.
// İçerik artık PRESET_MODE_POOL'dan geliyor; eski statik değerler de korunuyor.
export const MODE_DISPLAY_LABELS: Record<string, string> = {
  // Havuzdan gelen güncel label'lar
  ...MODE_LABEL_FROM_POOL,
  // Eski key'ler için alias (geri uyum — WorkspacePage 'coding' vs 'learning' kullanıyor)
  working:  MODE_LABEL_FROM_POOL.working  ?? 'Genel Çalışma',
  coding:   MODE_LABEL_FROM_POOL.coding   ?? 'Derin Kod',
  break:    MODE_LABEL_FROM_POOL.break    ?? 'Mola',
  meeting:  MODE_LABEL_FROM_POOL.meeting  ?? 'Toplantı',
  writing:  MODE_LABEL_FROM_POOL.writing  ?? 'Yazma Akışı',
  learning: MODE_LABEL_FROM_POOL.learning ?? 'Çalışma',
  design:   MODE_LABEL_FROM_POOL.design   ?? 'Tasarım',
  reading:  MODE_LABEL_FROM_POOL.reading  ?? 'Okuma',
  gaming:   MODE_LABEL_FROM_POOL.gaming   ?? 'Oyun',
};

// ── Fallback mod listesi (user_preset_modes ayarı boşken gösterilecek) ────────
const FALLBACK_PRESET_KEYS = ['working', 'learning', 'break', 'meeting'];

// Maps mode keys to a one-shot intro clip + a looping text clip.
// Intro plays once on mode-enter, then the text clip loops until the user exits.
// Maps mode keys → intro+loop clip pairs for playModSequence
const MODE_ANIM_CLIPS: Record<string, { intro: string; loop: string }> = {
  working: { intro: 'mode_working', loop: 'mode_working_text' },
  break:   { intro: 'mode_break',   loop: 'break_text'        },
  meeting: { intro: 'mode_meeting_text', loop: 'mode_meeting_text' },
};

// ── App name beautifier ──────────────────────────────────────────────────────

const APP_NAME_MAP: Record<string, string> = {
  'whatsapp.root': 'WhatsApp',
  'whatsapp': 'WhatsApp',
  'chrome': 'Google Chrome',
  'chrome.exe': 'Google Chrome',
  'firefox': 'Firefox',
  'firefox.exe': 'Firefox',
  'code': 'VS Code',
  'code.exe': 'VS Code',
  'spotify': 'Spotify',
  'spotify.exe': 'Spotify',
  'discord': 'Discord',
  'discord.exe': 'Discord',
  'slack': 'Slack',
  'slack.exe': 'Slack',
  'telegram': 'Telegram',
  'telegram.exe': 'Telegram',
  'explorer': 'Dosya Gezgini',
  'explorer.exe': 'Dosya Gezgini',
  'notepad': 'Not Defteri',
  'notepad.exe': 'Not Defteri',
  'terminal': 'Terminal',
  'windowsterminal': 'Windows Terminal',
  'windowsterminal.exe': 'Windows Terminal',
  'obsidian': 'Obsidian',
  'obsidian.exe': 'Obsidian',
  'notion': 'Notion',
  'notion.exe': 'Notion',
  'postman': 'Postman',
  'postman.exe': 'Postman',
  'figma': 'Figma',
  'figma.exe': 'Figma',
};

function useAccordion(key: string, defaultOpen = false): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const storageKey = `sadik.dash.acc.${key}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch {}
    return defaultOpen;
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, open ? '1' : '0'); } catch {}
  }, [open, storageKey]);
  return [open, setOpen];
}

function beautifyAppName(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (APP_NAME_MAP[lower]) return APP_NAME_MAP[lower];
  // Remove .exe, .root, capitalize first letter of each word
  const cleaned = raw
    .replace(/\.exe$/i, '')
    .replace(/\.root$/i, '')
    .replace(/\./g, ' ')
    .trim();
  return cleaned
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Backward-compat alias — bileşenler bu adla kullanıyordu
const MODE_LABELS = MODE_DISPLAY_LABELS;

const MODE_ICON_MAP: Record<string, React.ComponentType<any>> = {
  working:  Briefcase,
  coding:   Code,
  break:    Coffee,
  meeting:  Users,
  writing:  Pencil,
  learning: GraduationCap,
  design:   Palette,
  reading:  BookOpen,
  gaming:   Gamepad2,
};

/** Appends `aa` (alpha ≈ 0.67) to a hex color for tinted fills. */
function withAlpha(hex: string, aa: string): string {
  return hex.length === 7 ? `${hex}${aa}` : hex;
}

/** Red (#ef4444) → Green (#22c55e) gradient by rank (0 = hottest). */
function heatColor(rank: number, total: number): string {
  if (total <= 1) return 'hsl(0 80% 55%)';
  const t = rank / (total - 1);
  const hue = Math.round(t * 120);
  return `hsl(${hue} 78% 55%)`;
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0 && m > 0) return `${h} Saat ${m} Dakika`;
  if (h > 0) return `${h} Saat`;
  return `${Math.max(m, 1)} Dakika`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const {
    currentMode, setCurrentMode, showToast, pomodoroState,
    triggerEvent, showText, returnToIdle, playClipDirect, playModClip, playModSequence, getLoadedClipNames,
    engineState,
    cancelMeetingExitGrace,
    debugForcePoll, debugTestTTS, debugResetCounters, debugSimulateInsight,
    setDndActive,
  } = useContext(AppContext);
  const [simAppName, setSimAppName] = useState('League of Legends');
  const [simMinutes, setSimMinutes] = useState(125);
  const navigate = useNavigate();

  const {
    customModes, getModeColor, getModeDnd, getModeIcon, nextFreeColor, setPresetColor, setModeDnd,
    setPresetIcon, setCustomModeIcon,
    addCustomMode, setCustomModeColor, removeCustomMode,
  } = useModeColors();
  // Settings popup state: which chip's gear is open (key or 'create' for +Özel)
  const [settingsOpenFor, setSettingsOpenFor] = useState<string | null>(null);
  const settingsBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [modeStats, setModeStats] = useState<ModeStat[]>([]);
  const [appUsage, setAppUsage] = useState<AppUsageStat[]>([]);
  const [totalScreenSeconds, setTotalScreenSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [debugFloating, setDebugFloating] = useState(false);
  const [modeStatsOpen, setModeStatsOpen] = useAccordion('modeStats');
  const [appUsageOpen, setAppUsageOpen] = useAccordion('appUsage');
  const [todayTasksOpen, setTodayTasksOpen] = useAccordion('todayTasks');
  const [customModesOpen, setCustomModesOpen] = useAccordion('customModes');
  const [weeklyOpen, setWeeklyOpen] = useAccordion('weekly');
  const [userPresetModes, setUserPresetModes] = useState<string[]>([]);
  const modeReturnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Today's tasks (todo + in_progress)
    // Local calendar date (YYYY-MM-DD) — use the user's timezone, not UTC,
    // so midnight behaviour matches what the user sees on the clock.
    const _now = new Date();
    const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
    // Load user preset modes for mode chip filtering
    settingsApi.getAll().then((s) => {
      const csv = (s['user_preset_modes'] ?? '').trim();
      if (csv) {
        setUserPresetModes(csv.split(',').map((k: string) => k.trim()).filter(Boolean));
      }
    }).catch(() => {});
    tasksApi.list().then((all) => {
      const relevant = all.filter((t) => {
        const due = t.due_date as string | null | undefined;
        // In-progress: always show (currently being worked on — date irrelevant).
        if (t.status === 'in_progress') return true;
        // To-do: only show if deadline is explicitly set to today.
        // Tasks without a deadline (undated, pending) are not surfaced here.
        if (t.status === 'todo') return !!due && due.startsWith(today);
        // Done: only show when completed today.
        if (t.status === 'done') return !!t.updated_at?.startsWith(today);
        return false;
      });
      setTodayTasks(relevant);
    }).catch(() => {});
    // Mode stats — pin to local today so the label matches what we show.
    statsApi.daily(today).then(setModeStats).catch(() => {});
    // App usage
    statsApi.appUsageDaily().then((data) => {
      setAppUsage(data);
      setTotalScreenSeconds(data.reduce((s, a) => s + a.duration_seconds, 0));
    }).catch(() => {});
    const poll = setInterval(() => {
      const _now = new Date();
      const t = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
      statsApi.appUsageDaily().then((data) => {
        setAppUsage(data);
        setTotalScreenSeconds(data.reduce((s, a) => s + a.duration_seconds, 0));
      }).catch(() => {});
      statsApi.daily(t).then(setModeStats).catch(() => {});
    }, 60_000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => () => { if (modeReturnTimer.current) clearTimeout(modeReturnTimer.current); }, []);

  // Global Ctrl+Shift+A → toggle floating debug panel
  useEffect(() => {
    const handler = () => setDebugFloating((v) => !v);
    document.addEventListener('sadik:toggle-anim-debug', handler);
    return () => document.removeEventListener('sadik:toggle-anim-debug', handler);
  }, []);

  // On mount only: if a mode was ALREADY active when this page mounted (app
  // reopened into an existing mode), play its intro→loop sequence once.
  // Mode changes that happen AFTER mount are owned by the action that caused
  // them (handleSetMode, acceptInsight, pomodoro_completed WS handler), so
  // this effect must not react to later `currentMode` changes — doing so
  // would override acceptInsight's playModIntroOnce with a loop and prevent
  // its startTimer callback from ever firing.
  useEffect(() => {
    const mode = currentMode;
    if (!mode) return;
    const clip = MODE_ANIM_CLIPS[mode];
    if (!clip) return;
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      const loaded = getLoadedClipNames();
      if (loaded.includes(clip.intro) && loaded.includes(clip.loop)) {
        clearInterval(check);
        playModSequence(clip.intro, clip.loop);
      } else if (attempts >= 10) {
        clearInterval(check);
      }
    }, 500);
    return () => clearInterval(check);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEndMode = async () => {
    setLoading(true);
    cancelMeetingExitGrace(); // drop+reconnect grace period — timer not needed after manual exit
    try {
      // Manual exit from break mode mid-timer → confirming.cpp → idle.
      const exitingActiveBreak =
        currentMode === 'break' && pomodoroState.is_running && pomodoroState.phase === 'break';
      if (exitingActiveBreak) {
        try { await pomodoroApi.stop(); } catch { /* best-effort */ }
      }
      await modesApi.endCurrent();
      setCurrentMode(null);
      setDndActive(false); // no active mode → clear DND
      if (exitingActiveBreak) {
        triggerEvent('pomodoro.session.completed');
      } else {
        returnToIdle();
      }
      showToast('Mod sonlandırıldı', 'info');
    } catch {
      showToast('Mod sonlandırılamadı', 'error');
    }
    setLoading(false);
  };

  const handleSetMode = async (mode: string, oledText?: string) => {
    if (!mode.trim()) return;
    // Toggle off: clicking the active mode deactivates it
    if (currentMode === mode) {
      await handleEndMode();
      return;
    }
    setLoading(true);
    try {
      // Fix 3 bidirectional: if user manually switches away from break mode while
      // pomodoro is running a break phase, stop the timer to avoid ghost ticks.
      if (currentMode === 'break' && pomodoroState.is_running && pomodoroState.phase === 'break') {
        try { await pomodoroApi.stop(); } catch { /* best-effort */ }
      }
      await modesApi.setMode(mode);
      setCurrentMode(mode);
      // Auto-apply mode's DND setting
      setDndActive(getModeDnd(mode));
      triggerEvent(`mode.changed.${mode}` as AnimationEventType);
      showToast(`Mod değiştirildi: ${mode}`, 'success');
      if (modeReturnTimer.current) clearTimeout(modeReturnTimer.current);

      // Check if this mode has a dedicated animation clip
      const clip = MODE_ANIM_CLIPS[mode];
      if (clip) {
        // Brief confirmation, then play intro once → chain into looping text clip
        modeReturnTimer.current = setTimeout(
          () => playModSequence(clip.intro, clip.loop),
          1200,
        );
      } else {
        // Custom/other modes: show text on OLED
        const displayText = oledText ?? mode.toUpperCase();
        showText(displayText);
      }
    } catch {
      showToast('Mod değiştirilemedi', 'error');
    }
    setLoading(false);
  };

  const handleApplyDraft = (draft: DraftState) => {
    if (!draft.name.trim()) return;
    handleSetMode(draft.name.trim(), draft.name.trim().toUpperCase());
  };

  const handleSaveDraft = async (draft: DraftState) => {
    const name = draft.name.trim();
    if (!name) return;
    await addCustomMode(name, draft.color || nextFreeColor());
    await setCustomModeIcon(name, draft.iconKey);
    await setModeDnd(name, draft.dnd);
    handleSetMode(name, name.toUpperCase());
  };

  const handleDeleteCustomMode = async (name: string) => {
    await removeCustomMode(name);
    showToast(`"${name}" modu silindi`, 'info');
  };

  const doneToday = todayTasks.filter((t) => t.status === 'done').length;
  const activeTasks = todayTasks.filter((t) => t.status !== 'done');

  // user_preset_modes ayarına göre gösterilecek preset modlar
  // Ayar boşsa fallback 4 generic mod gösterilir
  const activePresetKeys = userPresetModes.length > 0 ? userPresetModes : FALLBACK_PRESET_KEYS;
  const visiblePresetModes = PRESET_MODE_POOL.filter(({ key }) => {
    // Aktif mod her zaman görünsün (seçili olduğunda kaybolmasın)
    if (currentMode === key) return true;
    return activePresetKeys.includes(key);
  });

  const loadedClips = getLoadedClipNames();
  const [selectedClip, setSelectedClip] = useState('');
  const [textInput, setTextInput] = useState('');

  return (
    <div className="h-full overflow-y-auto p-6 page-transition">
      {/* Greeting */}
      <div className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted mb-1.5">
          {(() => {
            const h = new Date().getHours();
            if (h < 6) return 'Gece yarısı';
            if (h < 12) return 'Sabah';
            if (h < 17) return 'Öğleden sonra';
            if (h < 21) return 'Akşam';
            return 'Gece';
          })()}
        </p>
        <h1 className="text-[32px] font-bold text-text-primary tracking-tight leading-tight">
          {(() => {
            const h = new Date().getHours();
            if (h < 6) return 'İyi geceler';
            if (h < 12) return 'Günaydın';
            if (h < 17) return 'İyi günler';
            if (h < 21) return 'İyi akşamlar';
            return 'İyi geceler';
          })()}
        </h1>
      </div>
      {/* Stat cards — statik açık, akordiyon değil */}
      <div className="bg-bg-card border border-border-subtle rounded-card p-4 mb-5">
        <div className="flex items-center gap-2 px-1 mb-3 text-sm font-semibold text-text-primary">
          <Activity size={14} className="text-accent-purple" />
          Bugünkü Özet
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard icon={<Clock size={18} className="text-accent-blue" />} label="Toplam Ekran Süresi" value={totalScreenSeconds > 0 ? formatDuration(totalScreenSeconds) : '0 dakika'} color="blue" />
          <StatCard icon={<CheckSquare size={18} className="text-accent-green" />} label="Tamamlanan" value={`${doneToday} görev`} color="green" />
          <StatCard icon={<Flame size={18} className="text-accent-orange" />} label="Pomodoro" value={`${pomodoroState.current_session} oturum`} color="orange" />
          <StatCard icon={<Activity size={18} className="text-accent-purple" />} label="Aktif Mod" value={currentMode ? (MODE_LABELS[currentMode] || currentMode) : '—'} color="purple" />
        </div>
      </div>

      {/* Mode selector — preset modlar */}
      <div data-tutorial="mode-selector" className="bg-bg-card border border-border-subtle rounded-card p-4 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {visiblePresetModes.map(({ key, label, oledText }) => {
            const isActive = currentMode === key;
            const color = getModeColor(key);
            const iconKey = getModeIcon(key) ?? DEFAULT_PRESET_ICONS[key];
            const IconComp = getIconByKey(iconKey) ?? MODE_ICON_MAP[key];
            return (
              <React.Fragment key={key}>
                <ModeChip
                  label={label}
                  color={color}
                  active={isActive}
                  disabled={loading}
                  icon={IconComp ? <IconComp size={16} /> : null}
                  onClick={() => handleSetMode(key, oledText)}
                  settingsBtnRef={(el) => { settingsBtnRefs.current[key] = el; }}
                  onOpenSettings={() => setSettingsOpenFor(settingsOpenFor === key ? null : key)}
                  settingsOpen={settingsOpenFor === key}
                />
                {settingsOpenFor === key && (
                  <ModeSettingsPopup
                    anchorRef={{ current: settingsBtnRefs.current[key] } as React.RefObject<HTMLElement>}
                    open={true}
                    onClose={() => setSettingsOpenFor(null)}
                    mode={{
                      kind: 'preset',
                      key,
                      label,
                      color,
                      iconKey: iconKey ?? 'briefcase',
                      dnd: getModeDnd(key),
                      onApply: () => handleSetMode(key, oledText),
                      onColorChange: (c) => setPresetColor(key, c),
                      onIconChange: (ic) => setPresetIcon(key, ic),
                      onDndChange: (d) => setModeDnd(key, d),
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
          {/* +Özel button */}
          <div className="relative">
            <button
              ref={(el) => { settingsBtnRefs.current['create'] = el; }}
              onClick={() => setSettingsOpenFor(settingsOpenFor === 'create' ? null : 'create')}
              className={`px-4 py-2.5 rounded-[14px] text-sm font-semibold transition-all flex items-center gap-2
                ${settingsOpenFor === 'create' ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/40' : 'bg-bg-input text-text-secondary border border-border hover:border-accent-purple/40 hover:text-text-primary'}`}
            >
              <Edit3 size={14} />
              Özel
            </button>
            {settingsOpenFor === 'create' && (
              <ModeSettingsPopup
                anchorRef={{ current: settingsBtnRefs.current['create'] } as React.RefObject<HTMLElement>}
                open={true}
                onClose={() => setSettingsOpenFor(null)}
                mode={{
                  kind: 'create',
                  initialColor: nextFreeColor(),
                  onApplyDraft: (d) => { handleApplyDraft(d); setSettingsOpenFor(null); },
                  onSaveDraft: (d) => { handleSaveDraft(d); setSettingsOpenFor(null); },
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Özel Modlar akordiyon — default kapalı */}
      <div className="bg-bg-card border border-border-subtle rounded-card overflow-hidden mb-5">
        <button
          onClick={() => setCustomModesOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-text-primary hover:bg-bg-hover transition-colors"
        >
          <span className="flex items-center gap-2">
            <Edit3 size={14} className="text-accent-purple" />
            Özel Modlar
            <span className="text-[10px] font-normal text-text-muted">({customModes.length})</span>
          </span>
          {customModesOpen ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
        </button>
        {customModesOpen && (
          <div className="px-4 pb-4 border-t border-border-subtle pt-3">
            {customModes.length === 0 ? (
              <p className="text-xs text-text-muted py-2 text-center">Henüz özel mod yok. Yukarıdaki "+ Özel" butonuyla ekle.</p>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                {customModes.map(({ name, color, icon }) => {
                  const IconComp = getIconByKey(icon);
                  const chipKey = `custom-${name}`;
                  return (
                    <React.Fragment key={chipKey}>
                      <ModeChip
                        label={name}
                        color={color}
                        active={currentMode === name}
                        disabled={loading}
                        icon={IconComp ? <div className="w-6 h-6 rounded-md bg-bg-input flex items-center justify-center flex-shrink-0"><IconComp size={14} /></div> : null}
                        onClick={() => handleSetMode(name, name.toUpperCase())}
                        settingsBtnRef={(el) => { settingsBtnRefs.current[chipKey] = el; }}
                        onOpenSettings={() => setSettingsOpenFor(settingsOpenFor === chipKey ? null : chipKey)}
                        settingsOpen={settingsOpenFor === chipKey}
                      />
                      {settingsOpenFor === chipKey && (
                        <ModeSettingsPopup
                          anchorRef={{ current: settingsBtnRefs.current[chipKey] } as React.RefObject<HTMLElement>}
                          open={true}
                          onClose={() => setSettingsOpenFor(null)}
                          mode={{
                            kind: 'custom',
                            name,
                            color,
                            iconKey: icon ?? 'briefcase',
                            dnd: getModeDnd(name),
                            onApply: () => handleSetMode(name, name.toUpperCase()),
                            onDelete: () => { handleDeleteCustomMode(name); setSettingsOpenFor(null); },
                            onColorChange: (c) => setCustomModeColor(name, c),
                            onIconChange: (ic) => setCustomModeIcon(name, ic),
                            onDndChange: (d) => setModeDnd(name, d),
                          }}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mode duration summary — accordion */}
      {modeStats.length > 0 && (
        <div className="bg-bg-card border border-border-subtle rounded-card overflow-hidden mb-5">
          <button
            onClick={() => setModeStatsOpen((o) => !o)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-text-primary hover:bg-bg-hover transition-colors"
          >
            <span>Bugünkü Mod Süreleri</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-muted">{modeStats.length} mod</span>
              {modeStatsOpen ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
            </div>
          </button>
          {modeStatsOpen && (
            <div className="px-5 pb-4 border-t border-border-subtle pt-3 space-y-2">
              {[...modeStats].sort((a, b) => b.total_seconds - a.total_seconds).map((m) => {
                const iconKey = getModeIcon(m.mode) ?? DEFAULT_PRESET_ICONS[m.mode];
                const IconComp = getIconByKey(iconKey) ?? MODE_ICON_MAP[m.mode] ?? Edit3;
                const color = getModeColor(m.mode);
                return (
                  <div
                    key={m.mode}
                    className="flex items-center justify-between px-3 py-2 rounded-btn transition-colors border"
                    style={{ backgroundColor: withAlpha(color, '1a'), borderColor: withAlpha(color, '40') }}
                  >
                    <div className="flex items-center gap-2">
                      <IconComp size={14} style={{ color }} />
                      <span className="text-xs font-medium" style={{ color }}>{MODE_LABELS[m.mode] || m.mode}</span>
                    </div>
                    <span className="text-xs font-semibold text-text-primary">{formatDuration(m.total_seconds)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Today's tasks — accordion */}
      <div className="bg-bg-card border border-border-subtle rounded-card overflow-hidden mb-5">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setTodayTasksOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTodayTasksOpen((o) => !o); } }}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-text-primary hover:bg-bg-hover transition-colors cursor-pointer select-none"
        >
          <span className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-accent-cyan/20 ring-1 ring-accent-cyan/40 flex items-center justify-center">
              <ListTodo size={15} className="text-accent-cyan" />
            </span>
            Yapılacaklar
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-text-muted">{activeTasks.length} görev</span>
            <button
              onClick={(e) => { e.stopPropagation(); navigate('/tasks'); }}
              className="text-[11px] text-accent-primary hover:text-accent-primary-hover transition-colors flex items-center gap-1"
            >
              Tümünü Gör <ArrowRight size={10} />
            </button>
            {todayTasksOpen ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
          </div>
        </div>
        {todayTasksOpen && (
          <div className="px-5 pb-4 border-t border-border-subtle pt-3">
            {activeTasks.length === 0 ? (
              <p className="text-xs text-text-muted py-3 text-center">Aktif görev yok</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {activeTasks.slice(0, 8).map((task) => (
                  <TaskMiniCard key={task.id} task={task} onOpen={() => navigate('/tasks', { state: { taskId: task.id } })} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* App usage — accordion */}
      <div className="bg-bg-card border border-border-subtle rounded-card overflow-hidden mb-5">
        <button
          onClick={() => setAppUsageOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-text-primary hover:bg-bg-hover transition-colors"
        >
          <span className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-accent-green/20 ring-1 ring-accent-green/40 flex items-center justify-center">
              <BarChart2 size={15} className="text-accent-green" />
            </span>
            Uygulama Kullanımı
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted">{appUsage.length} uygulama</span>
            {appUsageOpen ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
          </div>
        </button>
        {appUsageOpen && (
          <div className="px-5 pb-4 border-t border-border-subtle pt-3">
            {appUsage.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-3">Henüz veri yok</p>
            ) : (() => {
              const sorted = [...appUsage].sort((a, b) => b.duration_seconds - a.duration_seconds);
              const maxSec = sorted[0]?.duration_seconds ?? 1;
              return (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {sorted.map((item, i) => {
                    const pct = Math.max(4, Math.round((item.duration_seconds / maxSec) * 100));
                    const color = heatColor(i, sorted.length);
                    return (
                      <div key={item.app_name}
                        className="relative bg-bg-input border border-border rounded-card p-2.5 shadow-card transition-all hover:-translate-y-0.5"
                        >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[13px] font-semibold" style={{ color }}>#{i + 1}</span>
                          <span className="text-[13px] text-text-secondary font-medium tabular-nums">{formatDuration(item.duration_seconds)}</span>
                        </div>
                        <p className="text-sm text-text-primary font-medium truncate mb-2" title={beautifyAppName(item.app_name)}>
                          {beautifyAppName(item.app_name)}
                        </p>
                        <div className="h-1 rounded-full bg-bg-card overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, backgroundColor: color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Weekly profile + Activity chart — TEK akordiyon, default kapalı */}
      <div className="bg-bg-card border border-border-subtle rounded-card overflow-hidden mb-5">
        <button
          onClick={() => setWeeklyOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-text-primary hover:bg-bg-hover transition-colors"
        >
          <span className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-accent-purple/20 ring-1 ring-accent-purple/40 flex items-center justify-center">
              <Calendar size={15} className="text-accent-purple" />
            </span>
            Haftalık profilim
          </span>
          {weeklyOpen ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
        </button>
        {weeklyOpen && (
          <div className="px-4 pb-4 border-t border-border-subtle pt-3 space-y-4">
            <WeeklyProfileCard />
            <ActivityChart />
          </div>
        )}
      </div>

      {/* Floating animation debug panel — Ctrl+Shift+A to toggle */}
      {debugFloating && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDebugFloating(false)}>
          <div className="glass-heavy border border-white/10 rounded-card shadow-card w-full max-w-lg p-5 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-text-primary">Animasyon Debug</span>
              <button onClick={() => setDebugFloating(false)} className="text-text-muted hover:text-text-primary">
                <ChevronDown size={16} />
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <DebugRow label="Aktif Klip" value={engineState.currentClipName ?? 'yok'} />
                <DebugRow label="Mod" value={playbackModeLabel(engineState.playbackMode)} />
                <DebugRow label="Kare" value={`${engineState.currentFrameIndex} / ${engineState.totalFrames}`} />
                <DebugRow label="FPS" value={String(engineState.fps)} />
                <DebugRow label="Idle Durumu" value={engineState.idleSubState} />
                <DebugRow label="Metin" value={engineState.textContent ?? '—'} />
              </div>

              <div>
                <p className="text-xs text-text-muted mb-2">Direkt Klip Testi</p>
                {loadedClips.length === 0 ? (
                  <p className="text-xs text-text-muted italic">Hiç klip yüklenmedi</p>
                ) : (
                  <div className="flex gap-2">
                    <select
                      value={selectedClip}
                      onChange={(e) => setSelectedClip(e.target.value)}
                      className="flex-1 bg-bg-input border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary outline-none focus:border-border-focus"
                    >
                      <option value="">Klip seçin...</option>
                      {loadedClips.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => { if (selectedClip) playClipDirect(selectedClip); }}
                      disabled={!selectedClip}
                      className="px-4 py-1.5 bg-accent-purple hover:bg-accent-purple-hover text-white text-xs font-medium rounded-btn transition-colors disabled:opacity-40">
                      Oynat
                    </button>
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs text-text-muted mb-2">Metin Testi</p>
                <div className="flex gap-2">
                  <input
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="Gösterilecek metin..."
                    className="flex-1 bg-bg-input border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary placeholder-text-muted outline-none focus:border-border-focus transition-colors"
                  />
                  <button
                    onClick={() => { if (textInput.trim()) showText(textInput.trim()); }}
                    disabled={!textInput.trim()}
                    className="px-4 py-1.5 bg-accent-purple hover:bg-accent-purple/80 text-white text-xs font-medium rounded-btn transition-colors disabled:opacity-40">
                    Göster
                  </button>
                </div>
              </div>

              <div className="border-t border-border pt-4 space-y-2">
                <p className="text-xs text-text-muted">Proaktif Öneri Debug</p>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => debugTestTTS()} className="px-3 py-1.5 bg-accent-green hover:bg-accent-green/80 text-white text-xs font-medium rounded-btn transition-colors">TTS Testi</button>
                  <button onClick={() => debugForcePoll()} className="px-3 py-1.5 bg-accent-blue hover:bg-accent-blue/80 text-white text-xs font-medium rounded-btn transition-colors">Poll Tetikle</button>
                  <button onClick={() => debugResetCounters()} className="px-3 py-1.5 bg-accent-orange hover:bg-accent-orange/80 text-white text-xs font-medium rounded-btn transition-colors">Sayaç Sıfırla</button>
                </div>
                <div className="grid grid-cols-5 gap-2 items-center pt-2">
                  <input value={simAppName} onChange={(e) => setSimAppName(e.target.value)} placeholder="App adı" className="col-span-3 bg-bg-input border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary placeholder-text-muted outline-none focus:border-border-focus" />
                  <input type="number" value={simMinutes} onChange={(e) => setSimMinutes(Number(e.target.value))} placeholder="dk" className="col-span-1 bg-bg-input border border-border rounded-btn px-2 py-1.5 text-xs text-text-primary outline-none focus:border-border-focus" />
                  <button onClick={() => { if (simAppName.trim() && simMinutes > 0) debugSimulateInsight(simAppName.trim(), simMinutes); }} disabled={!simAppName.trim() || simMinutes <= 0} className="col-span-1 px-2 py-1.5 bg-accent-purple hover:bg-accent-purple/80 text-white text-xs font-medium rounded-btn transition-colors disabled:opacity-40">Simüle</button>
                </div>
                <p className="text-[10px] text-text-muted">Sentetik insight üretir (≥120 dk = strong, ses tetikler). Gate zincirini tam çalıştırır.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mode chip ────────────────────────────────────────────────────────────────

interface ModeChipProps {
  label: string;
  color: string;
  active: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  onClick: () => void;
  settingsBtnRef: (el: HTMLButtonElement | null) => void;
  onOpenSettings: () => void;
  settingsOpen: boolean;
}

function ModeChip({ label, color, active, disabled, icon, onClick, settingsBtnRef, onOpenSettings, settingsOpen }: ModeChipProps) {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        disabled={disabled}
        className="px-4 py-2.5 rounded-[14px] text-sm font-semibold transition-all flex items-center gap-2 border-2"
        style={
          active
            ? { backgroundColor: withAlpha(color, '33'), borderColor: color, color }
            : { backgroundColor: '#1f1f23', borderColor: withAlpha(color, '55'), color: withAlpha(color, 'cc') }
        }
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
        />
        {icon}
        {label}
      </button>
      {/* Single gear settings button */}
      <button
        ref={settingsBtnRef}
        onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
        title="Mod ayarları"
        className={`absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full bg-bg-card border flex items-center justify-center transition-all shadow-card ${
          settingsOpen
            ? 'opacity-100 border-accent-purple/60 text-accent-purple'
            : 'opacity-0 group-hover:opacity-100 border-border text-text-muted hover:text-text-primary'
        }`}
      >
        <Settings size={12} />
      </button>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function playbackModeLabel(mode: string): string {
  if (mode === 'idle') return 'bekleme';
  if (mode === 'explicit_clip') return 'klip';
  if (mode === 'text') return 'metin';
  return mode;
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-input border border-border rounded-btn px-3 py-1.5">
      <span className="text-text-muted">{label}: </span>
      <span className="text-text-primary">{value}</span>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const accentMap: Record<string, string> = {
    purple: 'text-accent-purple',
    green:  'text-accent-green',
    orange: 'text-accent-orange',
    cyan:   'text-accent-cyan',
    blue:   'text-accent-blue',
    yellow: 'text-accent-yellow',
  };
  return (
    <div className="bg-bg-card border border-border-subtle rounded-card px-5 py-4 transition-all hover:border-border">
      <div className={`mb-2 ${accentMap[color] ?? 'text-accent-primary'}`}>{icon}</div>
      <p className="text-[13px] uppercase tracking-wider text-text-muted mb-1">{label}</p>
      <p className="text-2xl font-bold text-text-primary tabular-nums leading-tight">{value}</p>
    </div>
  );
}

// Task priority scale matches PRIORITY_OPTIONS in TaskModal (0..3).
const PRIORITY_META: Record<number, { label: string; cls: string; hex: string }> = {
  0: { label: 'Düşük',  cls: 'bg-bg-card         text-text-muted    border-border',                hex: '#71717a' },
  1: { label: 'Normal', cls: 'bg-accent-blue/15   text-accent-blue   border-accent-blue/30',       hex: '#60a5fa' },
  2: { label: 'Yüksek', cls: 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30',     hex: '#fcd34d' },
  3: { label: 'Acil',   cls: 'bg-accent-red/15    text-accent-red    border-accent-red/30',        hex: '#ef4444' },
};

const IN_PROGRESS_HEX = '#fb923c'; // orange — not yellow

function formatDueParts(iso: string): { date: string; time: string | null } {
  const d = new Date(iso);
  const date = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
  const h = d.getHours();
  const m = d.getMinutes();
  const hasTime = !(h === 0 && m === 0);
  const time = hasTime
    ? d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : null;
  return { date, time };
}

function TaskMiniCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const inProgress = task.status === 'in_progress';
  const prio = PRIORITY_META[task.priority];
  const due  = task.due_date ? formatDueParts(task.due_date) : null;
  // In-progress wins over priority for the card tint — the user is actively
  // working this task, so it should stand out in orange.
  const tint = inProgress ? IN_PROGRESS_HEX : prio?.hex ?? '#71717a';
  return (
    <div
      onClick={onOpen}
      className="relative border rounded-card p-2.5 pl-3 cursor-pointer transition-all hover:-translate-y-0.5"
      style={{ backgroundColor: withAlpha(tint, '1f'), borderColor: withAlpha(tint, '66') }}
    >
      <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ backgroundColor: tint }} />
      <div className="flex items-start gap-2 mb-2">
        <span
          className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${inProgress ? 'animate-pulse' : ''}`}
          style={{ backgroundColor: tint }}
        />
        <span className="text-xs text-text-primary font-medium line-clamp-2 leading-snug">{task.title}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {prio && (
          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border ${prio.cls}`}>
            <Flag size={10} /> {prio.label}
          </span>
        )}
        {due && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border bg-bg-card border-border text-text-secondary">
            <Calendar size={10} /> {due.date}
          </span>
        )}
        {due?.time && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border bg-bg-card border-border text-text-secondary">
            <CalendarClock size={10} /> {due.time}
          </span>
        )}
        {task.pomodoro_count > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border bg-accent-orange/10 border-accent-orange/30 text-accent-orange">
            <Flame size={10} /> {task.pomodoro_count}
          </span>
        )}
      </div>
    </div>
  );
}
