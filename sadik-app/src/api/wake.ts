import { http } from './http';

export interface WakeModel {
  name: string;
  path: string;
}

export interface WakeDetectionSettings {
  wake_threshold?: number;   // 0.1 – 0.9
  wake_input_gain?: number;  // 1.0 – 3.0
}

export interface WakeDiagnostic {
  frames_collected: number;
  rms?:   { min: number; max: number; mean: number };
  score?: { min: number; max: number; mean: number };
  current_threshold?:  number;
  current_input_gain?: number;
  hint?: string;
  note?: string;
}

export const wakeApi = {
  listModels: async (): Promise<{ models: WakeModel[]; current: string }> => {
    const { data } = await http.get('/api/wake/models');
    return data;
  },
  selectModel: async (path: string): Promise<{ ok: boolean; path: string; score_key: string }> => {
    const { data } = await http.post('/api/wake/select', { path });
    return data;
  },
  updateSettings: async (settings: WakeDetectionSettings): Promise<{ ok: boolean; updated: Record<string, number> }> => {
    const { data } = await http.put('/api/wake/settings', settings);
    return data;
  },
  diagnostic: async (): Promise<WakeDiagnostic> => {
    const { data } = await http.get('/api/wake/diagnostic');
    return data;
  },
};
