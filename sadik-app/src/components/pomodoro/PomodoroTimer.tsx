import React from 'react';
import { Play, Pause, Square } from 'lucide-react';
import { PomodoroState } from '../../api/pomodoro';

const PHASE_LABELS: Record<string, string> = {
  work: 'Çalışma',
  break: 'Mola',
  long_break: 'Uzun Mola',
  idle: 'Hazır',
};

const PHASE_COLORS: Record<string, string> = {
  work: '#3b82f6',
  break: '#10b981',
  long_break: '#8b5cf6',
  idle: '#4a5568',
};

interface Props {
  state: PomodoroState;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function PomodoroTimer({ state, onStart, onPause, onResume, onStop }: Props) {
  const { is_running, is_paused, remaining_seconds, total_seconds, current_session, phase } = state;
  const size = 220;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total_seconds > 0 ? remaining_seconds / total_seconds : 1;
  const dashOffset = circumference * (1 - progress);
  const color = PHASE_COLORS[phase] || PHASE_COLORS.idle;
  const isActive = is_running || is_paused;

  return (
    <div className="flex flex-col items-center gap-8">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="rotate-[-90deg]">
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="#1e2a4a" strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-5xl font-bold text-text-primary tabular-nums" style={{ color }}>
            {formatTime(remaining_seconds)}
          </span>
          <span className="text-sm text-text-secondary mt-2 font-medium">{PHASE_LABELS[phase]}</span>
          {isActive && (
            <span className="text-xs text-text-muted mt-1">
              Oturum {current_session}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {!isActive ? (
          <button onClick={onStart}
            className="flex items-center gap-2 px-6 py-3 bg-accent-green hover:bg-green-500 text-white font-medium rounded-btn transition-colors text-sm">
            <Play size={16} fill="white" />
            Başlat
          </button>
        ) : is_paused ? (
          <>
            <button onClick={onResume}
              className="flex items-center gap-2 px-6 py-3 bg-accent-green hover:bg-green-500 text-white font-medium rounded-btn transition-colors text-sm">
              <Play size={16} fill="white" />
              Devam Et
            </button>
            <button onClick={onStop}
              className="flex items-center gap-2 px-4 py-3 bg-bg-card border border-border hover:border-accent-red/50 text-accent-red font-medium rounded-btn transition-colors text-sm">
              <Square size={16} fill="currentColor" />
              Bitir
            </button>
          </>
        ) : (
          <>
            <button onClick={onPause}
              className="flex items-center gap-2 px-6 py-3 bg-accent-yellow hover:bg-yellow-400 text-bg-main font-medium rounded-btn transition-colors text-sm">
              <Pause size={16} fill="currentColor" />
              Duraklat
            </button>
            <button onClick={onStop}
              className="flex items-center gap-2 px-4 py-3 bg-bg-card border border-border hover:border-accent-red/50 text-accent-red font-medium rounded-btn transition-colors text-sm">
              <Square size={16} fill="currentColor" />
              Bitir
            </button>
          </>
        )}
      </div>
    </div>
  );
}
