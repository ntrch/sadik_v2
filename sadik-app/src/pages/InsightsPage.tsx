import React, { useState, useEffect } from 'react';
import { Shield } from 'lucide-react';
import { statsApi, AppUsageStat, AppUsageRangeSummary } from '../api/stats';

// ── Duration formatting ───────────────────────────────────────────────────────
// Kept local — same logic as AppUsageWidget on the dashboard.

function formatAppDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h} sa ${m} dk`;
  if (h > 0) return `${h} sa`;
  if (m > 0) return `${m} dk`;
  return '< 1 dk';
}

/** Return a short Turkish weekday label for a "YYYY-MM-DD" string. */
function shortDayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('tr-TR', { weekday: 'short' });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, badge, children }: {
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-bg-card border border-border rounded-card p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        {badge && (
          <span className="text-[10px] text-text-muted uppercase tracking-wide">{badge}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function HorizontalBars({
  items,
  color = 'bg-accent-purple',
}: {
  items: AppUsageStat[];
  color?: string;
}) {
  const maxSeconds = items[0]?.duration_seconds ?? 1;
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const pct = Math.round((item.duration_seconds / maxSeconds) * 100);
        return (
          <div key={item.app_name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-text-primary truncate max-w-[60%]">
                {item.app_name}
              </span>
              <span className="text-xs text-text-muted ml-2 flex-shrink-0">
                {formatAppDuration(item.duration_seconds)}
              </span>
            </div>
            <div className="h-1.5 bg-bg-input rounded-full overflow-hidden">
              <div
                className={`h-full ${color} rounded-full transition-all duration-500`}
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
          // Minimum visible height for days with any data; zero days stay flat.
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
                className="w-full bg-accent-purple/60 hover:bg-accent-purple rounded-t-sm transition-all duration-500"
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
  const [todayUsage, setTodayUsage] = useState<AppUsageStat[]>([]);
  const [rangeSummary, setRangeSummary] = useState<AppUsageRangeSummary | null>(null);
  const [rangeLoading, setRangeLoading] = useState(true);
  const [rangeError, setRangeError]     = useState(false);

  useEffect(() => {
    // Fetch both in parallel — fail independently so one bad response doesn't
    // block the other section from rendering.
    statsApi.appUsageDaily().then(setTodayUsage).catch(() => {});

    statsApi
      .appUsageRange(7)
      .then((data) => {
        setRangeSummary(data);
        setRangeError(false);
      })
      .catch(() => setRangeError(true))
      .finally(() => setRangeLoading(false));
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6 page-transition">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-text-primary mb-6">Kullanım</h1>

        {/* ── Section A: Today ─────────────────────────────────────────────── */}
        <SectionCard title="Bugünkü Kullanım" badge="Bugün">
          {todayUsage.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xs text-text-muted">Bugün henüz uygulama kullanım verisi yok.</p>
              <p className="text-[11px] text-text-muted mt-1">
                Arka plan izleyici aktifken veriler otomatik olarak kaydedilir.
              </p>
            </div>
          ) : (
            <HorizontalBars items={todayUsage} color="bg-accent-purple" />
          )}
        </SectionCard>

        {/* ── Section B: 7-day range ───────────────────────────────────────── */}
        <SectionCard title="Son 7 Gün" badge="7 gün">
          {rangeLoading ? (
            <p className="text-xs text-text-muted text-center py-6">Yükleniyor…</p>
          ) : rangeError ? (
            <p className="text-xs text-text-muted text-center py-6">
              7 günlük veriler şu an yüklenemedi.
            </p>
          ) : !rangeSummary || rangeSummary.top_apps.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xs text-text-muted">Son 7 günde kayıtlı kullanım verisi yok.</p>
              <p className="text-[11px] text-text-muted mt-1">
                Uygulama kullanıldıkça bu bölüm dolmaya başlayacak.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Daily bar chart */}
              <DailyBarChart dailyTotals={rangeSummary.daily_totals} />

              {/* Divider */}
              <div className="border-t border-border" />

              {/* Top apps over range */}
              <div>
                <p className="text-xs text-text-muted mb-3">En çok kullanılan uygulamalar</p>
                <HorizontalBars
                  items={rangeSummary.top_apps.slice(0, 7)}
                  color="bg-accent-purple"
                />
              </div>
            </div>
          )}
        </SectionCard>

        {/* ── Section C: Privacy / explainability ──────────────────────────── */}
        <div className="bg-bg-card border border-border rounded-card p-5 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={15} className="text-accent-green flex-shrink-0" />
            <h2 className="text-sm font-semibold text-text-primary">
              Sadık Bunu Nasıl Kullanıyor?
            </h2>
          </div>

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
              Sohbet yanıtlarını bağlamsal hale getirmek için günlük kullanım özeti asistan
              sistem mesajına eklenir; bağlamı doğal biçimde ve yalnızca gerektiğinde kullanır.
            </InfoRow>
            <InfoRow color="yellow">
              Sessiz saatler, günlük limit ve öneriler arası bekleme süresi Ayarlar
              sayfasındaki "Proaktif Öneriler" bölümünden ayarlanabilir.
            </InfoRow>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tiny helper used only in Section C ───────────────────────────────────────

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
