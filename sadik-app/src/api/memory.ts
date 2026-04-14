import http from './http';

export interface ClipboardItem {
  id: number;
  content_type: 'text' | 'image';
  content: string;
  content_hash: string | null;
  created_at: string;
}

export interface BrainstormNote {
  id: number;
  content_type: 'text' | 'image';
  content: string;
  title: string | null;
  source_clipboard_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface BrainstormNoteCreate {
  content_type: 'text' | 'image';
  content: string;
  title?: string;
  source_clipboard_id?: number;
}

export interface BrainstormNoteUpdate {
  content_type?: 'text' | 'image';
  content?: string;
  title?: string;
}

export const memoryApi = {
  listClipboard: (limit = 200) =>
    http.get<ClipboardItem[]>('/api/memory/clipboard', { params: { limit } }).then((r) => r.data),
  deleteClipboard: (id: number) => http.delete(`/api/memory/clipboard/${id}`),
  clearClipboard: () => http.delete('/api/memory/clipboard'),

  listNotes: () => http.get<BrainstormNote[]>('/api/memory/notes').then((r) => r.data),
  createNote: (data: BrainstormNoteCreate) =>
    http.post<BrainstormNote>('/api/memory/notes', data).then((r) => r.data),
  updateNote: (id: number, data: BrainstormNoteUpdate) =>
    http.put<BrainstormNote>(`/api/memory/notes/${id}`, data).then((r) => r.data),
  deleteNote: (id: number) => http.delete(`/api/memory/notes/${id}`),
  pushNoteToTask: (noteId: number, taskId: number, append = true) =>
    http
      .post<{ success: boolean; task_id: number }>(`/api/memory/notes/${noteId}/push-to-task`, {
        task_id: taskId,
        append,
      })
      .then((r) => r.data),
};
