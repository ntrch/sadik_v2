import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import { statsApi, DayStat, ModeStat } from '../../api/stats';

type Period = '7' | '14' | '30' | 'today';

const MODE_COLORS: Record<string, string> = {
  working: '#a78bfa',
  coding: '#67e8f9',
  break: '#6ee7b7',
  meeting: '#fcd34d',
  default: '#fdba74',
};

const MODE_LABELS: Record<string, string> = {
  working: 'Çalışıyor',
  coding: 'Kod Yazıyor',
  break: 'Mola',
  meeting: 'Toplantı',
};

function getModeColor(mode: string): string {
  return MODE_COLORS[mode] || MODE_COLORS.default;
}

function toHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

export default function ActivityChart() {
  const [period, setPeriod] = useState<Period>('today');
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
    { key: 'today', label: 'Bugün' },
    { key: '7', label: '7 Gün' },
    { key: '14', label: '14 Gün' },
    { key: '30', label: '30 Gün' },
  ];

  return (
    <div className="bg-bg-card border border-border rounded-card p-5 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-primary">Mod Grafiği</h3>
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
  );
}
