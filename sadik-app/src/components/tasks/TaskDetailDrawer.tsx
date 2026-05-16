import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X, Trash2, Bold, Italic, List, ListOrdered, CheckSquare, Code, Quote, Image as ImageIcon, Heading1, Heading2, Heading3, Smile, Upload } from 'lucide-react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';

import { Task, TaskUpdate, tasksApi } from '../../api/tasks';
import { AppContext } from '../../context/AppContext';
import { ICON_CATEGORIES, getIconByKey } from '../../utils/modeIcons';

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
  task: Task;
  onClose: () => void;
  onSaved: () => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Parse notes field into TipTap-compatible JSON doc. Legacy plaintext notes
 *  (stored before the rich editor migration) get wrapped in a paragraph so
 *  nothing is lost.  Returns empty doc when notes is null / empty. */
function parseNotesToDoc(notes: string | null | undefined): object {
  if (!notes || !notes.trim()) return { type: 'doc', content: [{ type: 'paragraph' }] };
  try {
    const parsed = JSON.parse(notes);
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') return parsed;
  } catch { /* fall through → legacy plaintext */ }
  const paragraphs = notes.split(/\n{2,}/).map((chunk) => ({
    type: 'paragraph',
    content: chunk.trim()
      ? [{ type: 'text', text: chunk.replace(/\n/g, ' ') }]
      : undefined,
  }));
  return { type: 'doc', content: paragraphs.length ? paragraphs : [{ type: 'paragraph' }] };
}

function ToolbarButton({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? 'bg-accent-purple/20 text-accent-purple'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
      }`}
    >
      {children}
    </button>
  );
}

function EditorToolbar({ editor }: { editor: Editor | null }) {
  const fileRef = useRef<HTMLInputElement>(null);
  if (!editor) return null;

  const handleImageUpload = () => fileRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('Görsel 2MB\'dan büyük olamaz.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        editor.chain().focus().setImage({ src: reader.result }).run();
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex items-center gap-0.5 flex-wrap px-4 py-1.5 border-b border-border bg-bg-card/40">
      <ToolbarButton active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Başlık 1">
        <Heading1 size={15} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Başlık 2">
        <Heading2 size={15} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Başlık 3">
        <Heading3 size={15} />
      </ToolbarButton>
      <div className="w-px h-4 bg-border mx-1" />
      <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Kalın">
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="İtalik">
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title="Satır içi kod">
        <Code size={14} />
      </ToolbarButton>
      <div className="w-px h-4 bg-border mx-1" />
      <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Madde işareti">
        <List size={14} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numaralı liste">
        <ListOrdered size={14} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} title="Yapılacaklar listesi">
        <CheckSquare size={14} />
      </ToolbarButton>
      <div className="w-px h-4 bg-border mx-1" />
      <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Alıntı">
        <Quote size={14} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Kod bloğu">
        <Code size={14} />
      </ToolbarButton>
      <ToolbarButton onClick={handleImageUpload} title="Görsel ekle">
        <ImageIcon size={14} />
      </ToolbarButton>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
    </div>
  );
}

export default function TaskDetailDrawer({ task, onClose, onSaved }: Props) {
  const { showToast, triggerEvent } = useContext(AppContext);

  // Meta state — separate from the editor, saves on blur / change
  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [dueDate, setDueDate] = useState(
    task.due_date ? task.due_date.split('T')[0] : ''
  );
  const [dueTime, setDueTime] = useState(
    task.due_date && task.due_date.includes('T')
      ? task.due_date.split('T')[1]?.slice(0, 5) || ''
      : ''
  );

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Icon picker state
  type IconTab = 'none' | 'preset' | 'custom';
  const [iconTab, setIconTab] = useState<IconTab>('none');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [taskIcon, setTaskIcon] = useState<string | null>(task.icon ?? null);
  const [taskIconImage, setTaskIconImage] = useState<string | null>(task.icon_image ?? null);
  const [iconSearch, setIconSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveTimerRef = useRef<number | null>(null);
  const latestRef = useRef<TaskUpdate>({});
  const taskIdRef = useRef(task.id);
  taskIdRef.current = task.id;

  const initialDoc = useMemo(() => parseNotesToDoc(task.notes), [task.id]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Image.configure({ inline: false, allowBase64: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Notları buraya yaz — / kısayolları, görseller, yapılacaklar…' }),
    ],
    content: initialDoc,
    editorProps: {
      attributes: {
        class: 'focus:outline-none px-8 py-6 max-w-none',
      },
    },
    onUpdate: ({ editor: ed }) => {
      scheduleSave({ notes: JSON.stringify(ed.getJSON()) });
    },
  }, [task.id]);

  // ── Persist helpers ───────────────────────────────────────────────────────
  const flushSave = useCallback(async () => {
    const payload = latestRef.current;
    if (!Object.keys(payload).length) return;
    latestRef.current = {};
    setSaveState('saving');
    try {
      await tasksApi.update(taskIdRef.current, payload);
      setSaveState('saved');
      onSaved();
      window.setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1200);
    } catch (err) {
      console.error('Drawer save failed', err);
      setSaveState('error');
      showToast('Kaydedilemedi', 'error');
    }
  }, [onSaved, showToast]);

  const scheduleSave = useCallback((patch: TaskUpdate) => {
    latestRef.current = { ...latestRef.current, ...patch };
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushSave, 500);
  }, [flushSave]);

  // ── Meta handlers ─────────────────────────────────────────────────────────
  const handleTitleBlur = () => {
    const trimmed = title.trim();
    if (!trimmed) { setTitle(task.title); return; }
    if (trimmed !== task.title) scheduleSave({ title: trimmed });
  };

  const handleStatusChange = (v: string) => {
    setStatus(v);
    scheduleSave({ status: v });
    triggerEvent('task.completed');
  };

  const handlePriorityChange = (v: number) => {
    setPriority(v);
    scheduleSave({ priority: v });
  };

  const handleDueChange = (d: string, t: string) => {
    const full = d ? (t ? `${d}T${t}:00` : `${d}T23:59:00`) : null;
    scheduleSave({ due_date: full });
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await tasksApi.delete(task.id);
      triggerEvent('task.completed');
      onSaved();
      onClose();
    } catch {
      showToast('Silinemedi', 'error');
    }
    setDeleting(false);
  };

  // ── Icon handlers ─────────────────────────────────────────────────────────
  const handleSelectPresetIcon = (key: string) => {
    setTaskIcon(key);
    setTaskIconImage(null);
    scheduleSave({ icon: key, icon_image: null });
    setIconPickerOpen(false);
  };

  const handleClearIcon = () => {
    setTaskIcon(null);
    setTaskIconImage(null);
    scheduleSave({ icon: null, icon_image: null });
    setIconPickerOpen(false);
  };

  const handleCustomImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const MAX = 256 * 1024; // 256 KB
    if (file.size > MAX) {
      alert('Görsel 256KB\'dan büyük olamaz.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setTaskIcon(null);
      setTaskIconImage(dataUrl);
      scheduleSave({ icon: null, icon_image: dataUrl });
      setIconPickerOpen(false);
    };
    reader.readAsDataURL(file);
  };

  const filteredIconCategories = iconSearch.trim()
    ? ICON_CATEGORIES.map((c) => ({
        ...c,
        icons: c.icons.filter(({ key }) => key.includes(iconSearch.toLowerCase())),
      })).filter((c) => c.icons.length > 0)
    : ICON_CATEGORIES;

  // ── Lifecycle: flush pending save on close / unmount ──────────────────────
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (Object.keys(latestRef.current).length) flushSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Don't close if user is typing inside an input that isn't an editable content area
        const active = document.activeElement as HTMLElement | null;
        const tag = active?.tagName;
        if (tag === 'INPUT' || tag === 'SELECT') { active?.blur(); return; }
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const saveLabel = {
    idle: '',
    saving: 'Kaydediliyor…',
    saved: 'Kaydedildi',
    error: 'Kaydedilemedi',
  }[saveState];

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className="w-full max-w-[560px] h-full bg-bg-card border-l border-border shadow-2xl flex flex-col animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span>Görev · #{task.id}</span>
            {saveLabel && (
              <span className={saveState === 'error' ? 'text-accent-red' : 'text-text-secondary'}>
                {saveLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleDelete}
              disabled={deleting}
              title={confirmDelete ? 'Tekrar tıklayarak sil' : 'Görevi sil'}
              className={`p-1.5 rounded-md transition-colors ${
                confirmDelete
                  ? 'bg-accent-red text-white'
                  : 'text-text-muted hover:text-accent-red hover:bg-accent-red/10'
              }`}
            >
              <Trash2 size={15} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Title */}
        <div className="px-8 pt-6 pb-2">
          <div className="flex items-center gap-3 mb-2">
            {/* Icon preview + toggle button */}
            <button
              type="button"
              onClick={() => setIconPickerOpen((v) => !v)}
              title="İkon seç"
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-bg-hover hover:bg-bg-card transition-colors flex-shrink-0"
            >
              {taskIconImage ? (
                <img src={taskIconImage} alt="" className="w-5 h-5 rounded-sm object-cover" />
              ) : taskIcon && getIconByKey(taskIcon) ? (
                (() => { const IC = getIconByKey(taskIcon)!; return <IC size={16} className="text-text-secondary" />; })()
              ) : (
                <Smile size={15} className="text-text-muted" />
              )}
            </button>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
              placeholder="Başlıksız görev"
              className="flex-1 bg-transparent text-2xl font-bold text-text-primary outline-none placeholder-text-muted"
            />
          </div>

          {/* Icon picker panel */}
          {iconPickerOpen && (
            <div className="mb-3 border border-border rounded-xl bg-bg-card shadow-card overflow-hidden">
              {/* Tabs */}
              <div className="flex border-b border-border">
                {([['none', 'İkonsuz'], ['preset', 'Hazır İkonlar'], ['custom', 'Özel Görsel']] as [IconTab, string][]).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setIconTab(tab)}
                    className={`flex-1 py-2 text-xs font-medium transition-colors ${
                      iconTab === tab
                        ? 'text-accent-purple border-b-2 border-accent-purple bg-accent-purple/5'
                        : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="p-3">
                {iconTab === 'none' && (
                  <div className="text-center py-3">
                    <p className="text-xs text-text-muted mb-3">Bu görev için ikon kullanma.</p>
                    <button
                      type="button"
                      onClick={handleClearIcon}
                      className="px-4 py-1.5 text-xs rounded-btn bg-bg-hover border border-border text-text-primary hover:bg-bg-card transition-colors"
                    >
                      İkonu Temizle
                    </button>
                  </div>
                )}

                {iconTab === 'preset' && (
                  <div>
                    <input
                      type="text"
                      placeholder="İkon ara…"
                      value={iconSearch}
                      onChange={(e) => setIconSearch(e.target.value)}
                      className="w-full mb-2 px-2 py-1.5 text-xs rounded-md bg-bg-hover border border-border text-text-primary outline-none placeholder-text-muted focus:border-border-focus"
                    />
                    <div className="max-h-52 overflow-y-auto">
                      {filteredIconCategories.map((cat) => (
                        <div key={cat.name} className="mb-2">
                          <div className="text-[9px] uppercase tracking-wider text-text-muted mb-1">{cat.name}</div>
                          <div className="grid grid-cols-8 gap-0.5">
                            {cat.icons.map(({ key, Icon }) => {
                              const selected = key === taskIcon;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  title={key}
                                  onClick={() => handleSelectPresetIcon(key)}
                                  className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors border ${
                                    selected
                                      ? 'bg-accent-purple/20 border-accent-purple text-accent-purple'
                                      : 'border-transparent text-text-muted hover:bg-bg-hover hover:text-text-primary'
                                  }`}
                                >
                                  <Icon size={14} />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {iconTab === 'custom' && (
                  <div className="text-center py-2">
                    {taskIconImage && (
                      <div className="mb-3 flex justify-center">
                        <img src={taskIconImage} alt="" className="w-12 h-12 rounded-lg object-cover border border-border" />
                      </div>
                    )}
                    <p className="text-xs text-text-muted mb-3">Görseli yükle (maks. 256 KB).</p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-btn bg-bg-hover border border-border text-text-primary hover:bg-bg-card transition-colors mx-auto"
                    >
                      <Upload size={12} /> Görsel Seç
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleCustomImageFile}
                    />
                    {taskIconImage && (
                      <button
                        type="button"
                        onClick={handleClearIcon}
                        className="mt-2 text-xs text-text-muted hover:text-accent-red transition-colors"
                      >
                        Kaldır
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Meta row */}
        <div className="px-8 pb-4 grid grid-cols-[100px_1fr] gap-x-4 gap-y-2 text-sm">
          <span className="text-text-muted self-center">Durum</span>
          <select
            value={status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="bg-transparent border border-border rounded-md px-2 py-1 text-text-primary outline-none focus:border-border-focus hover:bg-bg-hover transition-colors"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <span className="text-text-muted self-center">Öncelik</span>
          <select
            value={priority}
            onChange={(e) => handlePriorityChange(Number(e.target.value))}
            className="bg-transparent border border-border rounded-md px-2 py-1 text-text-primary outline-none focus:border-border-focus hover:bg-bg-hover transition-colors"
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <span className="text-text-muted self-center">Teslim</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => { setDueDate(e.target.value); handleDueChange(e.target.value, dueTime); }}
              className="bg-transparent border border-border rounded-md px-2 py-1 text-text-primary outline-none focus:border-border-focus hover:bg-bg-hover transition-colors"
            />
            <input
              type="time"
              value={dueTime}
              disabled={!dueDate}
              onChange={(e) => { setDueTime(e.target.value); handleDueChange(dueDate, e.target.value); }}
              className="bg-transparent border border-border rounded-md px-2 py-1 text-text-primary outline-none focus:border-border-focus hover:bg-bg-hover transition-colors disabled:opacity-40"
            />
            {dueDate && (
              <button
                onClick={() => { setDueDate(''); setDueTime(''); handleDueChange('', ''); }}
                className="text-text-muted hover:text-accent-red transition-colors"
                title="Temizle"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="h-px bg-border mx-4" />

        {/* Editor */}
        <EditorToolbar editor={editor} />
        <div className="flex-1 overflow-y-auto tiptap-editor">
          <EditorContent editor={editor} className="h-full" />
        </div>

        <div className="px-4 py-2 text-[11px] text-text-muted border-t border-border flex justify-between">
          <span>Oluşturulma: {new Date(task.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          {task.pomodoro_count > 0 && <span>🔥 {task.pomodoro_count} pomodoro</span>}
        </div>
      </div>
    </div>
  );
}
