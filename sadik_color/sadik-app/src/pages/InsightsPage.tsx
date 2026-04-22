import React, { useState, useEffect } from 'react';
import { BarChart2, Shield, ChevronDown, ChevronUp } from 'lucide-react';
import { statsApi, AppUsageStat, AppUsageRangeSummary } from '../api/stats';

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
    <div>
      <p className="text-xs text-text-muted mb-3">Günlük toplam kullanım</p>
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

  // Derived stats for subtitle
  const currentApps: AppUsageStat[] =
    period === 'today' ? todayUsage : (rangeSummary?.top_apps ?? []);
  const totalSeconds = currentApps.reduce((s, a) => s + a.duration_seconds, 0);

  return (
    <div className="h-full overflow-y-auto p-6 page-transition">
      <div className="max-w-4xl mx-auto">

        {/* ── Page header ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-accent-green/20 ring-1 ring-accent-green/40 flex items-center justify-center">
            <BarChart2 className="text-accent-green" size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Kullanım</h1>
            <p className="text-xs text-text-muted">
              Hangi uygulamaları ne kadar kullanıyorsun — Sadık bu verilerle sana daha iyi hizmet veriyor.
            </p>
          </div>
        </div>

        {/* ── Unified usage card ─────────────────────────────────────────── */}
        <div className="bg-bg-card border border-border rounded-card shadow-card p-5 mb-5">
          {/* Period tabs + aggregate stats */}
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div className="flex gap-1">
              {PERIOD_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setPeriod(t.key)}
                  className={`text-xs px-3 py-1.5 rounded-btn transition-colors ${
                    period === t.key
                      ? 'bg-accent-green text-white'
                      : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {!loading && !error && currentApps.length > 0 && (
              <div className="flex items-center gap-3 text-[11px] text-text-muted tabular-nums">
                <span>{currentApps.length} uygulama</span>
                <span className="w-px h-3 bg-border" />
                <span>{formatTotalDuration(totalSeconds)} toplam</span>
              </div>
            )}
          </div>

          {/* Card body */}
          {loading ? (
            <div className="py-10 text-center text-xs text-text-muted">Yükleniyor…</div>
          ) : error ? (
            <div className="py-10 text-center text-xs text-text-muted">
              Kullanım verisi şu an yüklenemedi.
            </div>
          ) : period === 'today' ? (
            todayUsage.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-xs text-text-muted">Bugün henüz uygulama kullanım verisi yok.</p>
                <p className="text-[11px] text-text-muted mt-1">
                  Arka plan izleyici aktifken veriler otomatik olarak kaydedilir.
                </p>
              </div>
            ) : (
              <HorizontalBars items={todayUsage} />
            )
          ) : (
            !rangeSummary || rangeSummary.top_apps.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-xs text-text-muted">Bu dönemde kayıtlı kullanım verisi yok.</p>
                <p className="text-[11px] text-text-muted mt-1">
                  Uygulama kullanıldıkça bu bölüm dolmaya başlayacak.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <DailyBarChart dailyTotals={rangeSummary.daily_totals} />
                <div className="border-t border-border" />
                <div>
                  <p className="text-xs text-text-muted mb-3">En çok kullanılan uygulamalar</p>
                  <HorizontalBars items={rangeSummary.top_apps.slice(0, 7)} />
                </div>
              </div>
            )
          )}
        </div>

        {/* ── Privacy / explainability — collapsible ─────────────────────── */}
        <div className="bg-bg-card border border-border rounded-card shadow-card overflow-hidden mb-5">
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
