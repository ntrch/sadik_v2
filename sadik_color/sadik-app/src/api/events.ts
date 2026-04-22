import http from './http';

export type EventColor = 'purple' | 'cyan' | 'orange' | 'yellow' | 'red' | 'green' | 'pink';

export interface CalendarEvent {
  id: number;
  title: string;
  description: string | null;
  guests: string | null;
  color: EventColor;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventCreate {
  title: string;
  description?: string | null;
  guests?: string | null;
  color?: EventColor;
  starts_at: string;     // ISO datetime
  ends_at?: string | null;
}

export interface EventUpdate {
  title?: string;
  description?: string | null;
  guests?: string | null;
  color?: EventColor;
  starts_at?: string;
  ends_at?: string | null;
}

export const eventsApi = {
  list: (start?: string, end?: string) =>
    http.get<CalendarEvent[]>('/api/events', { params: { start, end } }).then((r) => r.data),
  create: (data: EventCreate) =>
    http.post<CalendarEvent>('/api/events', data).then((r) => r.data),
  update: (id: number, data: EventUpdate) =>
    http.patch<CalendarEvent>(`/api/events/${id}`, data).then((r) => r.data),
  remove: (id: number) =>
    http.delete<{ ok: boolean }>(`/api/events/${id}`).then((r) => r.data),
};
