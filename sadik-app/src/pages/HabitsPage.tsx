import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Pencil, Trash2, Repeat, Check, Clock, SkipForward, Calendar } from 'lucide-react';
import { habitsApi, Habit, HabitCreate, HabitUpdate, HabitLog, HabitDue } from '../api/habits';
import EmptyState from '../components/common/EmptyState';
import IconPicker from '../components/mode/IconPicker';
import { ICON_MAP } from '../utils/modeIcons';
import { PALETTE } from '../utils/modeColors';

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const DEFAULT_DAYS = [0, 1, 2, 3, 4];
const HABIT_COLORS = [
  '#fdba74', '#f472b6', '#c084fc', '#60a5fa',
  '#34d399', '#facc15', '#f87171', '#22d3ee',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const dow = d.getDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow; // Mon start
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function formatDays(days: number[]): string {
  if (days.length === 7) return 'Her gün';
  if (days.length === 0) return '—';
  return days.map((d) => DAY_LABELS[d]).join(', ');
}

function HabitIcon({ iconKey, color, size = 18 }: { iconKey: string; color: string; size?: number }) {
  const Icon = ICON_MAP[iconKey];
  if (!Icon) return <span style={{ fontSize: size, color }}>{iconKey[0]?.toUpperCase()}</span>;
  return <Icon size={size} color={color} />;
}

/** Compute streak from logs — consecutive days with at least one 'done' log */
function computeStreak(logs: HabitLog[], habitId: number): number {
  const doneDates = new Set(
    logs
      .filter((l) => l.habit_id === habitId && l.status === 'done')
      .map((l) => l.log_date)
  );
  if (doneDates.size === 0) return 0;
  let streak = 0;
  let cursor = todayStr();
  // Allow today's done to count; if not done today, start from yesterday
  if (!doneDates.has(cursor)) cursor = addDays(cursor, -1);
  while (doneDates.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, color = '#fdba74' }: { checked: boolean; onChange: (v: boolean) => void; color?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
        checked ? '' : 'bg-bg-card border border-border'
      }`}
      style={checked ? { backgroundColor: `${color}66` } : {}}
    >
      <span
        className="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
        style={{ transform: checked ? 'translateX(16px)' : 'translateX(2px)' }}
      />
    </button>
  );
}

// ── Snooze popup ──────────────────────────────────────────────────────────────

function SnoozePopup({ onSelect, onClose }: { onSelect: (m: number) => void; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-snooze-popup]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const options = [
    { label: '15 dk', value: 15 },
    { label: '30 dk', value: 30 },
    { label: '1 saat', value: 60 },
    { label: '2 saat', value: 120 },
  ];

  return (
    <div
      data-snooze-popup=""
      className="absolute z-50 bottom-full mb-2 left-0 bg-bg-card border border-border rounded-xl shadow-card p-2 flex gap-2"
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => { onSelect(o.value); onClose(); }}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-bg-main border border-border text-text-secondary hover:text-text-primary hover:border-border transition-colors"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── HabitModal ────────────────────────────────────────────────────────────────

interface ModalProps {
  habit: Habit | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function HabitModal({ habit, onClose, onSaved }: ModalProps) {
  const [name, setName]               = useState(habit?.name ?? '');
  const [description, setDescription] = useState(habit?.description ?? '');
  const [days, setDays]               = useState<number[]>(habit?.days_of_week ?? DEFAULT_DAYS);
  const [time, setTime]               = useState(habit?.time ?? '09:00');
  const [minutesBefore, setMinutesBefore] = useState(habit?.minutes_before ?? 5);
  const [respectDnd, setRespectDnd]   = useState(habit?.respect_dnd ?? true);
  const [enabled, setEnabled]         = useState(habit?.enabled ?? true);
  const [color, setColor]             = useState(habit?.color ?? '#fdba74');
  const [icon, setIcon]               = useState(habit?.icon ?? 'repeat');
  const [targetDays, setTargetDays]   = useState(habit?.target_days ?? 66);
  const [freqType, setFreqType]       = useState<'daily' | 'interval'>(habit?.frequency_type ?? 'daily');
  const [intervalMin, setIntervalMin] = useState<number>(habit?.interval_minutes ?? 30);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const iconBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const toggleDay = (d: number) => {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)
    );
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('İsim zorunlu'); return; }
    if (freqType === 'daily' && days.length === 0) { setError('En az bir gün seçmelisin'); return; }
    if (freqType === 'interval' && (!intervalMin || intervalMin < 5)) { setError('Interval en az 5 dk'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: HabitCreate | HabitUpdate = {
        name: name.trim(),
        description: description.trim() || null,
        days_of_week: freqType === 'daily' ? days : [],
        time: freqType === 'daily' ? time : '00:00',
        minutes_before: minutesBefore,
        respect_dnd: respectDnd,
        enabled,
        color,
        icon,
        target_days: targetDays,
        frequency_type: freqType,
        interval_minutes: freqType === 'interval' ? intervalMin : null,
      };
      if (habit) {
        await habitsApi.update(habit.id, payload as HabitUpdate);
      } else {
        await habitsApi.create(payload as HabitCreate);
      }
      await onSaved();
      onClose();
    } catch {
      setError('Kayıt hatası. Tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  const INTERVAL_CHIPS = [15, 30, 60, 90, 120];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-card border border-border rounded-2xl w-[min(90vw,540px)] max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <span className="font-semibold text-text-primary">
            {habit ? 'Alışkanlığı Düzenle' : 'Yeni Alışkanlık'}
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-hover text-text-secondary">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-5">

          {/* Color + Icon row */}
          <div className="flex items-center gap-4">
            {/* Color swatches */}
            <div>
              <label className="block text-xs text-text-muted mb-1.5 font-medium">Renk</label>
              <div className="flex gap-1.5 flex-wrap">
                {HABIT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="w-7 h-7 rounded-lg transition-transform"
                    style={{
                      backgroundColor: c,
                      outline: color === c ? `2px solid ${c}` : 'none',
                      outlineOffset: 2,
                      transform: color === c ? 'scale(1.15)' : 'scale(1)',
                    }}
                  />
                ))}
              </div>
            </div>
            {/* Icon button */}
            <div className="relative">
              <label className="block text-xs text-text-muted mb-1.5 font-medium">İkon</label>
              <button
                ref={iconBtnRef as React.RefObject<HTMLButtonElement>}
                type="button"
                onClick={() => setIconPickerOpen(!iconPickerOpen)}
                className="w-10 h-10 rounded-xl border border-border flex items-center justify-center hover:bg-bg-hover transition-colors"
                style={{ backgroundColor: `${color}22` }}
              >
                <HabitIcon iconKey={icon} color={color} size={20} />
              </button>
              <IconPicker
                anchorRef={iconBtnRef as React.RefObject<HTMLElement>}
                open={iconPickerOpen}
                onClose={() => setIconPickerOpen(false)}
                currentIcon={icon}
                color={color}
                onSelect={(k) => { setIcon(k); setIconPickerOpen(false); }}
              />
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5 font-medium">İsim</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Egzersiz, Kitap okuma..."
              className="w-full bg-bg-main border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5 font-medium">Açıklama (opsiyonel)</label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              placeholder="Hatırlatma notu..."
              rows={2}
              className="w-full bg-bg-main border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary resize-none overflow-hidden"
            />
          </div>

          {/* Frequency type */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5 font-medium">Sıklık</label>
            <div className="flex gap-2">
              {(['daily', 'interval'] as const).map((ft) => (
                <button
                  key={ft}
                  type="button"
                  onClick={() => setFreqType(ft)}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                    freqType === ft
                      ? 'border-accent-primary/50 bg-accent-primary/10 text-accent-primary'
                      : 'border-border bg-bg-main text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {ft === 'daily' ? 'Günlük' : 'Tekrarlayan (her X dk)'}
                </button>
              ))}
            </div>
          </div>

          {/* Daily: days + time */}
          {freqType === 'daily' && (
            <>
              <div>
                <label className="block text-xs text-text-muted mb-1.5 font-medium">Günler (en az 1)</label>
                <div className="flex gap-2 flex-wrap">
                  {DAY_LABELS.map((label, idx) => {
                    const active = days.includes(idx);
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => toggleDay(idx)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          active
                            ? 'ring-1'
                            : 'bg-bg-main border border-border text-text-secondary hover:text-text-primary'
                        }`}
                        style={active ? {
                          backgroundColor: `${color}22`,
                          color,
                          borderColor: `${color}66`,
                          outlineColor: `${color}66`,
                        } : {}}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1.5 font-medium">Saat</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="bg-bg-main border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1.5 font-medium">
                  Kaç dakika öncesi hatırlat: <span className="text-text-primary font-semibold">{minutesBefore} dk</span>
                </label>
                <input
                  type="range" min={0} max={120} step={5} value={minutesBefore}
                  onChange={(e) => setMinutesBefore(Number(e.target.value))}
                  className="w-full accent-orange-400"
                />
              </div>
            </>
          )}

          {/* Interval: quick chips + custom input */}
          {freqType === 'interval' && (
            <div>
              <label className="block text-xs text-text-muted mb-1.5 font-medium">Tekrar aralığı</label>
              <div className="flex gap-2 flex-wrap mb-2">
                {INTERVAL_CHIPS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setIntervalMin(v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      intervalMin === v
                        ? 'border-accent-primary/50 bg-accent-primary/10 text-accent-primary'
                        : 'border-border bg-bg-main text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {v < 60 ? `${v} dk` : `${v / 60} saat`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={5} max={720} value={intervalMin}
                  onChange={(e) => setIntervalMin(Number(e.target.value))}
                  className="w-24 bg-bg-main border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary"
                />
                <span className="text-xs text-text-muted">dk (5–720)</span>
              </div>
            </div>
          )}

          {/* Target days */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5 font-medium">Hedef (gün)</label>
            <input
              type="number" min={1} max={1000} value={targetDays}
              onChange={(e) => setTargetDays(Number(e.target.value))}
              className="w-28 bg-bg-main border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary"
            />
          </div>

          {/* Respect DND + Enabled */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Rahatsız Etmeyin aktifse atla</p>
              <p className="text-xs text-text-muted">Rahatsız Etmeyin modunda hatırlatmayı sessizleştir</p>
            </div>
            <Toggle checked={respectDnd} onChange={setRespectDnd} color={color} />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-primary">Aktif</p>
            <Toggle checked={enabled} onChange={setEnabled} color={color} />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-bg-hover transition-colors">
            İptal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-semibold border disabled:opacity-50 transition-colors"
            style={{ backgroundColor: `${color}22`, color, borderColor: `${color}44` }}
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Due habit hero card ───────────────────────────────────────────────────────

interface DueCardProps {
  due: HabitDue;
  onDidIt: () => void;
  onSnooze: (minutes: number) => void;
  onSkip: () => void;
  onReschedule: () => void;
}

function DueHabitCard({ due, onDidIt, onSnooze, onSkip, onReschedule }: DueCardProps) {
  const { habit, next_trigger_at } = due;
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const color = habit.color;

  const timeLabel = () => {
    if (habit.frequency_type === 'interval') {
      const nextStr = next_trigger_at
        ? new Date(next_trigger_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
        : '';
      return `Her ${habit.interval_minutes} dk${nextStr ? ` · sıradaki ${nextStr}` : ''}`;
    }
    return habit.time;
  };

  return (
    <div
      className="rounded-card p-5 border flex flex-col gap-3"
      style={{ backgroundColor: `${color}1a`, borderColor: `${color}33` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}33` }}
        >
          <HabitIcon iconKey={habit.icon} color={color} size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text-primary text-sm">{habit.name}</p>
          {habit.description && (
            <p className="text-xs text-text-muted mt-0.5">{habit.description}</p>
          )}
          <p className="text-xs mt-1 font-medium" style={{ color }}>{timeLabel()}</p>
        </div>
      </div>
      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onDidIt}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-xs font-semibold border transition-colors"
          style={{ backgroundColor: `${color}22`, color, borderColor: `${color}44` }}
        >
          <Check size={14} />
          Yaptım
        </button>
        <div className="relative">
          <button
            onClick={() => setSnoozeOpen(!snoozeOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-xs font-semibold bg-bg-card border border-border text-text-secondary hover:text-text-primary transition-colors"
          >
            <Clock size={14} />
            Ertele
          </button>
          {snoozeOpen && (
            <SnoozePopup
              onSelect={(m) => { onSnooze(m); setSnoozeOpen(false); }}
              onClose={() => setSnoozeOpen(false)}
            />
          )}
        </div>
        <button
          onClick={onSkip}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-xs font-semibold bg-bg-card border border-border text-text-secondary hover:text-text-primary transition-colors"
        >
          <SkipForward size={14} />
          Atla
        </button>
        {habit.frequency_type === 'daily' && (
          <button
            onClick={onReschedule}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-xs font-semibold bg-bg-card border border-border text-text-secondary hover:text-text-primary transition-colors"
          >
            <Calendar size={14} />
            Saati Değiştir
          </button>
        )}
      </div>
    </div>
  );
}

// ── Week grid ─────────────────────────────────────────────────────────────────

interface WeekGridProps {
  habits: Habit[];
  logs: HabitLog[];
  weekOffset: number;
  onEditHabit: (h: Habit) => void;
  onDeleteHabit: (id: number) => void;
}

function WeekGrid({ habits, logs, weekOffset, onEditHabit, onDeleteHabit }: WeekGridProps) {
  const today = todayStr();
  const baseWeekStart = getWeekStart(new Date());
  const weekStart = addDays(baseWeekStart, weekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayIdx = weekDays.indexOf(today);

  // Map: habitId -> dateStr -> status
  const logMap = useMemo(() => {
    const m: Record<number, Record<string, string>> = {};
    for (const log of logs) {
      if (!m[log.habit_id]) m[log.habit_id] = {};
      // Prefer 'done' over other statuses for same day
      const existing = m[log.habit_id][log.log_date];
      if (!existing || log.status === 'done') {
        m[log.habit_id][log.log_date] = log.status;
      }
    }
    return m;
  }, [logs]);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setExpanded((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  if (habits.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border-subtle rounded-card overflow-hidden">
      {/* Column header */}
      <div className="grid gap-0" style={{ gridTemplateColumns: '1fr repeat(7, 2.5rem)' }}>
        <div className="px-4 py-2 text-xs text-text-muted font-medium border-b border-border-subtle">Alışkanlık</div>
        {weekDays.map((d, i) => (
          <div
            key={d}
            className="py-2 text-center text-[10px] font-semibold border-b border-border-subtle"
            style={i === todayIdx ? { backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-bg-main)', borderRadius: '0' } : { color: 'var(--color-text-muted)' }}
          >
            {DAY_LABELS[new Date(d + 'T00:00:00').getDay() === 0 ? 6 : new Date(d + 'T00:00:00').getDay() - 1]}
          </div>
        ))}
      </div>
      {habits.map((habit, hIdx) => {
        const color = habit.color;
        const streak = computeStreak(logs, habit.id);
        const isExpanded = expanded.has(habit.id);
        return (
          <React.Fragment key={habit.id}>
            <div
              className={`grid gap-0 group hover:bg-bg-hover/40 transition-colors ${hIdx < habits.length - 1 ? 'border-b border-border-subtle' : ''}`}
              style={{ gridTemplateColumns: '1fr repeat(7, 2.5rem)' }}
            >
              {/* Habit info cell */}
              <div className="flex items-center gap-2 px-4 py-3 min-w-0">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${color}22` }}
                >
                  <HabitIcon iconKey={habit.icon} color={color} size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-text-primary truncate">{habit.name}</p>
                  <p className="text-[10px] text-text-muted">
                    {streak > 0 ? `🔥${streak}g/${habit.target_days}g` : `0g/${habit.target_days}g`}
                    {' · '}
                    {habit.frequency_type === 'interval'
                      ? `🔁 her ${habit.interval_minutes} dk`
                      : `🕘 ${habit.time}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={() => onEditHabit(habit)}
                    className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => onDeleteHabit(habit.id)}
                    className="p-1 rounded-md hover:bg-accent-red/10 text-text-muted hover:text-accent-red"
                  >
                    <Trash2 size={12} />
                  </button>
                  <button
                    onClick={() => toggle(habit.id)}
                    className="p-1 rounded-md hover:bg-bg-hover text-text-muted"
                  >
                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>
              </div>
              {/* Day cells */}
              {weekDays.map((d, i) => {
                const status = logMap[habit.id]?.[d];
                const isToday = i === todayIdx;
                return (
                  <div key={d} className="flex items-center justify-center py-3">
                    {status === 'done' ? (
                      <div
                        className="w-6 h-6 rounded-md flex items-center justify-center text-[10px]"
                        style={{ backgroundColor: `${color}33` }}
                        title="Tamamlandı"
                      >
                        <span style={{ color }}>✓</span>
                      </div>
                    ) : status === 'skipped' ? (
                      <div
                        className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] bg-bg-main border border-border"
                        title="Atlandı"
                      >
                        <span className="text-text-muted">✗</span>
                      </div>
                    ) : isToday ? (
                      <div
                        className="w-6 h-6 rounded-md border-2"
                        style={{ borderColor: `${color}66` }}
                        title="Bugün"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-md" />
                    )}
                  </div>
                );
              })}
            </div>
            {isExpanded && (
              <div className="px-4 py-2 bg-bg-main/50 border-b border-border-subtle text-xs text-text-muted">
                {habit.description || <span className="italic">Açıklama yok</span>}
                <div className="mt-1 flex gap-3 flex-wrap text-[10px]">
                  <span>Günler: {habit.frequency_type === 'daily' ? formatDays(habit.days_of_week) : '—'}</span>
                  <span>Renk: <span className="inline-block w-2.5 h-2.5 rounded-sm align-middle" style={{ backgroundColor: habit.color }} /></span>
                  <span>İkon: {habit.icon}</span>
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HabitsPage() {
  const [habits, setHabits]       = useState<Habit[]>([]);
  const [logs, setLogs]           = useState<HabitLog[]>([]);
  const [dueList, setDueList]     = useState<HabitDue[]>([]);
  const [loading, setLoading]     = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Habit | null>(null);
  const [modalKey, setModalKey]   = useState(0);
  const [toast, setToast]         = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const today = todayStr();
      const from = addDays(today, -90);
      const fetched = await habitsApi.getLogs(from, today);
      setLogs(fetched);
    } catch {
      // best-effort
    }
  }, []);

  const loadDue = useCallback(async () => {
    try {
      const due = await habitsApi.getDue();
      setDueList(due);
    } catch {
      // best-effort
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [data] = await Promise.all([habitsApi.list()]);
      setHabits(data);
    } catch {
      showToast('Alışkanlıklar yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadAll = useCallback(async () => {
    await Promise.all([load(), loadLogs(), loadDue()]);
  }, [load, loadLogs, loadDue]);

  useEffect(() => {
    loadAll();
    // Poll every 30s so "Yaptım" actions from GlobalInsightCard are reflected
    const interval = setInterval(loadAll, 30_000);
    // Refresh immediately when the window regains focus (e.g. after closing InsightCard)
    window.addEventListener('focus', loadAll);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', loadAll);
    };
  }, [loadAll]);

  const openCreate = () => {
    setModalKey((k) => k + 1);
    setEditTarget(null);
    setModalOpen(true);
  };

  const openEdit = (h: Habit) => {
    setModalKey((k) => k + 1);
    setEditTarget(h);
    setModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Bu alışkanlığı silmek istediğine emin misin?')) return;
    try {
      await habitsApi.remove(id);
      setHabits((prev) => prev.filter((h) => h.id !== id));
      showToast('Silindi', 'success');
    } catch {
      showToast('Silinemedi', 'error');
    }
  };

  // Stats
  const today = todayStr();
  const enabledToday = habits.filter((h) => {
    if (!h.enabled) return false;
    if (h.frequency_type === 'interval') return true;
    const todayDow = new Date().getDay();
    const dow = todayDow === 0 ? 6 : todayDow - 1;
    return h.days_of_week.includes(dow);
  });
  const doneToday = enabledToday.filter((h) =>
    logs.some((l) => l.habit_id === h.id && l.log_date === today && l.status === 'done')
  );

  const nowDue = dueList.filter((d) => d.is_due_now);

  const handleDidIt = async (due: HabitDue) => {
    try {
      await habitsApi.log(due.habit.id, { status: 'done' });
      showToast(`${due.habit.name} tamamlandı!`, 'success');
      await loadAll();
    } catch {
      showToast('Hata', 'error');
    }
  };

  const handleSnooze = async (due: HabitDue, minutes: number) => {
    try {
      await habitsApi.snooze(due.habit.id, minutes);
      showToast(`${due.habit.name} ${minutes} dk ertelendi`, 'info');
      await loadAll();
    } catch {
      showToast('Hata', 'error');
    }
  };

  const handleSkip = async (due: HabitDue) => {
    try {
      await habitsApi.log(due.habit.id, { status: 'skipped' });
      showToast(`${due.habit.name} atlandı`, 'info');
      await loadAll();
    } catch {
      showToast('Hata', 'error');
    }
  };

  return (
    <div className="p-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-7">
        <div>
          <h1 className="text-[32px] font-bold text-text-primary tracking-tight leading-tight">Alışkanlıklar</h1>
          <p className="text-sm text-text-muted mt-1">
            {loading
              ? 'Yükleniyor...'
              : habits.length === 0
              ? 'Henüz alışkanlık yok'
              : `${doneToday.length}/${enabledToday.length} tamamlandı bugün · ${habits.length} toplam`}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-accent-primary text-bg-main hover:bg-accent-primary-hover transition-colors shadow-sm"
        >
          <Plus size={16} />
          Yeni
        </button>
      </div>

      {loading ? (
        <p className="text-text-muted text-sm text-center py-12">Yükleniyor...</p>
      ) : habits.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="Henüz alışkanlık yok"
          description="Düzenli yapmak istediğin küçük rutinleri ekle."
          ctaLabel="Yeni alışkanlık"
          onCta={openCreate}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {/* Due now section */}
          {nowDue.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Şimdi</h2>
              <div className="flex flex-col gap-3">
                {nowDue.map((due) => (
                  <DueHabitCard
                    key={due.habit.id}
                    due={due}
                    onDidIt={() => handleDidIt(due)}
                    onSnooze={(m) => handleSnooze(due, m)}
                    onSkip={() => handleSkip(due)}
                    onReschedule={() => openEdit(due.habit)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Week grid section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Bu Hafta</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setWeekOffset((o) => Math.max(o - 1, -4))}
                  disabled={weekOffset <= -4}
                  className="p-1.5 rounded-lg hover:bg-bg-hover text-text-secondary disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-text-muted min-w-[4rem] text-center">
                  {weekOffset === 0 ? 'Bu hafta' : weekOffset < 0 ? `${-weekOffset} hafta önce` : `${weekOffset} hafta sonra`}
                </span>
                <button
                  onClick={() => setWeekOffset((o) => Math.min(o + 1, 4))}
                  disabled={weekOffset >= 4}
                  className="p-1.5 rounded-lg hover:bg-bg-hover text-text-secondary disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
            <WeekGrid
              habits={habits}
              logs={logs}
              weekOffset={weekOffset}
              onEditHabit={openEdit}
              onDeleteHabit={handleDelete}
            />
          </section>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <HabitModal
          key={`habit-modal-${modalKey}`}
          habit={editTarget}
          onClose={() => setModalOpen(false)}
          onSaved={loadAll}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-full text-sm font-medium border transition-all ${
            toast.type === 'success' ? 'bg-accent-green/15 text-accent-green border-accent-green/30' :
            toast.type === 'error'   ? 'bg-accent-red/15 text-accent-red border-accent-red/30' :
                                       'bg-bg-card text-text-primary border-border'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
