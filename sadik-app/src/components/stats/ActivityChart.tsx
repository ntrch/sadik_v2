import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import { statsApi, DayStat, ModeStat } from '../../api/stats';

type Period = '7' | '14' | '30' | 'today';

const MODE_COLORS: Record<string, string> = {
  working: '#3b82f6',
  coding: '#06b6d4',
  break: '#10b981',
  meeting: '#f59e0b',
  default: '#8b5cf6',
};

function getModeColor(mode: string): string {
  return MODE_COLORS[mode] || MODE_COLORS.default;
}

function toHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

export default function ActivityChart() {
  const [period, setPeriod] = useState<Period>('7');
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [allModes, setAllModes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [period]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (period === 'today') {
        const daily = await statsApi.daily();
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
    { key: '7', label: '7 Gün' },
    { key: '14', label: '14 Gün' },
    { key: '30', label: '30 Gün' },
    { key: 'today', label: 'Bugün' },
  ];

  return (
    <div className="bg-bg-card border border-border rounded-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-primary">Aktivite Grafiği</h3>
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setPeriod(t.key)}
              className={`text-xs px-3 py-1.5 rounded-btn transition-colors
                ${period === t.key ? 'bg-accent-blue text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`}>
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
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2a4a" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: '#8892b0', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#8892b0', fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={(v) => `${v}s`} />
            <Tooltip
              contentStyle={{ background: '#131b2e', border: '1px solid #1e2a4a', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
              itemStyle={{ color: '#8892b0' }}
              formatter={(v: number, name: string) => [`${v} saat`, name]}
            />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#8892b0' }} />
            {allModes.map((mode) => (
              <Bar key={mode} dataKey={mode} stackId="a" fill={getModeColor(mode)} radius={[0, 0, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
