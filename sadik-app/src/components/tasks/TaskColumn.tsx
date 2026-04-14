import React from 'react';
import { Plus } from 'lucide-react';
import { Task } from '../../api/tasks';
import TaskCard from './TaskCard';

const STATUS_STYLES: Record<string, { border: string; bg: string }> = {
  todo:        { border: '#6b6b73', bg: 'rgba(107, 107, 115, 0.08)' },
  in_progress: { border: '#fb923c', bg: 'rgba(251, 146, 60, 0.12)' },
  done:        { border: '#6ee7b7', bg: 'rgba(110, 231, 183, 0.08)' },
  cancelled:   { border: '#fca5a5', bg: 'rgba(252, 165, 165, 0.08)' },
  planned:     { border: '#a78bfa', bg: 'rgba(167, 139, 250, 0.08)' },
  archived:    { border: '#fdba74', bg: 'rgba(253, 186, 116, 0.08)' },
};

interface Props {
  status: string;
  label: string;
  tasks: Task[];
  onCardClick: (task: Task) => void;
  onAddClick?: () => void;
  onStartPomodoro: (task: Task) => void;
  onDragStart: (taskId: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  isDropTarget: boolean;
  draggedTaskId: number | null;
}

export default function TaskColumn({
  status, label, tasks, onCardClick, onAddClick, onStartPomodoro,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
  isDropTarget, draggedTaskId,
}: Props) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.todo;

  return (
    <div
      className={`flex flex-col w-72 flex-shrink-0 border rounded-card overflow-hidden transition-all backdrop-blur-md ${
        isDropTarget ? 'border-accent-purple shadow-glow' : 'border-border'
      }`}
      style={{ borderTopColor: style.border, borderTopWidth: 3, backgroundColor: style.bg }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{label}</span>
          <span className="text-xs bg-bg-input text-text-muted px-2 py-0.5 rounded-full font-medium">
            {tasks.length}
          </span>
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px] transition-colors ${
        isDropTarget ? 'bg-accent-purple-dim' : ''
      }`}>
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs text-text-muted">
            {isDropTarget ? 'Buraya bırak' : 'Görev yok'}
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onCardClick(task)}
              onStartPomodoro={() => onStartPomodoro(task)}
              onDragStart={() => onDragStart(task.id)}
              onDragEnd={onDragEnd}
              isDragging={draggedTaskId === task.id}
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
