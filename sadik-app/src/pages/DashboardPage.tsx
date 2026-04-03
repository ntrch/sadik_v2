import React, { useState, useContext, useEffect, useRef } from 'react';
import { Clock, CheckSquare, Flame, Activity, Edit3, ChevronDown, ChevronUp } from 'lucide-react';
import { AppContext } from '../context/AppContext';
import { modesApi } from '../api/modes';
import { tasksApi } from '../api/tasks';
import { statsApi, ModeStat } from '../api/stats';
import { settingsApi } from '../api/settings';
import ActivityChart from '../components/stats/ActivityChart';
import { AnimationEventType } from '../engine/types';

const PRESET_MODES = [
  { key: 'working',  label: 'Çalışıyor',   oledText: 'ÇALIŞIYOR' },
  { key: 'coding',   label: 'Kod Yazıyor', oledText: 'KOD YAZIYOR' },
  { key: 'break',    label: 'Mola',        oledText: 'MOLA' },
  { key: 'meeting',  label: 'Toplantı',    oledText: 'TOPLANTI' },
];

const EVENT_BUTTONS_ROW1: { label: string; event: AnimationEventType }[] = [
  { label: '🎙️ Wake Word',  event: 'wake_word_detected' },
  { label: '👂 Dinliyor',   event: 'user_speaking' },
  { label: '🧠 Düşünüyor', event: 'processing' },
  { label: '💬 Konuşuyor', event: 'assistant_speaking' },
  { label: '✅ Onay',       event: 'confirmation_success' },
  { label: '💡 Anladı',    event: 'understanding_resolved' },
];

const EVENT_BUTTONS_ROW2: { label: string; event: AnimationEventType }[] = [
  { label: '❓ Duymadı',  event: 'didnt_hear' },
  { label: '⚠️ Hata',     event: 'soft_error' },
  { label: '😕 Karıştı',  event: 'ambiguity' },
  { label: '👋 Bitti',    event: 'conversation_finished' },
  { label: '🏠 İdle\'a Dön', event: 'return_to_idle' },
];

export default function DashboardPage() {
  const {
    currentMode, setCurrentMode, showToast, pomodoroState,
    triggerEvent, showText, returnToIdle, playClipDirect, getLoadedClipNames,
    engineState,
  } = useContext(AppContext);

  const [customMode, setCustomMode] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [workSeconds, setWorkSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [selectedClip, setSelectedClip] = useState('');
  const [textInput, setTextInput] = useState('');
  const [userName, setUserName] = useState('');
  const modeReturnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    tasksApi.list('done').then((t) => setDoneCount(t.length)).catch(() => {});
    settingsApi.getAll().then((s) => setUserName(s['user_name'] ?? '')).catch(() => {});
    statsApi.daily().then((stats: ModeStat[]) => {
      const workModes = ['working', 'coding', 'meeting'];
      const total = stats
        .filter((s) => workModes.includes(s.mode))
        .reduce((acc, s) => acc + s.total_seconds, 0);
      setWorkSeconds(total);
    }).catch(() => {});
  }, []);

  const handleSetMode = async (mode: string, oledText?: string) => {
    if (!mode.trim()) return;
    setLoading(true);
    try {
      await modesApi.setMode(mode);
      setCurrentMode(mode);
      showToast(`Mod değiştirildi: ${mode}`, 'success');
      // Show mode name on OLED for 3 seconds then return to idle
      const displayText = oledText ?? mode.toUpperCase();
      showText(displayText);
      if (modeReturnTimer.current) clearTimeout(modeReturnTimer.current);
      modeReturnTimer.current = setTimeout(() => returnToIdle(), 3000);
    } catch {
      showToast('Mod değiştirilemedi', 'error');
    }
    setLoading(false);
  };

  useEffect(() => () => { if (modeReturnTimer.current) clearTimeout(modeReturnTimer.current); }, []);

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customMode.trim()) {
      handleSetMode(customMode.trim(), customMode.trim().toUpperCase());
      setCustomMode('');
      setShowCustomInput(false);
    }
  };

  const formatWorkTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}s ${m}dk`;
    return `${m}dk`;
  };

  const modeLabel: Record<string, string> = {
    working: 'Çalışıyor', coding: 'Kod Yazıyor', break: 'Mola', meeting: 'Toplantı',
  };

  const loadedClips = getLoadedClipNames();

  const modeMap = playbackModeLabel(engineState.playbackMode);

  return (
    <div className="h-full overflow-y-auto p-6 page-transition">
      <h1 className="text-xl font-bold text-text-primary mb-6">
        {userName ? `Merhaba, ${userName}!` : 'Dashboard'}
      </h1>

      {/* Mode selector */}
      <div className="bg-bg-card border border-border rounded-card p-5 mb-5">
        <h2 className="text-sm font-semibold text-text-secondary mb-3">Mevcut Mod</h2>
        {currentMode && (
          <div className="mb-3">
            <span className="text-xs bg-accent-blue/20 text-accent-blue px-3 py-1 rounded-full font-medium border border-accent-blue/30">
              {modeLabel[currentMode] || currentMode}
            </span>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {PRESET_MODES.map(({ key, label, oledText }) => (
            <button
              key={key}
              onClick={() => handleSetMode(key, oledText)}
              disabled={loading}
              className={`px-4 py-2 rounded-btn text-sm font-medium transition-all
                ${currentMode === key
                  ? 'bg-accent-blue text-white shadow-lg shadow-accent-blue/20'
                  : 'bg-bg-input text-text-secondary border border-border hover:border-accent-blue/40 hover:text-text-primary'}`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => setShowCustomInput(!showCustomInput)}
            className={`px-4 py-2 rounded-btn text-sm font-medium transition-all flex items-center gap-2
              ${showCustomInput ? 'bg-accent-purple text-white' : 'bg-bg-input text-text-secondary border border-border hover:border-accent-purple/40 hover:text-text-primary'}`}
          >
            <Edit3 size={13} />
            Özel
          </button>
        </div>
        {showCustomInput && (
          <form onSubmit={handleCustomSubmit} className="mt-3 flex gap-2">
            <input
              autoFocus
              value={customMode}
              onChange={(e) => setCustomMode(e.target.value)}
              placeholder="Özel mod adı..."
              className="flex-1 bg-bg-input border border-border rounded-btn px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent-blue transition-colors"
            />
            <button type="submit"
              className="px-4 py-2 bg-accent-blue hover:bg-accent-blue-hover text-white text-sm font-medium rounded-btn transition-colors">
              Ayarla
            </button>
          </form>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        <StatCard icon={<Clock size={18} className="text-accent-blue" />} label="Toplam Çalışma" value={formatWorkTime(workSeconds)} color="blue" />
        <StatCard icon={<CheckSquare size={18} className="text-accent-green" />} label="Tamamlanan" value={`${doneCount} görev`} color="green" />
        <StatCard icon={<Flame size={18} className="text-accent-red" />} label="Pomodoro" value={`${pomodoroState.current_session} oturum`} color="red" />
        <StatCard icon={<Activity size={18} className="text-accent-yellow" />} label="Aktif Mod" value={currentMode ? (modeLabel[currentMode] || currentMode) : '—'} color="yellow" />
      </div>

      {/* Activity chart */}
      <ActivityChart />

      {/* ─── Animasyon Debug ─────────────────────────────────────────── */}
      <div className="mt-6 bg-bg-card border border-border rounded-card overflow-hidden">
        <button
          onClick={() => setDebugOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-text-secondary hover:text-text-primary transition-colors"
        >
          <span>Animasyon Debug</span>
          {debugOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>

        {debugOpen && (
          <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">
            {/* Status bar */}
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <DebugRow label="Aktif Klip" value={engineState.currentClipName ?? 'yok'} />
              <DebugRow label="Mod" value={modeMap} />
              <DebugRow label="Kare" value={`${engineState.currentFrameIndex} / ${engineState.totalFrames}`} />
              <DebugRow label="FPS" value={String(engineState.fps)} />
              <DebugRow label="Idle Durumu" value={engineState.idleSubState} />
              <DebugRow label="Metin" value={engineState.textContent ?? '—'} />
            </div>

            {/* Row 1 events */}
            <div>
              <p className="text-xs text-text-muted mb-2">Uygulama Olayları</p>
              <div className="flex flex-wrap gap-2">
                {EVENT_BUTTONS_ROW1.map(({ label, event }) => (
                  <button key={event} onClick={() => triggerEvent(event)}
                    className="px-3 py-1.5 rounded-btn text-xs bg-bg-input border border-border text-text-secondary hover:border-accent-blue/40 hover:text-text-primary transition-colors">
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 2 events */}
            <div>
              <div className="flex flex-wrap gap-2">
                {EVENT_BUTTONS_ROW2.map(({ label, event }) => (
                  <button key={event} onClick={() => triggerEvent(event)}
                    className="px-3 py-1.5 rounded-btn text-xs bg-bg-input border border-border text-text-secondary hover:border-accent-blue/40 hover:text-text-primary transition-colors">
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Direct clip test */}
            <div>
              <p className="text-xs text-text-muted mb-2">Direkt Klip Testi</p>
              {loadedClips.length === 0 ? (
                <p className="text-xs text-text-muted italic">Hiç klip yüklenmedi (.cpp dosyaları ekleyin ve convert edin)</p>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={selectedClip}
                    onChange={(e) => setSelectedClip(e.target.value)}
                    className="flex-1 bg-bg-input border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue"
                  >
                    <option value="">Klip seçin...</option>
                    {loadedClips.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => { if (selectedClip) playClipDirect(selectedClip); }}
                    disabled={!selectedClip}
                    className="px-4 py-1.5 bg-accent-blue hover:bg-accent-blue-hover text-white text-xs font-medium rounded-btn transition-colors disabled:opacity-40">
                    Oynat
                  </button>
                </div>
              )}
            </div>

            {/* Text test */}
            <div>
              <p className="text-xs text-text-muted mb-2">Metin Testi</p>
              <div className="flex gap-2">
                <input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Gösterilecek metin..."
                  className="flex-1 bg-bg-input border border-border rounded-btn px-3 py-1.5 text-xs text-text-primary placeholder-text-muted outline-none focus:border-accent-blue transition-colors"
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
  const bg: Record<string, string> = { blue: 'bg-accent-blue/10', green: 'bg-accent-green/10', red: 'bg-accent-red/10', yellow: 'bg-accent-yellow/10' };
  return (
    <div className="bg-bg-card border border-border rounded-card p-4">
      <div className={`w-8 h-8 rounded-btn ${bg[color]} flex items-center justify-center mb-3`}>{icon}</div>
      <p className="text-xl font-bold text-text-primary mb-0.5">{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}
