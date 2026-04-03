import React from 'react';
import { Calendar, Timer, Flame } from 'lucide-react';
import { Task } from '../../api/tasks';

const priorityLabels: Record<number, { label: string; color: string }> = {
  0: { label: 'Düşük', color: 'text-text-muted' },
  1: { label: 'Normal', color: 'text-accent-blue' },
  2: { label: 'Yüksek', color: 'text-accent-yellow' },
  3: { label: 'Acil', color: 'text-accent-red' },
};

interface Props {
  task: Task;
  onClick: () => void;
  onStartPomodoro: () => void;
}

export default function TaskCard({ task, onClick, onStartPomodoro }: Props) {
  const prio = priorityLabels[task.priority] || priorityLabels[0];

  const formatDue = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  };

  return (
    <div
      onClick={onClick}
      className="bg-bg-card border border-border rounded-card p-3 cursor-pointer hover:border-accent-blue/40 hover:bg-bg-hover transition-all group animate-fade-in"
    >
      <p className="text-sm font-semibold text-text-primary mb-1 leading-snug">{task.title}</p>
      {task.description && (
        <p className="text-xs text-text-secondary line-clamp-2 mb-2">{task.description}</p>
      )}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          {task.due_date && (
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <Calendar size={10} />
              {formatDue(task.due_date)}
            </span>
          )}
          <span className={`text-xs font-medium ${prio.color}`}>{prio.label}</span>
          {task.pomodoro_count > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <Flame size={10} className="text-accent-red" />
              {task.pomodoro_count}
            </span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onStartPomodoro(); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent-blue/20 text-text-muted hover:text-accent-blue"
          title="Pomodoro başlat"
        >
          <Timer size={14} />
        </button>
      </div>
    </div>
  );
}
