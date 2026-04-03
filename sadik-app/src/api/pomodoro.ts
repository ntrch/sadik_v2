import http from './http';

export interface PomodoroState {
  is_running: boolean;
  is_paused: boolean;
  remaining_seconds: number;
  total_seconds: number;
  current_session: number;
  task_id: number | null;
  phase: 'work' | 'break' | 'long_break' | 'idle';
}

export const pomodoroApi = {
  getState: () => http.get<PomodoroState>('/api/pomodoro/state').then((r) => r.data),
  start: (data: { task_id?: number; work_minutes?: number; break_minutes?: number }) =>
    http.post<PomodoroState>('/api/pomodoro/start', data).then((r) => r.data),
  pause: () => http.post<PomodoroState>('/api/pomodoro/pause').then((r) => r.data),
  resume: () => http.post<PomodoroState>('/api/pomodoro/resume').then((r) => r.data),
  stop: () => http.post('/api/pomodoro/stop').then((r) => r.data),
};
