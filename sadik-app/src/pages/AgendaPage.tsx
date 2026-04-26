import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ListTodo, Repeat, CalendarDays, Plus, X, Trash2 } from 'lucide-react';
import EmptyState from '../components/common/EmptyState';
import gcalLogo from '../assets/brand/icons8-google-calendar.svg';
import { tasksApi, Task } from '../api/tasks';
import { habitsApi, Habit } from '../api/habits';
import { eventsApi, CalendarEvent, EventColor } from '../api/events';
import http from '../api/http';

type ViewMode = 'month' | 'week';
type EventKind = 'task' | 'habit' | 'event' | 'external';

interface UnifiedEvent {
  source: string; // 'native' | 'google_calendar' | ...
  id: number;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  color: string;
  html_link: string | null;
  meeting_url: string | null;
  location: string | null;
  organizer: string | null;
  attendees: string | null;
  status: string | null;
  source_id: string | null;
  description: string | null;
}

interface AgendaItem {
  id: string;
  title: string;
  kind: EventKind;
  date: Date;
  hasTime: boolean;
  colorKey: string; // status for task, 'habit' for habit, color for event
  ref: Task | Habit | CalendarEvent | UnifiedEvent;
  htmlLink?: string | null;
  meetingUrl?: string | null;
  externalSource?: string;
}

const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const TR_DAYS_SHORT = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];

// Match TaskColumn's STATUS_STYLES — keeps visual parity with the Tasks board.
const TASK_STATUS_COLORS: Record<string, { pill: string; dot: string; hover: string; text: string }> = {
  todo:        { pill: 'bg-[#6b6b73]/15 text-[#c4c4cc]', dot: 'bg-[#6b6b73]', hover: 'hover:bg-[#6b6b73]/25', text: 'text-[#c4c4cc]' },
  in_progress: { pill: 'bg-[#fb923c]/15 text-[#fb923c]', dot: 'bg-[#fb923c]', hover: 'hover:bg-[#fb923c]/25', text: 'text-[#fb923c]' },
  done:        { pill: 'bg-[#6ee7b7]/15 text-[#6ee7b7]', dot: 'bg-[#6ee7b7]', hover: 'hover:bg-[#6ee7b7]/25', text: 'text-[#6ee7b7]' },
  cancelled:   { pill: 'bg-[#fca5a5]/15 text-[#fca5a5]', dot: 'bg-[#fca5a5]', hover: 'hover:bg-[#fca5a5]/25', text: 'text-[#fca5a5]' },
  planned:     { pill: 'bg-[#a78bfa]/15 text-[#a78bfa]', dot: 'bg-[#a78bfa]', hover: 'hover:bg-[#a78bfa]/25', text: 'text-[#a78bfa]' },
  archived:    { pill: 'bg-[#fdba74]/15 text-[#fdba74]', dot: 'bg-[#fdba74]', hover: 'hover:bg-[#fdba74]/25', text: 'text-[#fdba74]' },
};

const EVENT_COLOR_MAP: Record<EventColor, { pill: string; dot: string; hover: string; text: string; ring: string }> = {
  purple: { pill: 'bg-accent-purple/15 text-accent-purple', dot: 'bg-accent-purple', hover: 'hover:bg-accent-purple/25', text: 'text-accent-purple', ring: 'ring-accent-purple' },
  cyan:   { pill: 'bg-accent-cyan/15 text-accent-cyan',     dot: 'bg-accent-cyan',   hover: 'hover:bg-accent-cyan/25',   text: 'text-accent-cyan',   ring: 'ring-accent-cyan' },
  orange: { pill: 'bg-accent-orange/15 text-accent-orange', dot: 'bg-accent-orange', hover: 'hover:bg-accent-orange/25', text: 'text-accent-orange', ring: 'ring-accent-orange' },
  yellow: { pill: 'bg-accent-yellow/15 text-accent-yellow', dot: 'bg-accent-yellow', hover: 'hover:bg-accent-yellow/25', text: 'text-accent-yellow', ring: 'ring-accent-yellow' },
  red:    { pill: 'bg-accent-red/15 text-accent-red',       dot: 'bg-accent-red',    hover: 'hover:bg-accent-red/25',    text: 'text-accent-red',    ring: 'ring-accent-red' },
  green:  { pill: 'bg-accent-green/15 text-accent-green',   dot: 'bg-accent-green',  hover: 'hover:bg-accent-green/25',  text: 'text-accent-green',  ring: 'ring-accent-green' },
  pink:   { pill: 'bg-accent-pink/15 text-accent-pink',     dot: 'bg-accent-pink',   hover: 'hover:bg-accent-pink/25',   text: 'text-accent-pink',   ring: 'ring-accent-pink' },
};

// Habit canonical color — matches the HabitsPage/BottomNav accent.
const HABIT_COLOR = EVENT_COLOR_MAP.orange;

// External (Google Calendar) event color
const EXTERNAL_COLOR = EVENT_COLOR_MAP.cyan;

function colorsFor(item: AgendaItem) {
  if (item.kind === 'task') return TASK_STATUS_COLORS[item.colorKey] || TASK_STATUS_COLORS.todo;
  if (item.kind === 'habit') return HABIT_COLOR;
  if (item.kind === 'external') return EXTERNAL_COLOR;
  return EVENT_COLOR_MAP[(item.colorKey as EventColor)] || EVENT_COLOR_MAP.purple;
}

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dayKey(d: Date) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AgendaPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState<Date>(new Date());

  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [externalEvents, setExternalEvents] = useState<UnifiedEvent[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  const loadAll = () => {
    tasksApi.list().then(setTasks).catch(() => {});
    habitsApi.list().then(setHabits).catch(() => {});
    eventsApi.list().then(setEvents).catch(() => {});
    // Load external events from unified endpoint (non-native sources only)
    http.get<UnifiedEvent[]>('/api/events/unified')
      .then((r) => setExternalEvents(r.data.filter((e) => e.source !== 'native')))
      .catch(() => {});
  };
  useEffect(() => { loadAll(); }, []);

  const { gridStart, weekCount, title } = useMemo(() => {
    if (view === 'month') {
      const first = startOfMonth(cursor);
      return {
        gridStart: startOfWeek(first),
        weekCount: 6,
        title: `${TR_MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`,
      };
    }
    const gs = startOfWeek(cursor);
    const end = addDays(gs, 6);
    const same = gs.getMonth() === end.getMonth();
    const title = same
      ? `${gs.getDate()}–${end.getDate()} ${TR_MONTHS[gs.getMonth()]} ${gs.getFullYear()}`
      : `${gs.getDate()} ${TR_MONTHS[gs.getMonth()]} – ${end.getDate()} ${TR_MONTHS[end.getMonth()]} ${gs.getFullYear()}`;
    return { gridStart: gs, weekCount: 1, title };
  }, [view, cursor]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    const windowStart = gridStart;
    const windowEnd = addDays(gridStart, weekCount * 7 - 1);
    const endInclusive = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), windowEnd.getDate(), 23, 59, 59);
    const startMidnight = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate());

    for (const t of tasks) {
      if (!t.due_date) continue;
      if (t.status === 'done' || t.status === 'archived') continue;
      const d = new Date(t.due_date);
      if (Number.isNaN(d.getTime())) continue;
      if (d < startMidnight || d > endInclusive) continue;
      const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
      const item: AgendaItem = { id: `t-${t.id}`, title: t.title, kind: 'task', date: d, hasTime, colorKey: t.status, ref: t };
      const k = dayKey(d); const arr = map.get(k) || []; arr.push(item); map.set(k, arr);
    }

    for (let i = 0; i < weekCount * 7; i++) {
      const day = addDays(windowStart, i);
      const dow = (day.getDay() + 6) % 7;
      for (const h of habits) {
        if (!h.enabled) continue;
        if (!h.days_of_week.includes(dow)) continue;
        const [hh, mm] = (h.time || '00:00').split(':').map(Number);
        const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh || 0, mm || 0);
        const k = dayKey(d);
        const item: AgendaItem = { id: `h-${h.id}-${k}`, title: h.name, kind: 'habit', date: d, hasTime: true, colorKey: 'habit', ref: h };
        const arr = map.get(k) || []; arr.push(item); map.set(k, arr);
      }
    }

    for (const e of events) {
      const d = new Date(e.starts_at);
      if (Number.isNaN(d.getTime())) continue;
      if (d < startMidnight || d > endInclusive) continue;
      const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
      const item: AgendaItem = { id: `e-${e.id}`, title: e.title, kind: 'event', date: d, hasTime, colorKey: e.color, ref: e };
      const k = dayKey(d); const arr = map.get(k) || []; arr.push(item); map.set(k, arr);
    }

    for (const e of externalEvents) {
      if (!e.starts_at) continue;
      const d = new Date(e.starts_at);
      if (Number.isNaN(d.getTime())) continue;
      if (d < startMidnight || d > endInclusive) continue;
      const hasTime = !e.all_day && (d.getHours() !== 0 || d.getMinutes() !== 0);
      const item: AgendaItem = {
        id: `ext-${e.source}-${e.id}`,
        title: e.title,
        kind: 'external',
        date: d,
        hasTime,
        colorKey: 'cyan',
        ref: e,
        htmlLink: e.html_link,
        meetingUrl: e.meeting_url,
        externalSource: e.source,
      };
      const k = dayKey(d); const arr = map.get(k) || []; arr.push(item); map.set(k, arr);
    }

    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.hasTime !== b.hasTime) return a.hasTime ? 1 : -1;
        return a.date.getTime() - b.date.getTime();
      });
    }
    return map;
  }, [tasks, habits, events, externalEvents, gridStart, weekCount]);

  const today = new Date();
  const goPrev = () => setCursor(view === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1) : addDays(cursor, -7));
  const goNext = () => setCursor(view === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) : addDays(cursor, 7));
  const goToday = () => { setCursor(new Date()); setSelected(new Date()); };

  const days: Date[] = [];
  for (let i = 0; i < weekCount * 7; i++) days.push(addDays(gridStart, i));

  const selectedItems = itemsByDay.get(dayKey(selected)) || [];

  const openItem = (item: AgendaItem) => {
    if (item.kind === 'task') navigate('/tasks');
    else if (item.kind === 'habit') navigate('/habits');
    else if (item.kind === 'external') {
      const url = item.meetingUrl || item.htmlLink;
      if (url) {
        if ((window as any).electronAPI?.shellOpenExternal) {
          (window as any).electronAPI.shellOpenExternal(url);
        } else {
          window.open(url, '_blank');
        }
      }
    }
    else { setEditingEvent(item.ref as CalendarEvent); setShowCreate(true); }
  };

  return (
    <div className="px-6 py-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <CalendarDays size={22} className="text-accent-purple" />
          <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setEditingEvent(null); setShowCreate(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-btn bg-accent-purple/20 text-accent-purple border border-accent-purple/30 hover:bg-accent-purple/30 transition-colors"
          >
            <Plus size={14} /> Yeni Etkinlik
          </button>
          <button onClick={goToday} className="px-3 py-1.5 text-sm rounded-btn bg-bg-card border border-border text-text-primary hover:bg-bg-hover transition-colors">Bugün</button>
          <div className="flex items-center bg-bg-card border border-border rounded-btn overflow-hidden">
            <button onClick={goPrev} className="p-2 text-text-secondary hover:text-text-primary hover:bg-bg-hover"><ChevronLeft size={16} /></button>
            <div className="w-px h-5 bg-border" />
            <button onClick={goNext} className="p-2 text-text-secondary hover:text-text-primary hover:bg-bg-hover"><ChevronRight size={16} /></button>
          </div>
          <div className="flex items-center bg-bg-card border border-border rounded-btn overflow-hidden">
            {(['month','week'] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  view === v ? 'bg-accent-purple/20 text-accent-purple' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }`}
              >
                {v === 'month' ? 'Ay' : 'Hafta'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col glass border border-border rounded-card overflow-hidden">
          <div className="grid grid-cols-7 bg-bg-card/50 border-b border-border">
            {TR_DAYS_SHORT.map((d) => (
              <div key={d} className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted text-center">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 flex-1 min-h-0" style={{ gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))` }}>
            {days.map((d, i) => {
              const isToday = sameDay(d, today);
              const isSelected = sameDay(d, selected);
              const isCurMonth = view === 'week' || d.getMonth() === cursor.getMonth();
              const dayItems = itemsByDay.get(dayKey(d)) || [];
              const shown = view === 'month' ? 3 : 12;
              return (
                <button
                  key={i}
                  onClick={() => setSelected(d)}
                  className={`flex flex-col items-stretch text-left p-1.5 border-r border-b border-border/60 transition-colors min-h-0 overflow-hidden ${
                    isSelected ? 'bg-accent-purple/10' : 'hover:bg-bg-hover/40'
                  } ${!isCurMonth ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-center justify-between mb-1 flex-shrink-0">
                    <span
                      className={`text-xs font-semibold tabular-nums w-6 h-6 flex items-center justify-center rounded-full ${
                        isToday ? 'bg-accent-red text-white' : isSelected ? 'text-accent-purple' : 'text-text-primary'
                      }`}
                    >
                      {d.getDate()}
                    </span>
                    {dayItems.length > shown && (
                      <span className="text-[9px] text-text-muted">+{dayItems.length - shown}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {dayItems.slice(0, shown).map((ev) => {
                      const c = colorsFor(ev);
                      return (
                        <div
                          key={ev.id}
                          onClick={(e) => { e.stopPropagation(); openItem(ev); }}
                          className={`flex items-center gap-1 text-[10px] px-1 py-0.5 rounded truncate ${c.pill} ${c.hover}`}
                          title={ev.title}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
                          {ev.hasTime && (
                            <span className="tabular-nums opacity-80">
                              {String(ev.date.getHours()).padStart(2,'0')}:{String(ev.date.getMinutes()).padStart(2,'0')}
                            </span>
                          )}
                          <span className="truncate">{ev.title}</span>
                          {ev.kind === 'external' && ev.externalSource === 'google_calendar' && (
                            <img src={gcalLogo} alt="GCal" className="flex-shrink-0 w-2.5 h-2.5 opacity-80" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="w-80 flex-shrink-0 glass border border-border rounded-card flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              {TR_DAYS_SHORT[(selected.getDay() + 6) % 7]}
            </div>
            <div className="text-xl font-bold text-text-primary">
              {selected.getDate()} {TR_MONTHS[selected.getMonth()]}
            </div>
            <div className="text-xs text-text-secondary">{selectedItems.length} öğe</div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {selectedItems.length === 0 && (
              <div className="py-4">
                <EmptyState
                  icon={CalendarDays}
                  title="Bugün ajandanda etkinlik yok"
                  description="Google Takvim bağlıysa otomatik senkronize edilir."
                  voiceHint="Sadık, bu hafta neler var?"
                />
              </div>
            )}
            {selectedItems.map((ev) => {
              const c = colorsFor(ev);
              const IconEl = ev.kind === 'task' ? ListTodo : ev.kind === 'habit' ? Repeat : CalendarDays;
              const isExternal = ev.kind === 'external';
              return (
                <button
                  key={ev.id}
                  onClick={() => openItem(ev)}
                  className="w-full text-left flex items-start gap-2 p-3 rounded-btn bg-bg-card/60 border border-border hover:bg-bg-hover transition-colors"
                >
                  <div className={`mt-0.5 flex-shrink-0 p-1.5 rounded-md ${c.pill}`}>
                    <IconEl size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className="text-sm font-medium text-text-primary truncate">{ev.title}</div>
                      {isExternal && ev.externalSource === 'google_calendar' && (
                        <img
                          src={gcalLogo}
                          alt="Google Calendar"
                          title="Google Takvim'den eşitlendi"
                          className="flex-shrink-0 w-3.5 h-3.5 opacity-80"
                        />
                      )}
                    </div>
                    <div className="text-[11px] text-text-muted">
                      {ev.kind === 'task' ? `Görev • ${ev.colorKey.replace('_',' ')}` : ev.kind === 'habit' ? 'Alışkanlık' : isExternal ? 'Google Takvim' : 'Etkinlik'}
                      {ev.hasTime && ` • ${String(ev.date.getHours()).padStart(2,'0')}:${String(ev.date.getMinutes()).padStart(2,'0')}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      {showCreate && (
        <EventEditor
          initial={editingEvent}
          defaultDate={selected}
          onClose={() => { setShowCreate(false); setEditingEvent(null); }}
          onSaved={() => { setShowCreate(false); setEditingEvent(null); loadAll(); }}
        />
      )}
    </div>
  );
}

interface EventEditorProps {
  initial: CalendarEvent | null;
  defaultDate: Date;
  onClose: () => void;
  onSaved: () => void;
}

function EventEditor({ initial, defaultDate, onClose, onSaved }: EventEditorProps) {
  const isEdit = !!initial;
  const initStart = initial ? new Date(initial.starts_at) : new Date(defaultDate.getFullYear(), defaultDate.getMonth(), defaultDate.getDate(), 9, 0);
  const initEnd = initial?.ends_at ? new Date(initial.ends_at) : null;

  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [guests, setGuests] = useState(initial?.guests || '');
  const [color, setColor] = useState<EventColor>(initial?.color || 'purple');
  const [starts, setStarts] = useState(toLocalInput(initStart));
  const [ends, setEnds] = useState(initEnd ? toLocalInput(initEnd) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) { setError('Başlık gerekli'); return; }
    if (!starts) { setError('Başlangıç tarihi gerekli'); return; }
    setSaving(true); setError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        guests: guests.trim() || null,
        color,
        starts_at: new Date(starts).toISOString(),
        ends_at: ends ? new Date(ends).toISOString() : null,
      };
      if (isEdit && initial) await eventsApi.update(initial.id, payload);
      else await eventsApi.create(payload);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Kaydedilemedi');
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!initial) return;
    if (!confirm('Etkinliği sil?')) return;
    setSaving(true);
    try { await eventsApi.remove(initial.id); onSaved(); }
    catch { setSaving(false); }
  };

  const colorOpts: EventColor[] = ['purple','cyan','orange','yellow','red','green','pink'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-heavy border border-border rounded-card shadow-card w-[480px] max-w-[92vw] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">{isEdit ? 'Etkinliği Düzenle' : 'Yeni Etkinlik'}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Başlık</label>
            <input
              autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Etkinlik adı"
              className="input-field w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Başlangıç</label>
              <input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} className="input-field w-full" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Bitiş (opsiyonel)</label>
              <input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} className="input-field w-full" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Katılımcılar</label>
            <input
              value={guests} onChange={(e) => setGuests(e.target.value)}
              placeholder="Ahmet, Ayşe, mehmet@..."
              className="input-field w-full"
            />
            <p className="text-[11px] text-text-muted mt-1">Virgülle ayırın</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Açıklama</label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Notlar…"
              rows={3}
              className="input-field w-full resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Renk</label>
            <div className="flex items-center gap-2 flex-wrap">
              {colorOpts.map((c) => {
                const cm = EVENT_COLOR_MAP[c];
                const sel = color === c;
                return (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    title={c}
                    className={`w-7 h-7 rounded-full ${cm.dot} transition-all ${
                      sel ? `ring-2 ring-offset-2 ring-offset-bg-main ${cm.ring} scale-110` : 'hover:scale-105 opacity-80'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          {error && <p className="text-sm text-accent-red">{error}</p>}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-bg-card/30">
          {isEdit ? (
            <button onClick={remove} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-btn text-accent-red hover:bg-accent-red/10 transition-colors">
              <Trash2 size={14} /> Sil
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-btn text-text-secondary hover:bg-bg-hover transition-colors">Vazgeç</button>
            <button
              onClick={submit}
              disabled={saving || !title.trim()}
              className="px-4 py-2 text-sm rounded-btn bg-accent-purple text-white hover:bg-accent-purple-hover disabled:opacity-50 transition-colors"
            >
              {saving ? 'Kaydediliyor…' : (isEdit ? 'Kaydet' : 'Oluştur')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
