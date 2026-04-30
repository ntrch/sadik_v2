import React, { useState, useEffect } from 'react';
import { BarChart3, Clock, Activity, DollarSign, Mic, Cpu, Volume2 } from 'lucide-react';
import { usageApi, UsageStats } from '../../api/usage';

const TOOL_LABELS: Record<string, string> = {
  list_tasks:            'Görev listele',
  delete_task:           'Görev sil',
  list_habits:           'Alışkanlıklar',
  get_today_agenda:      'Günlük ajanda',
  get_app_usage_summary: 'Kullanım özeti',
  start_pomodoro:        'Pomodoro başlat',
  switch_mode:           'Mod değiştir',
  search_memory:         'Hafıza ara',
  cancel_break:          'Mola iptal',
  list_workspaces:       'Çalışma alanları',
  start_workspace:       'Çalışma alanı başlat',
  get_current_mode:      'Aktif mod',
};

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-bg-input rounded ${className}`} />;
}

function StatBox({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-bg-input border border-border rounded-btn px-3 py-2.5">
      <p className="text-[10px] text-text-muted uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-base font-bold text-text-primary leading-none">{value}</p>
      {sub && <p className="text-[10px] text-text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function LatencyRow({ label, icon: Icon, ms, color }: { label: string; icon: React.FC<any>; ms: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={13} className={color} />
      <span className="text-xs text-text-secondary flex-1">{label}</span>
      <span className="text-xs font-semibold text-text-primary">{ms > 0 ? `${ms} ms` : '—'}</span>
    </div>
  );
}

export default function UsageStatsCard() {
  const [days, setDays] = useState<7 | 30>(30);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    usageApi.getMine(days)
      .then((data) => { setStats(data); setLoading(false); })
      .catch(() => { setError('Veri alınamadı'); setLoading(false); });
  }, [days]);

  return (
    <div className="space-y-4">
      {/* Day selector */}
      <div className="flex gap-2">
        {([7, 30] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1 rounded-btn text-xs font-medium transition-colors
              ${days === d
                ? 'bg-accent-purple text-white'
                : 'bg-bg-input border border-border text-text-secondary hover:border-accent-purple/40'}`}
          >
            Son {d} gün
          </button>
        ))}
      </div>

      {error && (
        <p className="text-xs text-accent-red">{error}</p>
      )}

      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
          </div>
          <Skeleton className="h-20" />
          <Skeleton className="h-16" />
        </div>
      ) : stats ? (
        <>
          {/* Turn overview */}
          <div className="grid grid-cols-2 gap-2">
            <StatBox label="Toplam konuşma" value={stats.total_turns} />
            <StatBox label="Günlük ortalama" value={stats.avg_turns_per_day} sub="konuşma/gün" />
            <StatBox
              label="Toplam ses süresi"
              value={stats.total_audio_seconds > 0 ? `${Math.round(stats.total_audio_seconds)} sn` : '—'}
            />
            <StatBox
              label="Ort. ses süresi"
              value={stats.avg_audio_seconds_per_turn > 0 ? `${stats.avg_audio_seconds_per_turn} sn` : '—'}
              sub="konuşma başına"
            />
          </div>

          {/* Latency */}
          <div className="bg-bg-input border border-border rounded-btn p-3 space-y-2">
            <div className="flex items-center gap-1.5 mb-2">
              <Clock size={13} className="text-accent-purple" />
              <p className="text-xs font-semibold text-text-secondary">Gecikme (ortalama)</p>
            </div>
            <LatencyRow label="STT (Whisper)" icon={Mic} ms={stats.avg_stt_ms} color="text-accent-cyan" />
            <LatencyRow label="LLM (ilk token)" icon={Cpu} ms={stats.avg_llm_ttfb_ms} color="text-accent-purple" />
            <LatencyRow label="TTS (ilk chunk)" icon={Volume2} ms={stats.avg_tts_ttfb_ms} color="text-accent-green" />
            <div className="border-t border-border pt-2 flex justify-between text-[11px] text-text-muted">
              <span>P50 uçtan uca</span>
              <span className="font-semibold text-text-secondary">{stats.p50_total_ms > 0 ? `${stats.p50_total_ms} ms` : '—'}</span>
            </div>
            <div className="flex justify-between text-[11px] text-text-muted">
              <span>P95 uçtan uca</span>
              <span className="font-semibold text-text-secondary">{stats.p95_total_ms > 0 ? `${stats.p95_total_ms} ms` : '—'}</span>
            </div>
          </div>

          {/* Token usage + cost */}
          <div className="bg-bg-input border border-border rounded-btn p-3 space-y-2">
            <div className="flex items-center gap-1.5 mb-2">
              <DollarSign size={13} className="text-accent-green" />
              <p className="text-xs font-semibold text-text-secondary">Maliyet tahmini</p>
            </div>
            <div className="flex justify-between text-xs text-text-muted">
              <span>Toplam token</span>
              <span className="text-text-primary font-semibold">
                {(stats.total_prompt_tokens + stats.total_completion_tokens).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-[11px] text-text-muted">
              <span>Prompt / Tamamlama</span>
              <span>{stats.total_prompt_tokens.toLocaleString()} / {stats.total_completion_tokens.toLocaleString()}</span>
            </div>
            <div className="border-t border-border pt-2 space-y-1">
              {[
                { label: 'STT (Whisper)', usd: stats.cost_breakdown.stt_usd },
                { label: 'LLM (GPT-4o-mini)', usd: stats.cost_breakdown.llm_usd },
                { label: 'TTS', usd: stats.cost_breakdown.tts_usd },
              ].map(({ label, usd }) => (
                <div key={label} className="flex justify-between text-[11px] text-text-muted">
                  <span>{label}</span>
                  <span>${usd.toFixed(4)}</span>
                </div>
              ))}
              <div className="flex justify-between text-xs font-bold text-text-primary pt-1 border-t border-border">
                <span>Toplam</span>
                <span>${stats.estimated_cost_usd.toFixed(4)}</span>
              </div>
            </div>
          </div>

          {/* Top tools */}
          {stats.top_tools.length > 0 && (
            <div className="bg-bg-input border border-border rounded-btn p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Activity size={13} className="text-accent-orange" />
                <p className="text-xs font-semibold text-text-secondary">En çok kullanılan araçlar</p>
              </div>
              <div className="space-y-1.5">
                {stats.top_tools.map(({ name, count }) => (
                  <div key={name} className="flex items-center gap-2">
                    <div className="flex-1 bg-bg-card rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-accent-purple h-full rounded-full"
                        style={{ width: `${Math.min(100, (count / (stats.top_tools[0]?.count || 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-text-secondary w-28 text-right truncate">
                      {TOOL_LABELS[name] ?? name}
                    </span>
                    <span className="text-[11px] font-semibold text-text-primary w-5 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.total_turns === 0 && (
            <p className="text-xs text-text-muted text-center py-2">
              Bu dönemde kayıtlı konuşma yok.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
