import { http } from './http';

export interface CrashPayload {
  app_version?: string;
  platform?: string;
  error_type?: string;
  message?: string;
  stack?: string;
  context?: Record<string, unknown>;
}

export interface AdminTelemetryItem {
  kind: 'crash' | 'feedback';
  id: number;
  created_at: string | null;
  app_version: string | null;
  platform: string | null;
  error_type: string | null;
  message: string | null;
  stack: string | null;
  context_json: string | null;
  resolved: boolean;
  resolved_at: string | null;
}

export const telemetryApi = {
  submitCrash: (data: CrashPayload) =>
    http.post<{ ok: boolean; id?: number }>('/api/telemetry/crash', data).then((r) => r.data),

  getConsent: () =>
    http.get<{ enabled: boolean }>('/api/settings/telemetry-consent').then((r) => r.data),

  setConsent: (enabled: boolean) =>
    http.post<{ enabled: boolean }>('/api/settings/telemetry-consent', { enabled }).then((r) => r.data),

  adminList: (params?: {
    kind?: 'crash' | 'feedback' | 'all';
    resolved?: 'true' | 'false' | 'all';
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.kind)     q.set('kind', params.kind);
    if (params?.resolved) q.set('resolved', params.resolved);
    if (params?.limit !== undefined)  q.set('limit',  String(params.limit));
    if (params?.offset !== undefined) q.set('offset', String(params.offset));
    return http.get<{ total: number; items: AdminTelemetryItem[] }>(
      `/api/admin/telemetry?${q.toString()}`
    ).then((r) => r.data);
  },

  adminResolve: (kind: 'crash' | 'feedback', id: number, resolved: boolean) =>
    http.post<{ ok: boolean; id: number; resolved: boolean }>(
      `/api/admin/telemetry/${kind}/${id}/resolve`,
      { resolved }
    ).then((r) => r.data),

  getFeedbackScreenshot: (id: number) =>
    http.get<{ screenshot_base64: string | null }>(
      `/api/admin/telemetry/feedback/${id}/screenshot`
    ).then((r) => r.data),
};
