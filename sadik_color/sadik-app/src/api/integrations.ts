import http from './http';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IntegrationStatus {
  provider: string;
  status: 'connected' | 'disconnected' | 'error';
  account_email: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  scopes: string | null;
  connected_at: string | null;
}

export interface ProviderMeta {
  id: string;
  display_name: string;
  description: string;
  icon_key: string;
  color: string;
}

export interface SyncNowResult {
  ok: boolean;
  last_sync_at: string | null;
  event_count: number;
}

export interface GoogleMeetState {
  in_meeting: boolean;
  event_id: number | null;
  event_title: string | null;
  meeting_code: string | null;
  meeting_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  detected_at: string;
}

export interface GoogleMeetStateResponse {
  scope_granted: boolean;
  state: GoogleMeetState;
}

// ── API client ─────────────────────────────────────────────────────────────────

export const integrationsApi = {
  list: () =>
    http.get<IntegrationStatus[]>('/api/integrations').then((r) => r.data),
  listProviders: () =>
    http.get<ProviderMeta[]>('/api/integrations/providers').then((r) => r.data),
  disconnect: (provider: string) =>
    http.post<{ ok: boolean; provider: string }>(`/api/integrations/${provider}/disconnect`).then((r) => r.data),
  getConnectUrl: (provider: string) =>
    http.get<{ auth_url: string }>(`/api/integrations/${provider}/connect`).then((r) => r.data),
  syncNow: (provider: string) =>
    http.post<SyncNowResult>(`/api/integrations/${provider}/sync-now`).then((r) => r.data),
  getMeetState: () =>
    http.get<GoogleMeetStateResponse>('/api/integrations/google_meet/state').then((r) => r.data),
};

export const MEET_REQUIRED_SCOPE = 'meetings.space.readonly';
