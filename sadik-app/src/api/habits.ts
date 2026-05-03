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
  // S3.5 new fields
  color: string;            // hex e.g. '#fdba74'
  icon: string;             // lucide key e.g. 'repeat'
  target_days: number;      // default 66
  frequency_type: 'daily' | 'interval';
  interval_minutes: number | null;
}

export interface HabitCreate {
  name: string;
  description?: string | null;
  days_of_week?: number[];
  time?: string;
  minutes_before?: number;
  enabled?: boolean;
  respect_dnd?: boolean;
  color?: string;
  icon?: string;
  target_days?: number;
  frequency_type?: 'daily' | 'interval';
  interval_minutes?: number | null;
}

export interface HabitUpdate {
  name?: string;
  description?: string | null;
  days_of_week?: number[];
  time?: string;
  minutes_before?: number;
  enabled?: boolean;
  respect_dnd?: boolean;
  color?: string;
  icon?: string;
  target_days?: number;
  frequency_type?: 'daily' | 'interval';
  interval_minutes?: number | null;
}

export interface HabitLog {
  id: number;
  habit_id: number;
  log_date: string;         // YYYY-MM-DD
  status: 'done' | 'skipped' | 'snoozed';
  completed_at: string | null;
  snoozed_until: string | null;
  created_at: string;
}

export interface HabitLogCreate {
  status: 'done' | 'skipped' | 'snoozed';
  snoozed_until?: string | null;
  log_date?: string | null;
}

export interface HabitDue {
  habit: Habit;
  is_due_now: boolean;
  next_trigger_at: string | null;
  today_status: 'done' | 'skipped' | 'snoozed' | null;
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
  // S3.5 new methods
  log: (id: number, body: HabitLogCreate) =>
    http.post<HabitLog>(`/api/habits/${id}/log`, body).then((r) => r.data),
  snooze: (id: number, minutes: number) =>
    http.patch<HabitLog>(`/api/habits/${id}/snooze`, { minutes }).then((r) => r.data),
  getLogs: (from: string, to: string) =>
    http.get<HabitLog[]>('/api/habits/logs', { params: { from, to } }).then((r) => r.data),
  getDue: () =>
    http.get<HabitDue[]>('/api/habits/due').then((r) => r.data),
};
