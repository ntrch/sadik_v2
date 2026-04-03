import http from './http';

export type Settings = Record<string, string>;

export const settingsApi = {
  getAll: () => http.get<Settings>('/api/settings').then((r) => r.data),
  update: (data: Settings) => http.put<Settings>('/api/settings', data).then((r) => r.data),
  get: (key: string) =>
    http.get<{ key: string; value: string }>(`/api/settings/${key}`).then((r) => r.data),
};
