import React, { useState, useEffect } from 'react';
import { Shield, ChevronDown, ChevronUp, CheckCircle2, Repeat2, Monitor } from 'lucide-react';
import { statsApi, AppUsageStat, AppUsageRangeSummary, AppUsageEvent } from '../api/stats';
import { tasksApi, Task } from '../api/tasks';
import { habitsApi, Habit, HabitLog } from '../api/habits';

// ── Duration formatting ───────────────────────────────────────────────────────

function formatAppDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h} sa ${m} dk`;
  if (h > 0) return `${h} sa`;
  if (m > 0) return `${m} dk`;
  return '< 1 dk';
}

function formatTotalDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h} sa ${m} dk`;
  if (h > 0) return `${h} sa`;
  if (m > 0) return `${m} dk`;
  return '—';
}

/** Return a short Turkish weekday label for a "YYYY-MM-DD" string. */
function shortDayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('tr-TR', { weekday: 'short' });
}

// ── Period type ───────────────────────────────────────────────────────────────

type Period = 'today' | '7' | '14' | '30';

const PERIOD_TABS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Bugün' },
  { key: '7',     label: '7 Gün' },
  { key: '14',    label: '14 Gün' },
  { key: '30',    label: '30 Gün' },
];

const PERIOD_SUBTITLE: Record<Period, string> = {
  today: 'Bugün',
  '7':   'Son 7 gün',
  '14':  'Son 14 gün',
  '30':  'Son 30 gün',
};

const HERO_SUBLABEL: Record<Period, string> = {
  today: 'bugün toplam ekran süresi',
  '7':   'günlük ortalama',
  '14':  'günlük ortalama',
  '30':  'günlük ortalama',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function HorizontalBars({ items }: { items: AppUsageStat[] }) {
  const maxSeconds = items[0]?.duration_seconds ?? 1;
  return (
    <div className="space-y-3">
      {items.map((item, idx) => {
        const pct = Math.round((item.duration_seconds / maxSeconds) * 100);
        return (
          <div key={item.app_name}>
            <div className="flex items-center justify-between mb-1 gap-2">
              <span className="text-xs text-text-muted tabular-nums flex-shrink-0 w-5">
                #{idx + 1}
              </span>
              <span className="text-xs font-medium text-text-primary truncate flex-1">
                {item.app_name}
              </span>
              <span className="text-xs text-text-muted tabular-nums flex-shrink-0">
                {formatAppDuration(item.duration_seconds)}
              </span>
            </div>
            <div className="h-1.5 bg-bg-input rounded-full overflow-hidden ml-7">
              <div
                className="h-full bg-accent-green rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DailyBarChart({ dailyTotals }: {
  dailyTotals: AppUsageRangeSummary['daily_totals'];
}) {
  const maxSeconds = Math.max(...dailyTotals.map((d) => d.duration_seconds), 1);

  return (
    <div className="flex items-end gap-1 h-20">
      {dailyTotals.map((d) => {
        const rawPct = d.duration_seconds > 0
          ? Math.max(Math.round((d.duration_seconds / maxSeconds) * 100), 5)
          : 0;
        return (
          <div
            key={d.date}
            className="flex flex-col items-center flex-1 h-full justify-end"
            title={`${d.date}: ${d.duration_seconds > 0 ? formatAppDuration(d.duration_seconds) : 'Veri yok'}`}
          >
            <div
              className="w-full bg-accent-green/60 hover:bg-accent-green rounded-t-sm transition-all duration-500"
              style={{ height: `${rawPct}%` }}
            />
            <span className="text-[9px] text-text-muted mt-1.5 leading-none select-none">
              {shortDayLabel(d.date)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Small-caps section heading — dream grammar */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-wide text-text-muted mb-2">
      {children}
    </p>
  );
}

// ── Timeline types & helpers ──────────────────────────────────────────────────

type TimelineEventType = 'task_completed' | 'habit_logged' | 'app_used';

interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  time: Date;
  label: string;
  sublabel?: string;
  duration?: string;
}

function formatTimeHHMM(d: Date): string {
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isToday(isoStr: string): boolean {
  if (!isoStr) return false;
  return isoStr.startsWith(todayISO());
}

const DOT_CLASS: Record<TimelineEventType, string> = {
  task_completed: 'bg-accent-green',
  habit_logged:   'bg-accent-purple',
  app_used:       'bg-blue-400',
};

function TimelineIcon({ type }: { type: TimelineEventType }) {
  const cls = 'text-text-muted';
  if (type === 'task_completed') return <CheckCircle2 size={14} className={cls} />;
  if (type === 'habit_logged')   return <Repeat2      size={14} className={cls} />;
  return <Monitor size={14} className={cls} />;
}

function ActivityTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-xs text-text-muted text-center py-4">
        Bugün henüz aktivite yok
      </p>
    );
  }
  return (
    <div className="relative pl-6">
      <div className="absolute left-1.5 top-2 bottom-2 w-px bg-border" />
      {events.map((ev) => (
        <div key={ev.id} className="relative pb-4 last:pb-0">
          <div
            className={`absolute -left-[18px] top-1.5 w-2 h-2 rounded-full ${DOT_CLASS[ev.type]}`}
          />
          <p className="text-[11px] text-text-muted mb-1">{formatTimeHHMM(ev.time)}</p>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-bg-input flex items-center justify-center flex-shrink-0">
              <TimelineIcon type={ev.type} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{ev.label}</p>
              {ev.sublabel && (
                <p className="text-[11px] text-text-muted">{ev.sublabel}</p>
              )}
            </div>
            {ev.duration && (
              <span className="text-xs text-text-muted tabular-nums flex-shrink-0">{ev.duration}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const [period, setPeriod] = useState<Period>('today');
  const [todayUsage, setTodayUsage] = useState<AppUsageStat[]>([]);
  const [rangeSummary, setRangeSummary] = useState<AppUsageRangeSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  // Timeline state (today only)
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    setLoading(true);
    setError(false);
    setRangeSummary(null);
    setTodayUsage([]);

    if (period === 'today') {
      statsApi
        .appUsageDaily()
        .then(setTodayUsage)
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    } else {
      const days = parseInt(period) as 7 | 14 | 30;
      statsApi
        .appUsageRange(days)
        .then((data) => { setRangeSummary(data); setError(false); })
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    }
  }, [period]);

  // Fetch timeline data when period=today
  useEffect(() => {
    if (period !== 'today') {
      setTimelineEvents([]);
      return;
    }
    const today = todayISO();

    Promise.allSettled([
      tasksApi.list('done'),
      habitsApi.getLogs(today, today),
      habitsApi.list(),
      statsApi.appUsageEvents(today),
    ]).then(([tasksResult, logsResult, habitsListResult, appEventsResult]) => {
      const events: TimelineEvent[] = [];

      // Task completed events — use updated_at as proxy for completion time
      if (tasksResult.status === 'fulfilled') {
        const doneTasks: Task[] = tasksResult.value.filter(
          (t) => t.status === 'done' && isToday(t.updated_at)
        );
        doneTasks.forEach((t) => {
          events.push({
            id: `task-${t.id}`,
            type: 'task_completed',
            time: new Date(t.updated_at),
            label: t.title,
            sublabel: 'Görev tamamlandı',
          });
        });
      }

      // Habit logged events — use completed_at from log
      if (logsResult.status === 'fulfilled' && habitsListResult.status === 'fulfilled') {
        const habitMap = new Map<number, Habit>(
          habitsListResult.value.map((h) => [h.id, h])
        );
        const doneLogs: HabitLog[] = logsResult.value.filter((l) => l.status === 'done');
        doneLogs.forEach((log) => {
          const habit = habitMap.get(log.habit_id);
          const timeStr = log.completed_at ?? `${log.log_date}T00:00:00`;
          events.push({
            id: `habit-${log.id}`,
            type: 'habit_logged',
            time: new Date(timeStr),
            label: habit?.name ?? 'Alışkanlık',
            sublabel: 'Alışkanlık tamamlandı',
          });
        });
      }

      // App usage events — each raw session as a separate timeline entry
      if (appEventsResult.status === 'fulfilled') {
        appEventsResult.value.forEach((ev: AppUsageEvent, idx: number) => {
          const mins = Math.round(ev.duration_seconds / 60);
          const durStr = mins >= 60
            ? `${Math.floor(mins / 60)} sa ${mins % 60 > 0 ? `${mins % 60} dk` : ''}`.trim()
            : mins > 0 ? `${mins} dk` : '< 1 dk';
          events.push({
            id: `app-${idx}-${ev.start_time}`,
            type: 'app_used',
            time: new Date(ev.start_time),
            label: ev.app_name,
            sublabel: '—',
            duration: durStr,
          });
        });
      }

      // Sort ASC (morning first)
      events.sort((a, b) => a.time.getTime() - b.time.getTime());

      setTimelineEvents(events.slice(0, 30));
    });
  }, [period]);

  // Derived stats
  const currentApps: AppUsageStat[] =
    period === 'today' ? todayUsage : (rangeSummary?.top_apps ?? []);
  const totalSeconds = currentApps.reduce((s, a) => s + a.duration_seconds, 0);

  // For range: avg = totalSeconds / days
  const heroSeconds =
    period === 'today'
      ? totalSeconds
      : (() => {
          const days = parseInt(period);
          const dayTotals = rangeSummary?.daily_totals ?? [];
          const activeDays = dayTotals.filter((d) => d.duration_seconds > 0).length;
          if (activeDays === 0) return 0;
          const sum = dayTotals.reduce((s, d) => s + d.duration_seconds, 0);
          return Math.round(sum / activeDays);
        })();

  const hasData = !loading && !error && currentApps.length > 0;

  return (
    <div className="h-full overflow-y-auto p-6 page-transition">
      <div className="max-w-4xl mx-auto">

        {/* ── Page header ────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary leading-tight">Kullanım</h1>
            <p className="text-xs text-text-muted mt-0.5">{PERIOD_SUBTITLE[period]}</p>
          </div>
          {/* Segmented period pill */}
          <div className="flex items-center gap-1 bg-bg-card border border-border rounded-btn px-1 py-1">
            {PERIOD_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setPeriod(t.key)}
                className={`text-xs px-3 py-1 rounded-btn transition-colors ${
                  period === t.key
                    ? 'bg-accent-green text-white'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Hero metric flat card ──────────────────────────────────────── */}
        <div className="bg-bg-card border border-border rounded-card p-4 mb-4 flex items-center gap-4">
          {/* Accent şerit */}
          <div className="w-1 h-7 rounded bg-accent-green flex-shrink-0" />
          {/* Metric */}
          <div className="flex-1 min-w-0">
            {loading ? (
              <p className="text-xs text-text-muted">Yükleniyor…</p>
            ) : error ? (
              <>
                <p className="text-4xl font-bold tabular-nums text-text-primary leading-none">—</p>
                <p className="text-xs text-text-muted mt-1">Veri yüklenemedi</p>
              </>
            ) : hasData ? (
              <>
                <p className="text-4xl font-bold tabular-nums text-text-primary leading-none">
                  {formatTotalDuration(heroSeconds)}
                </p>
                <p className="text-xs text-text-muted mt-1">{HERO_SUBLABEL[period]}</p>
              </>
            ) : (
              <>
                <p className="text-4xl font-bold tabular-nums text-text-primary leading-none">—</p>
                <p className="text-xs text-text-muted mt-1">Henüz veri yok</p>
              </>
            )}
          </div>
          {/* App count pill */}
          {hasData && (
            <span className="flex-shrink-0 text-xs font-medium tabular-nums px-2.5 py-1 rounded-btn bg-accent-green/15 text-accent-green">
              {currentApps.length} uygulama
            </span>
          )}
        </div>

        {/* ── Body sections ─────────────────────────────────────────────── */}
        {loading ? (
          <div className="bg-bg-card border border-border rounded-card p-5">
            <div className="py-8 text-center text-xs text-text-muted">Yükleniyor…</div>
          </div>
        ) : error ? (
          <div className="bg-bg-card border border-border rounded-card p-5">
            <div className="py-8 text-center text-xs text-text-muted">
              Kullanım verisi şu an yüklenemedi.
            </div>
          </div>
        ) : period === 'today' ? (
          <div className="space-y-4">
            {/* Today activity timeline */}
            <div>
              <SectionHeading>Bugün aktivite</SectionHeading>
              <div className="bg-bg-card border border-border rounded-card p-4">
                <ActivityTimeline events={timelineEvents} />
              </div>
            </div>

            {/* Top apps */}
            {todayUsage.length === 0 ? (
              <div className="bg-bg-card border border-border rounded-card p-5">
                <div className="py-8 text-center">
                  <p className="text-xs text-text-muted">Bugün henüz uygulama kullanım verisi yok.</p>
                  <p className="text-[11px] text-text-muted mt-1">
                    Arka plan izleyici aktifken veriler otomatik olarak kaydedilir.
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <SectionHeading>En çok kullanılan</SectionHeading>
                <div className="bg-bg-card border border-border rounded-card p-4">
                  <HorizontalBars items={todayUsage} />
                </div>
              </div>
            )}
          </div>
        ) : (
          !rangeSummary || rangeSummary.top_apps.length === 0 ? (
            <div className="bg-bg-card border border-border rounded-card p-5">
              <div className="py-8 text-center">
                <p className="text-xs text-text-muted">Bu dönemde kayıtlı kullanım verisi yok.</p>
                <p className="text-[11px] text-text-muted mt-1">
                  Uygulama kullanıldıkça bu bölüm dolmaya başlayacak.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Daily totals */}
              <div>
                <SectionHeading>Günlük toplam</SectionHeading>
                <div className="bg-bg-card border border-border rounded-card p-4">
                  <DailyBarChart dailyTotals={rangeSummary.daily_totals} />
                </div>
              </div>
              {/* Top apps */}
              <div>
                <SectionHeading>En çok kullanılan</SectionHeading>
                <div className="bg-bg-card border border-border rounded-card p-4">
                  <HorizontalBars items={rangeSummary.top_apps.slice(0, 7)} />
                </div>
              </div>
            </div>
          )
        )}

        {/* ── Privacy / explainability — collapsible ─────────────────────── */}
        <div className="bg-bg-card border border-border rounded-card overflow-hidden mt-4 mb-5">
          <button
            onClick={() => setPrivacyOpen((o) => !o)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-text-primary hover:bg-bg-hover transition-colors"
          >
            <span className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-accent-green/20 ring-1 ring-accent-green/40 flex items-center justify-center">
                <Shield size={14} className="text-accent-green" />
              </span>
              Sadık Bu Bilgileri Nasıl Kullanıyor?
            </span>
            {privacyOpen
              ? <ChevronUp size={14} className="text-text-muted" />
              : <ChevronDown size={14} className="text-text-muted" />}
          </button>
          {privacyOpen && (
            <div className="px-5 pb-5 pt-1 border-t border-border">
              <div className="space-y-3 text-xs text-text-secondary leading-relaxed">
                <InfoRow color="green">
                  Tüm kullanım verileri yalnızca bu cihazda yerel olarak saklanır.
                </InfoRow>
                <InfoRow color="green">
                  Hiçbir veri harici sunuculara veya üçüncü taraf servislere gönderilmez.
                </InfoRow>
                <InfoRow color="blue">
                  Aynı uygulamada 60 dakikadan fazla çalışıldığında nazik, 120 dakikayı aşınca
                  daha güçlü bir mola önerisi gösterilir.
                </InfoRow>
                <InfoRow color="blue">
                  Sadık daha doğru yanıtlar verebilmek için günlük kullanım özetini
                  göz önünde bulundurur; bu bilgiyi yalnızca gerektiğinde ve doğal biçimde kullanır.
                </InfoRow>
                <InfoRow color="yellow">
                  Sessiz saatler, günlük limit ve öneriler arası bekleme süresi Ayarlar
                  sayfasındaki "Proaktif Öneriler" bölümünden ayarlanabilir.
                </InfoRow>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Tiny helper ───────────────────────────────────────────────────────────────

const DOT_COLORS: Record<string, string> = {
  green:  'bg-accent-green',
  blue:   'bg-accent-purple',
  yellow: 'bg-accent-yellow',
};

function InfoRow({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${DOT_COLORS[color] ?? 'bg-text-muted'}`} />
      <p>{children}</p>
    </div>
  );
}
