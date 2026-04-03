import React from 'react';
import { Plus } from 'lucide-react';
import { Task } from '../../api/tasks';
import TaskCard from './TaskCard';

const STATUS_COLORS: Record<string, string> = {
  todo: '#6b7280',
  in_progress: '#f59e0b',
  done: '#10b981',
  cancelled: '#ef4444',
  planned: '#8b5cf6',
  archived: '#92643a',
};

interface Props {
  status: string;
  label: string;
  tasks: Task[];
  onCardClick: (task: Task) => void;
  onAddClick?: () => void;
  onStartPomodoro: (task: Task) => void;
}

export default function TaskColumn({ status, label, tasks, onCardClick, onAddClick, onStartPomodoro }: Props) {
  const color = STATUS_COLORS[status] || '#6b7280';

  return (
    <div className="flex flex-col w-72 flex-shrink-0 bg-bg-card border border-border rounded-card overflow-hidden"
         style={{ borderTopColor: color, borderTopWidth: 3 }}>
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{label}</span>
          <span className="text-xs bg-bg-input text-text-muted px-2 py-0.5 rounded-full font-medium">
            {tasks.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px]">
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs text-text-muted">
            Görev yok
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onCardClick(task)}
              onStartPomodoro={() => onStartPomodoro(task)}
            />
          ))
        )}
      </div>

      {onAddClick && (
        <div className="p-2 border-t border-border">
          <button onClick={onAddClick}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-btn text-xs text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
            <Plus size={14} />
            Yeni Görev
          </button>
        </div>
      )}
    </div>
  );
}
