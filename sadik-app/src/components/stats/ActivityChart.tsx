import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import { BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import { statsApi, DayStat, ModeStat } from '../../api/stats';
import { useModeColors } from '../../utils/modeColors';

/** Local calendar date as YYYY-MM-DD — avoids UTC day-off-by-one near midnight. */
function localToday(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

type Period = '7' | '14' | '30' | 'today';

const MODE_LABELS: Record<string, string> = {
  working: 'Çalışıyor',
  coding: 'Kod Yazıyor',
  break: 'Mola',
  meeting: 'Toplantı',
};

function toHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

export default function ActivityChart() {
  const { getModeColor } = useModeColors();
  const [period, setPeriod] = useState<Period>('today');
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [allModes, setAllModes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    loadData();
  }, [period]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (period === 'today') {
        const daily = await statsApi.daily(localToday());
        const row: Record<string, unknown> = { date: 'Bugün' };
        daily.forEach((m) => { row[m.mode] = toHours(m.total_seconds); });
        setData([row]);
        setAllModes(daily.map((m) => m.mode));
      } else {
        const days = parseInt(period) as 7 | 14 | 30;
        const rangeData = await statsApi.range(days);
        const modes = new Set<string>();
        const rows = rangeData.map((day: DayStat) => {
          const row: Record<string, unknown> = {
            date: new Date(day.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }),
          };
          day.modes.forEach((m: ModeStat) => {
            modes.add(m.mode);
            row[m.mode] = toHours(m.total_seconds);
          });
          return row;
        });
        setData(rows);
        setAllModes(Array.from(modes));
      }
    } catch {}
    setLoading(false);
  };

  const tabs: { key: Period; label: string }[] = [
    { key: 'today', label: 'Bugün' },
    { key: '7', label: '7 Gün' },
    { key: '14', label: '14 Gün' },
    { key: '30', label: '30 Gün' },
  ];

  return (
    <div className="bg-bg-card border border-border rounded-card overflow-hidden shadow-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-text-primary hover:bg-bg-hover transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-accent-purple/20 ring-1 ring-accent-purple/40 flex items-center justify-center">
            <BarChart3 size={15} className="text-accent-purple" />
          </span>
          Mod Grafiği
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted">
            {period === 'today' ? 'Bugün' : `${period} Gün`}
          </span>
          {open ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
        </div>
      </button>
      {open && (
      <div className="px-5 pb-4 border-t border-border pt-3">
      <div className="flex items-center justify-end mb-3">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setPeriod(t.key)}
              className={`text-xs px-3 py-1.5 rounded-btn transition-colors
                ${period === t.key ? 'bg-accent-purple text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">Yükleniyor...</div>
      ) : data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">Veri yok</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#404040" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={(v) => `${v}s`} />
            <Tooltip
              contentStyle={{ background: '#2d2d2d', border: '1px solid #404040', borderRadius: 10, fontSize: 12 }}
              labelStyle={{ color: '#e4e4e7', fontWeight: 600 }}
              itemStyle={{ color: '#a1a1aa' }}
              formatter={(v: number, name: string) => [`${v} saat`, MODE_LABELS[name] || name]}
            />
            <Legend
              iconType="circle" iconSize={8}
              wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }}
              formatter={(value: string) => MODE_LABELS[value] || value}
            />
            {allModes.map((mode) => (
              <Bar key={mode} dataKey={mode} stackId="a" fill={getModeColor(mode)} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
      </div>
      )}
    </div>
  );
}
