import http from './http';

export interface ModeStat {
  mode: string;
  total_seconds: number;
}

export interface DayStat {
  date: string;
  modes: ModeStat[];
}

export const statsApi = {
  daily: (date?: string) =>
    http.get<ModeStat[]>('/api/stats/daily', { params: date ? { date } : {} }).then((r) => r.data),
  range: (days: 7 | 14 | 30) =>
    http.get<DayStat[]>('/api/stats/range', { params: { days } }).then((r) => r.data),
};
