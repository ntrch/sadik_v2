import http from './http';

export interface Task {
  id: number;
  title: string;
  description: string | null;
  notes: string | null;
  status: string;
  priority: number;
  created_at: string;
  updated_at: string;
  due_date: string | null;
  pomodoro_count: number;
}

export interface TaskCreate {
  title: string;
  description?: string;
  notes?: string;
  due_date?: string;
  priority?: number;
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  notes?: string;
  due_date?: string | null;
  priority?: number;
  status?: string;
}

export const tasksApi = {
  list: (status?: string) =>
    http.get<Task[]>('/api/tasks', { params: status ? { status } : {} }).then((r) => r.data),
  get: (id: number) => http.get<Task>(`/api/tasks/${id}`).then((r) => r.data),
  create: (data: TaskCreate) => http.post<Task>('/api/tasks', data).then((r) => r.data),
  update: (id: number, data: TaskUpdate) =>
    http.put<Task>(`/api/tasks/${id}`, data).then((r) => r.data),
  delete: (id: number) => http.delete(`/api/tasks/${id}`),
  updateStatus: (id: number, status: string) =>
    http.patch<Task>(`/api/tasks/${id}/status`, { status }).then((r) => r.data),
};
