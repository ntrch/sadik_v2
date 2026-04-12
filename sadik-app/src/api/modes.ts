import http from './http';

export interface ModeLog {
  id: number;
  mode: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
}

export interface CurrentMode {
  mode: string | null;
  started_at?: string;
}

export const modesApi = {
  getCurrent: () => http.get<CurrentMode>('/api/modes/current').then((r) => r.data),
  setMode: (mode: string) => http.post<ModeLog>('/api/modes', { mode }).then((r) => r.data),
  endCurrent: () => http.post('/api/modes/end').then((r) => r.data),
  getHistory: () => http.get<ModeLog[]>('/api/modes/history').then((r) => r.data),
};
