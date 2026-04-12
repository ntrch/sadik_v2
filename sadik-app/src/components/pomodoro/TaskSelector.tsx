import React, { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { Task, tasksApi } from '../../api/tasks';

interface Props {
  value: number | null;
  onChange: (taskId: number | null) => void;
}

export default function TaskSelector({ value, onChange }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    tasksApi.list().then((all) =>
      setTasks(all.filter((t) => t.status === 'todo' || t.status === 'in_progress'))
    ).catch(() => {});
  }, []);

  const selected = tasks.find((t) => t.id === value);

  return (
    <div className="relative w-72">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-bg-input border border-border rounded-btn text-sm transition-colors hover:border-accent-purple/50"
      >
        <span className={selected ? 'text-text-primary' : 'text-text-muted'}>
          {selected ? selected.title : 'Görev seç (opsiyonel)'}
        </span>
        <ChevronDown size={14} className="text-text-muted flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded-card shadow-xl z-20 max-h-48 overflow-y-auto">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm text-text-muted hover:bg-bg-hover transition-colors"
          >
            Görev seçme
          </button>
          {tasks.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text-muted">Uygun görev yok</p>
          ) : (
            tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => { onChange(t.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-bg-hover
                  ${t.id === value ? 'text-accent-purple' : 'text-text-primary'}`}
              >
                {t.title}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
