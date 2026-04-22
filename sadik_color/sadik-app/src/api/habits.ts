import http from './http';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Habit {
  id: number;
  name: string;
  description: string | null;
  days_of_week: number[];   // 0=Mon … 6=Sun
  time: string;             // HH:MM (24h)
  minutes_before: number;   // 0-120
  enabled: boolean;
  respect_dnd: boolean;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HabitCreate {
  name: string;
  description?: string | null;
  days_of_week: number[];
  time: string;
  minutes_before?: number;
  enabled?: boolean;
  respect_dnd?: boolean;
}

export interface HabitUpdate {
  name?: string;
  description?: string | null;
  days_of_week?: number[];
  time?: string;
  minutes_before?: number;
  enabled?: boolean;
  respect_dnd?: boolean;
}

// ── API client ─────────────────────────────────────────────────────────────────

export const habitsApi = {
  list: () =>
    http.get<Habit[]>('/api/habits').then((r) => r.data),
  get: (id: number) =>
    http.get<Habit>(`/api/habits/${id}`).then((r) => r.data),
  create: (data: HabitCreate) =>
    http.post<Habit>('/api/habits', data).then((r) => r.data),
  update: (id: number, data: HabitUpdate) =>
    http.patch<Habit>(`/api/habits/${id}`, data).then((r) => r.data),
  remove: (id: number) =>
    http.delete<{ ok: boolean }>(`/api/habits/${id}`).then((r) => r.data),
};
