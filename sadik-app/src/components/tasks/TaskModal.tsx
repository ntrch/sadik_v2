import React, { useState, useEffect, useContext } from 'react';
import { X } from 'lucide-react';
import { Task, TaskCreate, TaskUpdate, tasksApi } from '../../api/tasks';
import { AppContext } from '../../context/AppContext';

const STATUS_OPTIONS = [
  { value: 'todo', label: 'Yapılacak' },
  { value: 'in_progress', label: 'Devam Ediyor' },
  { value: 'done', label: 'Tamamlandı' },
  { value: 'cancelled', label: 'İptal Edildi' },
  { value: 'planned', label: 'Planlandı' },
  { value: 'archived', label: 'Arşiv' },
];

const PRIORITY_OPTIONS = [
  { value: 0, label: 'Düşük' },
  { value: 1, label: 'Normal' },
  { value: 2, label: 'Yüksek' },
  { value: 3, label: 'Acil' },
];

interface Props {
  task?: Task;
  defaultStatus?: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function TaskModal({ task, defaultStatus = 'todo', onClose, onSaved }: Props) {
  const { triggerEvent } = useContext(AppContext);
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [notes, setNotes] = useState(task?.notes || '');
  const [dueDate, setDueDate] = useState(
    task?.due_date ? task.due_date.split('T')[0] : ''
  );
  const [dueTime, setDueTime] = useState(
    task?.due_date && task.due_date.includes('T')
      ? task.due_date.split('T')[1]?.slice(0, 5) || ''
      : ''
  );
  const [priority, setPriority] = useState(task?.priority ?? 0);
  const [status, setStatus] = useState(task?.status || defaultStatus);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const dueDateFull = dueDate
        ? (dueTime ? `${dueDate}T${dueTime}:00` : `${dueDate}T23:59:00`)
        : undefined;
      const data = {
        title: title.trim(),
        description: description || undefined,
        notes: notes || undefined,
        due_date: dueDateFull,
        priority,
        status,
      };
      if (task) {
        await tasksApi.update(task.id, data as TaskUpdate);
      } else {
        await tasksApi.create(data as TaskCreate);
      }
      triggerEvent('confirmation_success');
      onSaved();
      onClose();
    } catch (e) {
      console.error('Save error', e);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!task) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await tasksApi.delete(task.id);
      triggerEvent('confirmation_success');
      onSaved();
      onClose();
    } catch {}
    setDeleting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-bg-card border border-border rounded-card w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">
            {task ? 'Görevi Düzenle' : 'Yeni Görev'}
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1.5 block">Görev Adı *</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-btn px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-border-focus transition-colors"
              placeholder="Görevi tanımla..."
            />
          </div>

          <div>
            <label className="text-xs font-medium text-text-secondary mb-1.5 block">Açıklama</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full bg-bg-input border border-border rounded-btn px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-border-focus transition-colors resize-none"
              placeholder="Opsiyonel açıklama..."
            />
          </div>

          <div>
            <label className="text-xs font-medium text-text-secondary mb-1.5 block">Görev Notu</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-bg-input border border-border rounded-btn px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-border-focus transition-colors resize-none"
              placeholder="Ek notlar..."
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1.5 block">Teslim Tarihi</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-btn px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1.5 block">Teslim Saati</label>
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                disabled={!dueDate}
                className="w-full bg-bg-input border border-border rounded-btn px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus transition-colors disabled:opacity-40"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1.5 block">Öncelik</label>
              <select
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full bg-bg-input border border-border rounded-btn px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus transition-colors"
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {task && (
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1.5 block">Durum</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-btn px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus transition-colors"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          {task && (
            <p className="text-xs text-text-muted">
              Oluşturulma: {new Date(task.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between p-5 border-t border-border">
          <div>
            {task && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className={`text-sm px-3 py-2 rounded-btn transition-colors font-medium
                  ${confirmDelete
                    ? 'bg-accent-red text-white hover:bg-red-600'
                    : 'text-accent-red hover:bg-accent-red/10'}`}
              >
                {deleting ? 'Siliniyor...' : confirmDelete ? 'Emin misin?' : 'Sil'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="text-sm px-4 py-2 rounded-btn text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
              İptal
            </button>
            <button onClick={handleSave} disabled={saving || !title.trim()}
              className="text-sm px-4 py-2 rounded-btn bg-accent-purple hover:bg-accent-purple-hover text-white font-medium transition-colors disabled:opacity-50">
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
