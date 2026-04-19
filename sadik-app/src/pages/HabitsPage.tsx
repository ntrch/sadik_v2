import React, { useState, useEffect, useCallback } from 'react';
import { Repeat, Plus, Pencil, Trash2, X } from 'lucide-react';
import { habitsApi, Habit, HabitCreate, HabitUpdate } from '../api/habits';

// ── Day labels ────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function formatDays(days: number[]): string {
  if (days.length === 7) return 'Her gün';
  if (days.length === 0) return '—';
  return days.map((d) => DAY_LABELS[d]).join(', ');
}

// ── Toggle ────────────────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  color?: string;
}

function Toggle({ checked, onChange, color = 'bg-accent-orange' }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
        checked ? color : 'bg-bg-card border border-border'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// ── Form modal ────────────────────────────────────────────────────────────────

interface ModalProps {
  habit: Habit | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const DEFAULT_DAYS = [0, 1, 2, 3, 4]; // Mon-Fri

function HabitModal({ habit, onClose, onSaved }: ModalProps) {
  const [name, setName]               = useState(habit?.name ?? '');
  const [description, setDescription] = useState(habit?.description ?? '');
  const [days, setDays]               = useState<number[]>(habit?.days_of_week ?? DEFAULT_DAYS);
  const [time, setTime]               = useState(habit?.time ?? '09:00');
  const [minutesBefore, setMinutesBefore] = useState(habit?.minutes_before ?? 5);
  const [respectDnd, setRespectDnd]   = useState(habit?.respect_dnd ?? true);
  const [enabled, setEnabled]         = useState(habit?.enabled ?? true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Auto-resize textarea
  const handleDescChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  const toggleDay = (d: number) => {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('İsim zorunlu'); return; }
    if (days.length === 0) { setError('En az bir gün seçmelisin'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: HabitCreate | HabitUpdate = {
        name: name.trim(),
        description: description.trim() || null,
        days_of_week: days,
        time,
        minutes_before: minutesBefore,
        respect_dnd: respectDnd,
        enabled,
      };
      if (habit) {
        await habitsApi.update(habit.id, payload as HabitUpdate);
      } else {
        await habitsApi.create(payload as HabitCreate);
      }
      await onSaved();
      onClose();
    } catch {
      setError('Kayıt hatası. Tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="bg-bg-card border border-border rounded-2xl w-[min(90vw,520px)] max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <span className="font-semibold text-text-primary">
            {habit ? 'Alışkanlığı Düzenle' : 'Yeni Alışkanlık'}
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-hover text-text-secondary">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-5">

          {/* Name */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5 font-medium">İsim</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Egzersiz, Kitap okuma..."
              className="w-full bg-bg-main border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-orange"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5 font-medium">Açıklama (opsiyonel)</label>
            <textarea
              value={description}
              onChange={handleDescChange}
              placeholder="Hatırlatma notu..."
              rows={2}
              className="w-full bg-bg-main border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-orange resize-none overflow-hidden"
            />
          </div>

          {/* Days */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5 font-medium">Günler (en az 1)</label>
            <div className="flex gap-2 flex-wrap">
              {DAY_LABELS.map((label, idx) => {
                const active = days.includes(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleDay(idx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      active
                        ? 'bg-accent-orange/20 text-accent-orange ring-1 ring-accent-orange/50'
                        : 'bg-bg-main border border-border text-text-secondary hover:text-text-primary hover:border-accent-orange/40'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5 font-medium">Saat</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="bg-bg-main border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-orange"
            />
          </div>

          {/* Minutes before */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5 font-medium">
              Kaç dakika öncesi hatırlat: <span className="text-text-primary font-semibold">{minutesBefore} dk</span>
            </label>
            <input
              type="range"
              min={0}
              max={120}
              step={5}
              value={minutesBefore}
              onChange={(e) => setMinutesBefore(Number(e.target.value))}
              className="w-full accent-orange-400"
            />
            <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
              <span>0 dk</span>
              <span>1 saat</span>
              <span>2 saat</span>
            </div>
          </div>

          {/* Respect DND */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Rahatsız Etmeyin aktifse atla</p>
              <p className="text-xs text-text-muted">DND modunda hatırlatmayı sessizleştir</p>
            </div>
            <Toggle checked={respectDnd} onChange={setRespectDnd} />
          </div>

          {/* Enabled */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-primary">Aktif</p>
            <Toggle checked={enabled} onChange={setEnabled} />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            İptal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-accent-orange/20 text-accent-orange border border-accent-orange/30 hover:bg-accent-orange/30 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Habit card ─────────────────────────────────────────────────────────────────

interface CardProps {
  habit: Habit;
  onEdit: (h: Habit) => void;
  onDelete: (id: number) => void;
  onToggleEnabled: (h: Habit) => void;
}

function HabitCard({ habit, onEdit, onDelete, onToggleEnabled }: CardProps) {
  return (
    <div className="bg-bg-card border border-border rounded-2xl p-4 flex flex-col gap-3 shadow-card hover:border-accent-orange/30 transition-colors group">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text-primary text-sm truncate">{habit.name}</p>
          {habit.description && (
            <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{habit.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(habit)}
            className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title="Düzenle"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDelete(habit.id)}
            className="p-2 rounded-lg hover:bg-red-500/10 text-text-secondary hover:text-red-400 transition-colors"
            title="Sil"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
        <span className="text-accent-orange font-medium">{habit.time}</span>
        {habit.minutes_before > 0 && (
          <span>{habit.minutes_before} dk önce</span>
        )}
        <span>{formatDays(habit.days_of_week)}</span>
      </div>

      {/* Footer: enable toggle */}
      <div className="flex items-center justify-between pt-1 border-t border-border/60">
        <span className={`text-xs ${habit.enabled ? 'text-accent-orange' : 'text-text-muted'}`}>
          {habit.enabled ? 'Aktif' : 'Pasif'}
        </span>
        <Toggle
          checked={habit.enabled}
          onChange={() => onToggleEnabled(habit)}
        />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HabitsPage() {
  const [habits, setHabits]       = useState<Habit[]>([]);
  const [loading, setLoading]     = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Habit | null>(null);
  const [modalKey, setModalKey]   = useState(0);
  const [toast, setToast]         = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await habitsApi.list();
      setHabits(data);
    } catch {
      showToast('Alışkanlıklar yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setModalKey((k) => k + 1);
    setEditTarget(null);
    setModalOpen(true);
  };

  const openEdit = (h: Habit) => {
    setModalKey((k) => k + 1);
    setEditTarget(h);
    setModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Bu alışkanlığı silmek istediğine emin misin?')) return;
    try {
      await habitsApi.remove(id);
      setHabits((prev) => prev.filter((h) => h.id !== id));
      showToast('Silindi', 'success');
    } catch {
      showToast('Silinemedi', 'error');
    }
  };

  const handleToggleEnabled = async (habit: Habit) => {
    try {
      const updated = await habitsApi.update(habit.id, { enabled: !habit.enabled });
      setHabits((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
    } catch {
      showToast('Güncelleme başarısız', 'error');
    }
  };

  return (
    <div className="p-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-orange/15 flex items-center justify-center">
            <Repeat size={20} className="text-accent-orange" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-text-primary">Alışkanlıklar</h1>
            <p className="text-xs text-text-muted">Günlük rutin hatırlatıcılar</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-accent-orange/15 text-accent-orange border border-accent-orange/30 hover:bg-accent-orange/25 transition-colors"
        >
          <Plus size={16} />
          Yeni Alışkanlık
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <p className="text-text-muted text-sm text-center py-12">Yükleniyor...</p>
      ) : habits.length === 0 ? (
        <div className="text-center py-16">
          <Repeat size={40} className="text-text-muted mx-auto mb-3 opacity-40" />
          <p className="text-text-muted text-sm">Henüz alışkanlık yok. İlk alışkanlığını ekle.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {habits.map((h) => (
            <HabitCard
              key={h.id}
              habit={h}
              onEdit={openEdit}
              onDelete={handleDelete}
              onToggleEnabled={handleToggleEnabled}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <HabitModal
          key={`habit-modal-${modalKey}`}
          habit={editTarget}
          onClose={() => setModalOpen(false)}
          onSaved={load}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl text-sm font-medium shadow-lg transition-all ${
            toast.type === 'success' ? 'bg-green-500/20 text-green-300 border border-green-500/30' :
            toast.type === 'error'   ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                                       'bg-bg-card text-text-primary border border-border'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
