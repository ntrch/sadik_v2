import React, { useState, useContext, useEffect, useRef } from 'react';
import { Clock, CheckSquare, Flame, Activity, Edit3, ChevronDown, ChevronUp, Lightbulb, Calendar, ArrowRight, Briefcase, Code, Coffee, Users, Check, X as XIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppContext } from '../context/AppContext';
import { modesApi } from '../api/modes';
import { tasksApi, Task } from '../api/tasks';
import { statsApi, ModeStat, AppUsageStat, AppInsight } from '../api/stats';
import { settingsApi } from '../api/settings';
import ActivityChart from '../components/stats/ActivityChart';
import { AnimationEventType } from '../engine/types';

const PRESET_MODES = [
  { key: 'working',  label: 'Çalışıyor',   oledText: 'ÇALIŞIYOR' },
  { key: 'coding',   label: 'Kod Yazıyor',  oledText: 'KOD YAZIYOR' },
  { key: 'break',    label: 'Mola',         oledText: 'MOLA' },
  { key: 'meeting',  label: 'Toplantı',     oledText: 'TOPLANTI' },
];

// Maps mode keys to animation clip names (from mods/ folder)
const MODE_CLIP_MAP: Record<string, string> = {
  working: 'mod_working',
  break:   'mod_break',
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

const MODE_LABELS: Record<string, string> = {
  working: 'Çalışıyor', coding: 'Kod Yazıyor', break: 'Mola', meeting: 'Toplantı',
};

const MODE_ICON_MAP: Record<string, { icon: React.ComponentType<any>; color: string }> = {
  working: { icon: Briefcase, color: 'text-accent-purple' },
  coding:  { icon: Code,      color: 'text-accent-cyan' },
  break:   { icon: Coffee,    color: 'text-accent-green' },
  meeting: { icon: Users,     color: 'text-accent-yellow' },
};

const MODE_ACTIVE_STYLES: Record<string, string> = {
  working: 'bg-accent-purple/20 text-accent-purple border border-accent-purple/40',
  coding:  'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/40',
  break:   'bg-accent-green/20 text-accent-green border border-accent-green/40',
  meeting: 'bg-accent-yellow/20 text-accent-yellow border border-accent-yellow/40',
};

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0 && m > 0) return `${h} sa ${m} dk`;
  if (h > 0) return `${h} sa`;
  return `${Math.max(m, 1)} dk`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const {
    currentMode, setCurrentMode, showToast, pomodoroState,
    triggerEvent, showText, returnToIdle, playClipDirect, playModClip, getLoadedClipNames,
    engineState, activeInsight, acceptInsight, denyInsight,
  } = useContext(AppContext);
  const navigate = useNavigate();

  const [customMode, setCustomMode] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [savedCustomModes, setSavedCustomModes] = useState<string[]>([]);
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [modeStats, setModeStats] = useState<ModeStat[]>([]);
  const [appUsage, setAppUsage] = useState<AppUsageStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [modeStatsOpen, setModeStatsOpen] = useState(false);
  const [appUsageOpen, setAppUsageOpen] = useState(false);
  const modeReturnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    settingsApi.getAll().then((s) => {
      const saved = s['custom_modes'];
      if (saved) {
        try { setSavedCustomModes(JSON.parse(saved)); } catch {}
      }
    }).catch(() => {});
    // Today's tasks (todo + in_progress)
    tasksApi.list().then((all) => {
      const today = new Date().toISOString().split('T')[0];
      const relevant = all.filter((t) =>
        t.status === 'todo' || t.status === 'in_progress' ||
        (t.status === 'done' && t.updated_at?.startsWith(today))
      );
      setTodayTasks(relevant);
    }).catch(() => {});
    // Mode stats
    statsApi.daily().then(setModeStats).catch(() => {});
    // App usage
    statsApi.appUsageDaily().then(setAppUsage).catch(() => {});
    const poll = setInterval(() => {
      statsApi.appUsageDaily().then(setAppUsage).catch(() => {});
    }, 60_000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => () => { if (modeReturnTimer.current) clearTimeout(modeReturnTimer.current); }, []);

  // On mount: if a mode is already active and has a clip, start its animation
  const initialModClipStarted = useRef(false);
  useEffect(() => {
    if (initialModClipStarted.current || !currentMode) return;
    const clipName = MODE_CLIP_MAP[currentMode];
    if (!clipName) return;
    // Clips load async — check every 500ms until available (max 5s)
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      if (getLoadedClipNames().includes(clipName)) {
        clearInterval(check);
        initialModClipStarted.current = true;
        playModClip(clipName);
      } else if (attempts >= 10) {
        clearInterval(check);
      }
    }, 500);
    return () => clearInterval(check);
  }, [currentMode]);

  const handleEndMode = async () => {
    setLoading(true);
    try {
      await modesApi.endCurrent();
      setCurrentMode(null);
      returnToIdle();
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
      await modesApi.setMode(mode);
      setCurrentMode(mode);
      triggerEvent('confirmation_success');
      showToast(`Mod değiştirildi: ${mode}`, 'success');
      if (modeReturnTimer.current) clearTimeout(modeReturnTimer.current);

      // Check if this mode has a dedicated animation clip
      const clipName = MODE_CLIP_MAP[mode];
      if (clipName) {
        // Brief confirmation, then start the mod animation
        modeReturnTimer.current = setTimeout(() => playModClip(clipName), 1200);
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

  const handleApplyCustom = () => {
    if (customMode.trim()) {
      handleSetMode(customMode.trim(), customMode.trim().toUpperCase());
      setCustomMode('');
      setShowCustomInput(false);
    }
  };

  const handleSaveCustom = async () => {
    const name = customMode.trim();
    if (!name) return;
    const updated = savedCustomModes.includes(name)
      ? savedCustomModes
      : [...savedCustomModes, name];
    setSavedCustomModes(updated);
    await settingsApi.update({ custom_modes: JSON.stringify(updated) }).catch(() => {});
    handleSetMode(name, name.toUpperCase());
    setCustomMode('');
    setShowCustomInput(false);
  };

  const handleDeleteCustomMode = async (name: string) => {
    const updated = savedCustomModes.filter(m => m !== name);
    setSavedCustomModes(updated);
    await settingsApi.update({ custom_modes: JSON.stringify(updated) }).catch(() => {});
    showToast(`"${name}" modu silindi`, 'info');
  };

  const totalWorkSeconds = modeStats
    .filter((s) => ['working', 'coding', 'meeting'].includes(s.mode))
    .reduce((acc, s) => acc + s.total_seconds, 0);

  const doneToday = todayTasks.filter((t) => t.status === 'done').length;
  const activeTasks = todayTasks.filter((t) => t.status !== 'done');

  const loadedClips = getLoadedClipNames();
  const [selectedClip, setSelectedClip] = useState('');
  const [textInput, setTextInput] = useState('');

  return (
    <div className="h-full overflow-y-auto p-6 page-transition">
      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <StatCard icon={<Clock size={18} className="text-accent-purple" />} label="Toplam Çalışma" value={formatDuration(totalWorkSeconds)} color="purple" />
        <StatCard icon={<CheckSquare size={18} className="text-accent-green" />} label="Tamamlanan" value={`${doneToday} görev`} color="green" />
        <StatCard icon={<Flame size={18} className="text-accent-orange" />} label="Pomodoro" value={`${pomodoroState.current_session} oturum`} color="orange" />
        <StatCard icon={<Activity size={18} className="text-accent-cyan" />} label="Aktif Mod" value={currentMode ? (MODE_LABELS[currentMode] || currentMode) : '—'} color="cyan" />
      </div>

      {/* Mode selector — compact inline */}
      <div className="bg-bg-card border border-border rounded-card p-4 mb-5 shadow-card">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_MODES.map(({ key, label, oledText }) => {
              const isActive = currentMode === key;
              const activeStyle = MODE_ACTIVE_STYLES[key] ?? MODE_ACTIVE_STYLES.working;
              const iconInfo = MODE_ICON_MAP[key];
              const IconComp = iconInfo?.icon;
              return (
                <button
                  key={key}
                  onClick={() => handleSetMode(key, oledText)}
                  disabled={loading}
                  className={`px-4 py-2.5 rounded-[14px] text-sm font-semibold transition-all flex items-center gap-2
                    ${isActive
                      ? activeStyle
                      : 'bg-bg-input text-text-secondary border border-border hover:border-accent-purple/40 hover:text-text-primary'}`}
                >
                  {IconComp && <IconComp size={16} />}
                  {label}
                </button>
              );
            })}
            {/* Saved custom modes */}
            {savedCustomModes.map((name) => (
              <button
                key={`custom-${name}`}
                onClick={() => handleSetMode(name, name.toUpperCase())}
                disabled={loading}
                onContextMenu={(e) => { e.preventDefault(); handleDeleteCustomMode(name); }}
                title="Sağ tık ile sil"
                className={`px-4 py-2.5 rounded-[14px] text-sm font-semibold transition-all
                  ${currentMode === name
                    ? 'bg-accent-orange/20 text-accent-orange border border-accent-orange/40'
                    : 'bg-bg-input text-text-secondary border border-accent-orange/30 hover:border-accent-orange/60 hover:text-text-primary'}`}
              >
                {name}
              </button>
            ))}
            <button
              onClick={() => setShowCustomInput(!showCustomInput)}
              className={`px-4 py-2.5 rounded-[14px] text-sm font-semibold transition-all flex items-center gap-2
                ${showCustomInput ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/40' : 'bg-bg-input text-text-secondary border border-border hover:border-accent-purple/40 hover:text-text-primary'}`}
            >
              <Edit3 size={14} />
              Özel
            </button>
          </div>
        </div>
        {showCustomInput && (
          <div className="mt-3 flex gap-2">
            <input
              autoFocus
              value={customMode}
              onChange={(e) => setCustomMode(e.target.value)}
              placeholder="Özel mod adı..."
              className="input-field text-xs flex-1"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApplyCustom(); } }}
            />
            <button onClick={handleApplyCustom} disabled={!customMode.trim()}
              className="px-3 py-1.5 bg-bg-input border border-border text-text-secondary text-xs font-medium rounded-full transition-colors hover:text-text-primary hover:bg-bg-hover disabled:opacity-50">
              Uygula
            </button>
            <button onClick={handleSaveCustom} disabled={!customMode.trim()}
              className="px-3 py-1.5 bg-accent-purple hover:bg-accent-purple-hover text-white text-xs font-medium rounded-full transition-colors disabled:opacity-50">
              Kaydet
            </button>
          </div>
        )}
      </div>

      {/* Proactive insight */}
      <InsightCard insight={activeInsight} onAccept={acceptInsight} onDeny={denyInsight} />

      {/* Mode duration summary — accordion */}
      {modeStats.length > 0 && (
        <div className="bg-bg-card border border-border rounded-card overflow-hidden mb-5 shadow-card">
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
            <div className="px-5 pb-4 border-t border-border pt-3 space-y-2">
              {[...modeStats].sort((a, b) => b.total_seconds - a.total_seconds).map((m) => {
                const iconInfo = MODE_ICON_MAP[m.mode] ?? { icon: Edit3, color: 'text-accent-orange' };
                const IconComp = iconInfo.icon;
                return (
                  <div key={m.mode} className="flex items-center justify-between px-3 py-2 rounded-btn hover:bg-bg-hover transition-colors">
                    <div className="flex items-center gap-2">
                      <IconComp size={14} className={iconInfo.color} />
                      <span className="text-xs text-text-secondary">{MODE_LABELS[m.mode] || m.mode}</span>
                    </div>
                    <span className="text-xs font-medium text-text-primary">{formatDuration(m.total_seconds)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Today's tasks */}
      <div className="bg-bg-card border border-border rounded-card p-5 mb-5 shadow-card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-primary">Bugünkü Görevler</h2>
          <button onClick={() => navigate('/tasks')}
            className="text-[11px] text-accent-purple hover:text-accent-purple-hover transition-colors flex items-center gap-1">
            Tümünü Gör <ArrowRight size={10} />
          </button>
        </div>
        {activeTasks.length === 0 ? (
          <p className="text-xs text-text-muted py-3 text-center">Aktif görev yok</p>
        ) : (
          <div className="space-y-2">
            {activeTasks.slice(0, 5).map((task) => (
              <div key={task.id}
                onClick={() => navigate('/tasks')}
                className="flex items-center gap-3 px-3 py-2 bg-bg-input rounded-btn cursor-pointer hover:bg-bg-hover transition-colors">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  task.status === 'in_progress' ? 'bg-accent-yellow' : 'bg-text-muted'
                }`} />
                <span className="text-xs text-text-primary flex-1 truncate">{task.title}</span>
                <span className="text-[10px] text-text-muted">
                  {task.status === 'in_progress' ? 'Devam Ediyor' : 'Yapılacak'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* App usage — accordion */}
      <div className="bg-bg-card border border-border rounded-card overflow-hidden mb-5 shadow-card">
        <button
          onClick={() => setAppUsageOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-text-primary hover:bg-bg-hover transition-colors"
        >
          <span>Uygulama Kullanımı</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted">{appUsage.length} uygulama</span>
            {appUsageOpen ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
          </div>
        </button>
        {appUsageOpen && (
          <div className="px-5 pb-4 border-t border-border pt-3">
            {appUsage.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-3">Henüz veri yok</p>
            ) : (
              <div className="space-y-1">
                {appUsage.map((item, i) => (
                  <div key={item.app_name}
                    className="flex items-center justify-between px-3 py-2 rounded-btn hover:bg-bg-hover transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-text-muted w-4">{i + 1}.</span>
                      <span className="text-xs text-text-primary">{beautifyAppName(item.app_name)}</span>
                    </div>
                    <span className="text-xs text-text-secondary font-medium">{formatDuration(item.duration_seconds)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Activity chart */}
      <ActivityChart />

      {/* Debug panel */}
      <div className="mt-6 bg-bg-card border border-border rounded-card overflow-hidden shadow-card">
        <button
          onClick={() => setDebugOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-text-secondary hover:text-text-primary transition-colors"
        >
          <span>Animasyon Debug</span>
          {debugOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>

        {debugOpen && (
          <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">
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
          </div>
        )}
      </div>
    </div>
  );
}

// ── Proactive Insight Card ────────────────────────────────────────────────────

const LEVEL_LABEL: Record<string, string> = {
  gentle: 'Nazik öneri',
  strong: 'Güçlü öneri',
};

const LEVEL_COLORS: Record<string, { card: string; badge: string; icon: string; text: string }> = {
  gentle: {
    card:  'border-accent-yellow/30 bg-accent-yellow/5',
    badge: 'bg-accent-yellow/10 text-accent-yellow border-accent-yellow/20',
    icon:  'text-accent-yellow',
    text:  'text-accent-yellow',
  },
  strong: {
    card:  'border-accent-orange/30 bg-accent-orange/5',
    badge: 'bg-accent-orange/10 text-accent-orange border-accent-orange/20',
    icon:  'text-accent-orange',
    text:  'text-accent-orange',
  },
};

function InsightCard({ insight, onAccept, onDeny }: { insight: AppInsight | null; onAccept: () => void; onDeny: () => void }) {
  if (!insight?.has_insight) {
    return (
      <div className="bg-bg-card border border-border rounded-card p-4 mb-5 flex items-center gap-3 shadow-card">
        <Lightbulb size={16} className="text-text-muted flex-shrink-0" />
        <p className="text-xs text-text-muted">Şu an öneri yok. SADIK kullanımını izliyor.</p>
      </div>
    );
  }

  const level   = insight.level ?? 'gentle';
  const colors  = LEVEL_COLORS[level] ?? LEVEL_COLORS.gentle;
  const label   = LEVEL_LABEL[level] ?? 'Öneri';

  return (
    <div className={`border rounded-card p-4 mb-5 shadow-card ${colors.card}`}>
      <div className="flex items-start gap-3">
        <Lightbulb size={18} className={`flex-shrink-0 mt-0.5 ${colors.icon}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colors.badge}`}>
              {label}
            </span>
          </div>
          <p className={`text-sm leading-relaxed font-medium ${colors.text}`}>{insight.message}</p>
          <div className="flex items-center gap-2 mt-3">
            {insight.source === 'task' ? (
              <button
                onClick={onDeny}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-btn bg-bg-input text-text-muted border border-border hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <Check size={12} /> Tamam
              </button>
            ) : (
              <>
                <button
                  onClick={onAccept}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-btn bg-accent-green/15 text-accent-green border border-accent-green/30 hover:bg-accent-green/25 transition-colors"
                >
                  <Check size={12} /> Molaya Geç
                </button>
                <button
                  onClick={onDeny}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-btn bg-bg-input text-text-muted border border-border hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <XIcon size={12} /> Reddet
                </button>
              </>
            )}
          </div>
        </div>
      </div>
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
  const cardBg: Record<string, string> = {
    purple: 'bg-accent-purple/8 border-accent-purple/20',
    green:  'bg-accent-green/8 border-accent-green/20',
    orange: 'bg-accent-orange/8 border-accent-orange/20',
    cyan:   'bg-accent-cyan/8 border-accent-cyan/20',
    blue:   'bg-accent-blue/8 border-accent-blue/20',
    yellow: 'bg-accent-yellow/8 border-accent-yellow/20',
  };
  const iconBg: Record<string, string> = {
    purple: 'bg-accent-purple/15', green: 'bg-accent-green/15',
    orange: 'bg-accent-orange/15', cyan: 'bg-accent-cyan/15',
    blue: 'bg-accent-blue/15', yellow: 'bg-accent-yellow/15',
  };
  return (
    <div className={`border rounded-card p-4 shadow-card backdrop-blur-sm ${cardBg[color] ?? cardBg.purple}`}>
      <div className={`w-9 h-9 rounded-xl ${iconBg[color] ?? iconBg.purple} flex items-center justify-center mb-3`}>{icon}</div>
      <p className="text-xl font-bold text-text-primary mb-0.5">{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}
