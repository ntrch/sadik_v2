import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain, BrainCircuit, Copy, Trash2, Send, ImagePlus, X, Check, Pencil, Lightbulb,
  Clipboard, StickyNote, MessageSquare,
} from 'lucide-react';
import EmptyState from '../components/common/EmptyState';
import {
  memoryApi, ClipboardItem as ClipboardItemType, BrainstormNote,
} from '../api/memory';
import { tasksApi, Task } from '../api/tasks';
import { AppContext } from '../context/AppContext';

function isImageContent(content: string, contentType: string) {
  return contentType === 'image' || content.startsWith('data:image/');
}

function formatRelative(iso: string): string {
  // Backend emits naive UTC timestamps ("YYYY-MM-DDTHH:mm:ss" with no offset).
  // `new Date(...)` would treat these as local time, causing a whole-timezone
  // skew (e.g. "4 saat önce" right after copy for UTC+3 users). Append 'Z' so
  // the string is parsed as UTC.
  const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(normalized);
  const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'az önce';
  if (diff < 3600) return `${Math.floor(diff / 60)} dakika önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} saat önce`;
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function copyToClipboard(item: ClipboardItemType | BrainstormNote): Promise<boolean> {
  const isImg = isImageContent(item.content, item.content_type);
  const electron = (window as any).sadikElectron;
  // Prefer the Electron native clipboard path — avoids DOM ClipboardItem
  // availability issues and works for both text and images uniformly.
  if (electron?.writeClipboard) {
    try {
      const res = await electron.writeClipboard({
        type: isImg ? 'image' : 'text',
        content: item.content,
      });
      if (res?.ok) return true;
    } catch { /* fall through to DOM */ }
  }
  try {
    if (isImg) {
      const resp = await fetch(item.content);
      const blob = await resp.blob();
      const CB = (window as any).ClipboardItem;
      if (CB && navigator.clipboard?.write) {
        await navigator.clipboard.write([new CB({ [blob.type]: blob })]);
        return true;
      }
      return false;
    }
    await navigator.clipboard.writeText(item.content);
    return true;
  } catch {
    return false;
  }
}

export default function MemoryPage() {
  const { showToast } = useContext(AppContext);
  const [clips, setClips] = useState<ClipboardItemType[]>([]);
  const [notes, setNotes] = useState<BrainstormNote[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  // Note editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteImage, setNoteImage] = useState<string | null>(null);
  const [noteSourceClip, setNoteSourceClip] = useState<number | null>(null);

  // Task push picker
  const [pushingNoteId, setPushingNoteId] = useState<number | null>(null);

  // Tabs — "Hafıza" (clipboard) and "Beyin Fırtınası" (notes)
  const [activeTab, setActiveTab] = useState<'memory' | 'brainstorm'>('memory');
  // Clipboard "tümünü gör" toggle — collapsed view shows latest 12 only.
  const [showAllClips, setShowAllClips] = useState(false);
  const PREVIEW_CLIP_COUNT = 12;

  const loadAll = async () => {
    setLoading(true);
    try {
      const [c, n, t] = await Promise.all([
        memoryApi.listClipboard(200),
        memoryApi.listNotes(),
        tasksApi.list(),
      ]);
      setClips(c);
      setNotes(n);
      setTasks(t);
    } catch {
      showToast('Hafıza verisi yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // Poll every 3s so new ctrl+c entries show up quickly.
    const id = setInterval(() => {
      memoryApi.listClipboard(200).then(setClips).catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, []);

  // ── Clipboard actions ─────────────────────────────────────────────────
  const handleCopyClip = async (c: ClipboardItemType) => {
    const ok = await copyToClipboard(c);
    showToast(ok ? 'Panoya kopyalandı' : 'Kopyalanamadı', ok ? 'success' : 'error');
  };
  const handleDeleteClip = async (id: number) => {
    await memoryApi.deleteClipboard(id).catch(() => {});
    setClips((prev) => prev.filter((x) => x.id !== id));
  };
  const handleClearAllClips = async () => {
    if (!window.confirm('Tüm hafıza temizlensin mi?')) return;
    await memoryApi.clearClipboard().catch(() => {});
    setClips([]);
    showToast('Hafıza temizlendi', 'info');
  };

  const handleClipToNote = (c: ClipboardItemType) => {
    setEditingId(null);
    setNoteSourceClip(c.id);
    setNoteTitle('');
    if (isImageContent(c.content, c.content_type)) {
      setNoteImage(c.content);
      setNoteText('');
    } else {
      setNoteImage(null);
      setNoteText(c.content);
    }
    setEditorOpen(true);
  };

  // ── Note actions ──────────────────────────────────────────────────────
  const openNewNote = () => {
    setEditingId(null);
    setNoteTitle('');
    setNoteText('');
    setNoteImage(null);
    setNoteSourceClip(null);
    setEditorOpen(true);
  };

  const openEditNote = (n: BrainstormNote) => {
    setEditingId(n.id);
    setNoteTitle(n.title ?? '');
    if (isImageContent(n.content, n.content_type)) {
      setNoteImage(n.content);
      setNoteText('');
    } else {
      setNoteImage(null);
      setNoteText(n.content);
    }
    setNoteSourceClip(n.source_clipboard_id);
    setEditorOpen(true);
  };

  const handleImagePick = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setNoteImage(dataUrl);
      setNoteText('');
    };
    reader.readAsDataURL(file);
  };

  const handleSaveNote = async () => {
    const hasImage = !!noteImage;
    const hasText  = noteText.trim().length > 0;
    if (!hasImage && !hasText) {
      showToast('İçerik boş olamaz', 'error');
      return;
    }
    const payload = {
      content_type: (hasImage ? 'image' : 'text') as 'image' | 'text',
      content: hasImage ? (noteImage as string) : noteText.trim(),
      title: noteTitle.trim() || undefined,
      source_clipboard_id: noteSourceClip ?? undefined,
    };
    try {
      if (editingId) {
        const updated = await memoryApi.updateNote(editingId, payload);
        setNotes((prev) => [updated, ...prev.filter((n) => n.id !== editingId)]);
      } else {
        const created = await memoryApi.createNote(payload);
        setNotes((prev) => [created, ...prev]);
      }
      setEditorOpen(false);
      showToast('Not kaydedildi', 'success');
    } catch {
      showToast('Not kaydedilemedi', 'error');
    }
  };

  const handleDeleteNote = async (id: number) => {
    await memoryApi.deleteNote(id).catch(() => {});
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  const handlePushToTask = async (noteId: number, taskId: number) => {
    try {
      await memoryApi.pushNoteToTask(noteId, taskId, true);
      showToast('Göreve eklendi', 'success');
      setPushingNoteId(null);
    } catch {
      showToast('Göreve eklenemedi', 'error');
    }
  };

  const sortedClips = useMemo(
    () => [...clips].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [clips],
  );

  // Bottom input for brainstorm quick-note
  const [quickNoteText, setQuickNoteText] = useState('');
  const quickNoteRef = useRef<HTMLTextAreaElement>(null);

  const handleQuickNote = async () => {
    const text = quickNoteText.trim();
    if (!text) return;
    const payload = { content_type: 'text' as const, content: text };
    try {
      const created = await memoryApi.createNote(payload);
      setNotes((prev) => [created, ...prev]);
      setQuickNoteText('');
      showToast('Not kaydedildi', 'success');
    } catch {
      showToast('Not kaydedilemedi', 'error');
    }
  };

  return (
    <div className="h-full flex flex-col page-transition">
      <div className="flex-1 overflow-y-auto p-6">
        {/* Page header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-accent-yellow/15">
            <Lightbulb size={24} className="text-accent-yellow" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-text-primary">Düşünceler</h1>
            <p className="text-sm text-text-muted">Kopyaladıkların burada birikiyor. Fikirlerini nota, notları görevlere dönüştür.</p>
          </div>
        </div>

        {/* Tab selector */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setActiveTab('memory')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-sm font-semibold transition-all ${
              activeTab === 'memory'
                ? 'bg-accent-red/20 text-accent-red border border-accent-red/30'
                : 'bg-bg-card border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
            }`}
          >
            <Brain size={18} className={activeTab === 'memory' ? 'text-accent-red' : ''} />
            Hafıza
          </button>
          <button
            onClick={() => setActiveTab('brainstorm')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-sm font-semibold transition-all ${
              activeTab === 'brainstorm'
                ? 'bg-accent-pink/20 text-accent-pink border border-accent-pink/30'
                : 'bg-bg-card border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
            }`}
          >
            <BrainCircuit size={18} className={activeTab === 'brainstorm' ? 'text-accent-pink' : ''} />
            Beyin Fırtınası
          </button>
        </div>

        {/* ─── Hafıza ─ Clipboard section ───────────────────────────────── */}
        {activeTab === 'memory' && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Copy size={16} className="text-accent-red" /> Kopyalananlar
              <span className="text-xs text-text-muted font-normal">({sortedClips.length})</span>
            </h2>
            {sortedClips.length > PREVIEW_CLIP_COUNT && (
              <button
                onClick={() => setShowAllClips((v) => !v)}
                className="text-xs font-medium px-3 py-1.5 rounded-btn bg-accent-red/10 text-accent-red border border-accent-red/30 hover:bg-accent-red/20 transition-colors"
              >
                {showAllClips ? 'Daha az göster' : `Tümünü gör (${sortedClips.length})`}
              </button>
            )}
          </div>
          {sortedClips.length === 0 ? (
            loading ? (
              <div className="bg-bg-card border border-border rounded-card p-8 text-center text-text-muted text-sm">Yükleniyor...</div>
            ) : (
              <EmptyState
                icon={Clipboard}
                title="Henüz kopyalama yok"
                description="Ctrl+C ile bir şey kopyaladığında burada görünecek."
              />
            )
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {(showAllClips ? sortedClips : sortedClips.slice(0, PREVIEW_CLIP_COUNT)).map((c) => (
                  <ClipCard
                    key={c.id}
                    item={c}
                    onCopy={() => handleCopyClip(c)}
                    onDelete={() => handleDeleteClip(c.id)}
                    onToNote={() => handleClipToNote(c)}
                  />
                ))}
              </div>
              <div className="flex justify-end mt-4">
                <button
                  onClick={handleClearAllClips}
                  className="flex items-center gap-1.5 text-xs text-text-muted hover:text-accent-red hover:bg-accent-red/10 border border-border hover:border-accent-red/30 px-3 py-1.5 rounded-btn transition-colors"
                >
                  <Trash2 size={12} /> Tümünü temizle
                </button>
              </div>
            </>
          )}
        </section>
        )}

        {/* ─── Beyin Fırtınası ─ Notes section (list layout) ───────────── */}
        {activeTab === 'brainstorm' && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <BrainCircuit size={16} className="text-accent-pink" /> Notlar
              <span className="text-xs text-text-muted font-normal">({notes.length})</span>
            </h2>
          </div>

          {notes.length === 0 ? (
            <EmptyState
              icon={StickyNote}
              title="Henüz not yok"
              description="Aşağıdan aklındakini yaz, Enter ile kaydet."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {notes.map((n) => (
                <NoteListRow
                  key={n.id}
                  note={n}
                  tasks={tasks}
                  isPushing={pushingNoteId === n.id}
                  onStartPush={() => setPushingNoteId(n.id)}
                  onCancelPush={() => setPushingNoteId(null)}
                  onPushToTask={(taskId) => handlePushToTask(n.id, taskId)}
                  onEdit={() => openEditNote(n)}
                  onDelete={() => handleDeleteNote(n.id)}
                  onCopy={() => copyToClipboard(n).then((ok) =>
                    showToast(ok ? 'Panoya kopyalandı' : 'Kopyalanamadı', ok ? 'success' : 'error'))}
                />
              ))}
            </div>
          )}
        </section>
        )}
      </div>

      {/* ─── Bottom quick-input (Beyin Fırtınası only) ────────────────── */}
      {activeTab === 'brainstorm' && (
        <div className="flex-shrink-0 px-4 pb-20 pt-2">
          <div className="glass-heavy border border-white/10 rounded-2xl px-4 py-3 flex items-end gap-3 shadow-nav">
            <MessageSquare size={18} className="text-accent-pink flex-shrink-0 mb-0.5" />
            <textarea
              ref={quickNoteRef}
              value={quickNoteText}
              onChange={(e) => setQuickNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleQuickNote();
                }
              }}
              placeholder="Aklındakini yaz… (Enter ile kaydet)"
              rows={1}
              className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-text-primary placeholder:text-text-muted leading-relaxed"
              style={{ maxHeight: 120, overflowY: 'auto' }}
            />
            <button
              onClick={handleQuickNote}
              disabled={!quickNoteText.trim()}
              className="flex-shrink-0 w-8 h-8 rounded-xl bg-accent-pink/20 text-accent-pink border border-accent-pink/40 flex items-center justify-center hover:bg-accent-pink/30 transition-colors disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}

      {editorOpen && (
        <NoteEditor
          title={noteTitle}
          text={noteText}
          image={noteImage}
          isEditing={!!editingId}
          onTitleChange={setNoteTitle}
          onTextChange={(v) => { setNoteText(v); if (v) setNoteImage(null); }}
          onImagePick={handleImagePick}
          onImageClear={() => setNoteImage(null)}
          onCancel={() => setEditorOpen(false)}
          onSave={handleSaveNote}
        />
      )}
    </div>
  );
}

// ───────── Subcomponents ─────────────────────────────────────────────────

function ClipCard({
  item, onCopy, onDelete, onToNote,
}: {
  item: ClipboardItemType; onCopy: () => void; onDelete: () => void; onToNote: () => void;
}) {
  const isImg = isImageContent(item.content, item.content_type);
  return (
    <div className="relative group bg-bg-card border border-border rounded-card p-3 shadow-card hover:border-accent-blue/40 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[10px] text-text-muted">{formatRelative(item.created_at)}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onToNote}
            title="Nota dönüştür"
            className="p-1 rounded hover:bg-accent-pink/15 text-text-muted hover:text-accent-pink"
          >
            <BrainCircuit size={13} />
          </button>
          <button
            onClick={onDelete}
            title="Sil"
            className="p-1 rounded hover:bg-accent-red/15 text-text-muted hover:text-accent-red"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="pr-8 min-h-[40px]">
        {isImg ? (
          <img src={item.content} alt="clipboard" className="max-h-40 w-auto rounded-md border border-border" />
        ) : (
          <p className="text-sm text-text-primary whitespace-pre-wrap break-words line-clamp-6">{item.content}</p>
        )}
      </div>
      <button
        onClick={onCopy}
        title="Kopyala"
        className="absolute bottom-2 right-2 w-7 h-7 rounded-lg bg-accent-blue/15 hover:bg-accent-blue/30 text-accent-blue border border-accent-blue/30 flex items-center justify-center transition-colors"
      >
        <Copy size={13} />
      </button>
    </div>
  );
}

function NoteCard({
  note, tasks, isPushing, onStartPush, onCancelPush, onPushToTask, onEdit, onDelete, onCopy,
}: {
  note: BrainstormNote;
  tasks: Task[];
  isPushing: boolean;
  onStartPush: () => void;
  onCancelPush: () => void;
  onPushToTask: (taskId: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const isImg = isImageContent(note.content, note.content_type);
  return (
    <div className="relative group bg-bg-card border border-border rounded-card p-3 shadow-card hover:border-accent-pink/40 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          {note.title && <p className="text-sm font-semibold text-text-primary truncate">{note.title}</p>}
          <span className="text-[10px] text-text-muted">{formatRelative(note.updated_at)}</span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onCopy}   title="Kopyala" className="p-1 rounded hover:bg-accent-blue/15 text-text-muted hover:text-accent-blue"><Copy size={13} /></button>
          <button onClick={onEdit}   title="Düzenle" className="p-1 rounded hover:bg-accent-cyan/15 text-text-muted hover:text-accent-cyan"><Pencil size={13} /></button>
          <button onClick={onStartPush} title="Göreve gönder" className="p-1 rounded hover:bg-accent-green/15 text-text-muted hover:text-accent-green"><Send size={13} /></button>
          <button onClick={onDelete} title="Sil"     className="p-1 rounded hover:bg-accent-red/15 text-text-muted hover:text-accent-red"><Trash2 size={13} /></button>
        </div>
      </div>
      <div>
        {isImg ? (
          <img src={note.content} alt="note" className="max-h-40 w-auto rounded-md border border-border" />
        ) : (
          <p className="text-sm text-text-primary whitespace-pre-wrap break-words line-clamp-8">{note.content}</p>
        )}
      </div>
      {isPushing && (
        <div className="mt-3 border-t border-border-subtle pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-secondary">Hangi göreve eklenecek?</span>
            <button onClick={onCancelPush} className="text-text-muted hover:text-text-primary"><X size={14} /></button>
          </div>
          <div className="max-h-44 overflow-y-auto space-y-1">
            {tasks.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-2">Henüz görev yok.</p>
            ) : tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => onPushToTask(t.id)}
                className="w-full text-left px-2 py-1.5 rounded-md bg-bg-input hover:bg-accent-green/15 hover:text-accent-green text-xs text-text-primary transition-colors flex items-center justify-between gap-2"
              >
                <span className="truncate">{t.title}</span>
                <Check size={12} className="opacity-0 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NoteListRow({
  note, tasks, isPushing, onStartPush, onCancelPush, onPushToTask, onEdit, onDelete, onCopy,
}: {
  note: BrainstormNote;
  tasks: Task[];
  isPushing: boolean;
  onStartPush: () => void;
  onCancelPush: () => void;
  onPushToTask: (taskId: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const isImg = isImageContent(note.content, note.content_type);
  return (
    <div className="group bg-bg-card border border-border rounded-card p-3 hover:border-accent-pink/40 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-text-muted">{formatRelative(note.updated_at)}</span>
            {note.title && <span className="text-xs font-semibold text-text-primary truncate">{note.title}</span>}
          </div>
          {isImg ? (
            <img src={note.content} alt="note" className="max-h-32 w-auto rounded-md border border-border" />
          ) : (
            <p className="text-sm text-text-primary whitespace-pre-wrap break-words line-clamp-4">{note.content}</p>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={onCopy}      title="Kopyala"       className="p-1.5 rounded hover:bg-accent-blue/15 text-text-muted hover:text-accent-blue"><Copy size={13} /></button>
          <button onClick={onEdit}      title="Düzenle"       className="p-1.5 rounded hover:bg-accent-cyan/15 text-text-muted hover:text-accent-cyan"><Pencil size={13} /></button>
          <button onClick={onStartPush} title="Göreve gönder" className="p-1.5 rounded hover:bg-accent-green/15 text-text-muted hover:text-accent-green"><Send size={13} /></button>
          <button onClick={onDelete}    title="Sil"           className="p-1.5 rounded hover:bg-accent-red/15 text-text-muted hover:text-accent-red"><Trash2 size={13} /></button>
        </div>
      </div>
      {isPushing && (
        <div className="mt-3 border-t border-border-subtle pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-secondary">Hangi göreve eklenecek?</span>
            <button onClick={onCancelPush} className="text-text-muted hover:text-text-primary"><X size={14} /></button>
          </div>
          <div className="max-h-44 overflow-y-auto space-y-1">
            {tasks.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-2">Henüz görev yok.</p>
            ) : tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => onPushToTask(t.id)}
                className="w-full text-left px-2 py-1.5 rounded-md bg-bg-input hover:bg-accent-green/15 hover:text-accent-green text-xs text-text-primary transition-colors flex items-center justify-between gap-2"
              >
                <span className="truncate">{t.title}</span>
                <Check size={12} className="opacity-0 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NoteEditor({
  title, text, image, isEditing, onTitleChange, onTextChange, onImagePick, onImageClear, onCancel, onSave,
}: {
  title: string; text: string; image: string | null; isEditing: boolean;
  onTitleChange: (v: string) => void; onTextChange: (v: string) => void;
  onImagePick: (f: File) => void; onImageClear: () => void;
  onCancel: () => void; onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-bg-card border border-border rounded-card shadow-card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">{isEditing ? 'Notu Düzenle' : 'Yeni Not'}</h3>
          <button onClick={onCancel} className="text-text-muted hover:text-text-primary"><X size={16} /></button>
        </div>
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Başlık (opsiyonel)"
          className="w-full mb-3 px-3 py-2 bg-bg-input border border-border rounded-btn text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-pink"
        />
        {image ? (
          <div className="mb-3 relative">
            <img src={image} alt="note" className="w-full max-h-64 object-contain rounded-md border border-border bg-bg-input" />
            <button
              onClick={onImageClear}
              className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white hover:bg-accent-red flex items-center justify-center"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            rows={6}
            placeholder="Not içeriği..."
            className="w-full mb-3 px-3 py-2 bg-bg-input border border-border rounded-btn text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-pink resize-none"
          />
        )}
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs text-text-muted hover:text-accent-pink cursor-pointer px-2 py-1.5 rounded-btn hover:bg-accent-pink/10">
            <ImagePlus size={14} />
            Görsel ekle
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImagePick(f); }}
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary rounded-btn hover:bg-bg-hover transition-colors"
            >
              İptal
            </button>
            <button
              onClick={onSave}
              className="px-3 py-1.5 text-xs font-medium bg-accent-pink/20 text-accent-pink border border-accent-pink/40 rounded-btn hover:bg-accent-pink/30 transition-colors"
            >
              Kaydet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
