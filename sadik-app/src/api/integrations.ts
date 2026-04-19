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

export interface ProviderConfig {
  client_id_set: boolean;
  client_secret_set: boolean;
}

export interface SyncNowResult {
  ok: boolean;
  last_sync_at: string | null;
  event_count: number;
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
  getConfig: (provider: string) =>
    http.get<ProviderConfig>(`/api/integrations/${provider}/config`).then((r) => r.data),
  setConfig: (provider: string, client_id: string, client_secret: string) =>
    http.put<{ ok: boolean }>(`/api/integrations/${provider}/config`, { client_id, client_secret }).then((r) => r.data),
  syncNow: (provider: string) =>
    http.post<SyncNowResult>(`/api/integrations/${provider}/sync-now`).then((r) => r.data),
};
