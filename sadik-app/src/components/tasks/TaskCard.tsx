import React from 'react';
import { Calendar, Clock, Timer, Flame, GripVertical } from 'lucide-react';
import { Task } from '../../api/tasks';
import { getIconByKey } from '../../utils/modeIcons';
import notionLogo from '../../assets/brand/Notion_Symbol_0.svg';

const priorityLabels: Record<number, { label: string; color: string }> = {
  0: { label: 'Düşük', color: 'text-text-muted' },
  1: { label: 'Normal', color: 'text-accent-purple' },
  2: { label: 'Yüksek', color: 'text-accent-yellow' },
  3: { label: 'Acil', color: 'text-accent-red' },
};

interface Props {
  task: Task;
  onClick: () => void;
  onStartPomodoro: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

export default function TaskCard({ task, onClick, onStartPomodoro, onDragStart, onDragEnd, isDragging }: Props) {
  const prio = priorityLabels[task.priority] || priorityLabels[0];
  const LucideTaskIcon = task.icon ? getIconByKey(task.icon) : null;

  const formatDue = (dateStr: string) => {
    const d = new Date(dateStr);
    const datePart = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
    const h = d.getHours(), m = d.getMinutes();
    if (h === 23 && m === 59) return datePart; // no explicit time set
    const timePart = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    return `${datePart} ${timePart}`;
  };

  const formatCreated = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`relative rounded-[14px] p-3 cursor-grab transition-all group animate-fade-in backdrop-blur-sm border ${
        task.status === 'in_progress'
          ? 'bg-accent-orange/10 border-accent-orange/40 hover:border-accent-orange/60'
          : 'bg-bg-card border-border hover:border-accent-purple/40 hover:bg-bg-hover'
      } ${isDragging ? 'opacity-40 scale-95' : ''}`}
    >
      {/* Left-top: custom icon/image */}
      {task.icon_image ? (
        <img
          src={task.icon_image}
          alt=""
          className="absolute top-2 left-2 w-4 h-4 rounded-sm object-cover pointer-events-none"
        />
      ) : LucideTaskIcon ? (
        <span className="absolute top-2 left-2 w-4 h-4 flex items-center justify-center pointer-events-none">
          <LucideTaskIcon size={14} className="text-text-muted" />
        </span>
      ) : null}

      {/* Right-top: Notion logo if synced from Notion */}
      {task.notion_page_id && (
        <img
          src={notionLogo}
          alt="Notion"
          title="Notion'dan eşitlendi"
          className="absolute top-2 right-2 w-3.5 h-3.5 opacity-70 pointer-events-none"
        />
      )}

      <div className="flex items-start gap-2">
        <GripVertical size={14} className="text-text-muted mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity cursor-grab" />
        <div className="flex-1 min-w-0">
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
              <span className="flex items-center gap-1 text-xs text-text-muted" title="Oluşturulma saati">
                <Clock size={10} />
                {formatCreated(task.created_at)}
              </span>
              {task.pomodoro_count > 0 && (
                <span className="flex items-center gap-1 text-xs text-text-muted">
                  <Flame size={10} className="text-accent-orange" />
                  {task.pomodoro_count}
                </span>
              )}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onStartPomodoro(); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent-purple/20 text-text-muted hover:text-accent-purple"
              title="Pomodoro başlat"
            >
              <Timer size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
