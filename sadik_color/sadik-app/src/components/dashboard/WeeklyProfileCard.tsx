import React, { useEffect, useState } from 'react';
import { UserCircle2 } from 'lucide-react';
import { settingsApi } from '../../api/settings';
import { useModeColors } from '../../utils/modeColors';

type DominantMode =
  | 'coding' | 'meeting' | 'writing' | 'learning'
  | 'creative' | 'gaming' | 'break' | null;

interface WeeklyBlock {
  hour_start: number;
  hour_end: number;
  dominant_mode: DominantMode;
  session_count: number;
}

interface WeeklyProfile {
  version: number;
  generated_at: string;
  days_analyzed: number;
  weekly: Record<string, WeeklyBlock[]>;
  summary_tr: string;
}

const DAYS: { key: string; label: string }[] = [
  { key: 'monday',    label: 'Pzt' },
  { key: 'tuesday',   label: 'Sal' },
  { key: 'wednesday', label: 'Çar' },
  { key: 'thursday',  label: 'Per' },
  { key: 'friday',    label: 'Cum' },
  { key: 'saturday',  label: 'Cmt' },
  { key: 'sunday',    label: 'Paz' },
];

const DAY_LABEL_TR: Record<string, string> = {
  monday: 'Pazartesi', tuesday: 'Salı', wednesday: 'Çarşamba',
  thursday: 'Perşembe', friday: 'Cuma', saturday: 'Cumartesi', sunday: 'Pazar',
};

const MODE_LABEL_TR: Record<string, string> = {
  coding: 'kod yazma', meeting: 'toplantı', writing: 'yazma',
  learning: 'öğrenme', creative: 'yaratıcı', gaming: 'oyun', break: 'mola',
};

// Fallback palette for modes that aren't in the user's preset store
// (writing/learning/creative/gaming). `coding`, `meeting`, `break` come
// from useModeColors() so they match the rest of the app.
const EXTRA_MODE_COLORS: Record<string, string> = {
  writing:  '#a78bfa', // lavender
  learning: '#38bdf8', // sky
  creative: '#f472b6', // pink
  gaming:   '#facc15', // yellow
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function parseProfile(raw: string | undefined | null): WeeklyProfile | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as WeeklyProfile;
    if (!p || typeof p !== 'object' || !p.weekly) return null;
    return p;
  } catch {
    return null;
  }
}

export default function WeeklyProfileCard() {
  const { getModeColor } = useModeColors();
  const [profile, setProfile] = useState<WeeklyProfile | null>(null);
  const [behavioralOn, setBehavioralOn] = useState<boolean | null>(null);
  const [hover, setHover] = useState<{ day: string; hour: number; block: WeeklyBlock } | null>(null);

  useEffect(() => {
    let cancelled = false;
    settingsApi.getAll().then((all) => {
      if (cancelled) return;
      setBehavioralOn(all.privacy_behavioral_learning === 'true');
      setProfile(parseProfile(all.user_profile_patterns));
    }).catch(() => {
      if (cancelled) return;
      setBehavioralOn(false);
      setProfile(null);
    });
    return () => { cancelled = true; };
  }, []);

  // Privacy gate: only render when Full-tier / behavioral learning is ON.
  if (behavioralOn !== true) return null;

  const colorFor = (mode: DominantMode): string => {
    if (!mode) return 'transparent';
    // coding / meeting / break come from the user's mode palette
    if (mode === 'coding' || mode === 'meeting' || mode === 'break') {
      return getModeColor(mode);
    }
    return EXTRA_MODE_COLORS[mode] ?? '#6b7280';
  };

  // Build an hour-indexed lookup per day so the grid renders in O(7 * 24).
  const grid: Record<string, (WeeklyBlock | null)[]> = {};
  for (const { key } of DAYS) {
    const row: (WeeklyBlock | null)[] = Array(24).fill(null);
    const blocks = profile?.weekly?.[key] ?? [];
    for (const b of blocks) {
      if (!b.dominant_mode) continue;
      for (let h = b.hour_start; h < b.hour_end && h < 24; h++) {
        row[h] = b;
      }
    }
    grid[key] = row;
  }

  const hasAnyData = profile
    && Object.values(profile.weekly).some((arr) => arr.some((b) => b.dominant_mode));

  return (
    <div className="bg-bg-card border border-border rounded-card p-5 mb-5 shadow-card">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-7 h-7 rounded-lg bg-accent-purple/20 ring-1 ring-accent-purple/40 flex items-center justify-center">
          <UserCircle2 size={15} className="text-accent-purple" />
        </span>
        <h3 className="text-sm font-semibold text-text-primary">Haftalık Profilim</h3>
        {profile && (
          <span className="ml-auto text-[10px] text-text-muted">
            Son {profile.days_analyzed} gün
          </span>
        )}
      </div>

      {!profile || !hasAnyData ? (
        <p className="text-xs text-text-muted py-6 text-center">
          Henüz yeterli veri yok — birkaç gün kullan, pattern'ini öğreneyim.
        </p>
      ) : (
        <>
          {/* Heatmap */}
          <div className="relative">
            <div className="grid gap-0.5" style={{ gridTemplateColumns: '32px repeat(24, minmax(0, 1fr))' }}>
              {/* Header row: hour labels (every 3h) */}
              <div />
              {HOURS.map((h) => (
                <div key={`h-${h}`} className="text-[9px] text-text-muted text-center tabular-nums">
                  {h % 3 === 0 ? h : ''}
                </div>
              ))}
              {/* Rows */}
              {DAYS.map(({ key, label }) => (
                <React.Fragment key={key}>
                  <div className="text-[10px] text-text-muted font-medium flex items-center">{label}</div>
                  {HOURS.map((h) => {
                    const block = grid[key][h];
                    const color = block ? colorFor(block.dominant_mode) : 'transparent';
                    return (
                      <div
                        key={`${key}-${h}`}
                        onMouseEnter={() => block && setHover({ day: key, hour: h, block })}
                        onMouseLeave={() => setHover(null)}
                        className="h-5 rounded-sm border border-border/40 transition-all hover:scale-110"
                        style={{
                          backgroundColor: block ? color : '#1f1f23',
                          borderColor: block ? color : undefined,
                          opacity: block ? 0.85 : 0.3,
                        }}
                      />
                    );
                  })}
                </React.Fragment>
              ))}
            </div>

            {/* Tooltip */}
            {hover && (
              <div className="mt-3 px-3 py-2 bg-bg-input border border-border rounded-btn text-xs text-text-primary">
                <span className="font-medium">{DAY_LABEL_TR[hover.day]}</span>{' '}
                <span className="text-text-secondary tabular-nums">
                  {String(hover.block.hour_start).padStart(2, '0')}–
                  {String(hover.block.hour_end).padStart(2, '0')}
                </span>
                {': '}
                <span style={{ color: colorFor(hover.block.dominant_mode) }}>
                  {hover.block.dominant_mode ? MODE_LABEL_TR[hover.block.dominant_mode] ?? hover.block.dominant_mode : '—'}
                </span>
                <span className="text-text-muted"> · {hover.block.session_count} session</span>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-border">
            {Object.keys(MODE_LABEL_TR).map((mode) => (
              <div key={mode} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: colorFor(mode as DominantMode) }}
                />
                <span className="text-[10px] text-text-secondary capitalize">{MODE_LABEL_TR[mode]}</span>
              </div>
            ))}
          </div>

          {/* Summary */}
          {profile.summary_tr && (
            <p className="mt-4 pt-3 border-t border-border font-mono italic text-xs text-text-secondary leading-relaxed">
              {profile.summary_tr}
            </p>
          )}
        </>
      )}
    </div>
  );
}
