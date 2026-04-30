import { http } from './http';

export interface FeedbackBody {
  type: 'bug' | 'feature' | 'other';
  body: string;
  screenshot_base64?: string;
  app_version?: string;
  os_info?: string;
  current_page?: string;
}

export const feedbackApi = {
  submit: (data: FeedbackBody) =>
    http.post<{ id: number; ok: boolean }>('/api/feedback', data).then((r) => r.data),
};
