import http from './http';

export type PrivacyTier = 'full' | 'hybrid' | 'local' | 'custom';

export interface PrivacyTierState {
  tier: PrivacyTier;
  flags: Record<string, boolean>;
}

export const privacyApi = {
  exportData: (): Promise<Blob> =>
    http.get('/api/privacy/export', { responseType: 'blob' }).then((r) => r.data as Blob),

  requestPurgeToken: (): Promise<{ token: string; expires_in: number }> =>
    http.post<{ token: string; expires_in: number }>('/api/privacy/purge/request').then((r) => r.data),

  confirmPurge: (token: string): Promise<{ purged: boolean; tables_cleared: number }> =>
    http
      .delete<{ purged: boolean; tables_cleared: number }>(`/api/privacy/purge?token=${encodeURIComponent(token)}`)
      .then((r) => r.data),

  getTier: (): Promise<PrivacyTierState> =>
    http.get<PrivacyTierState>('/api/privacy/tier').then((r) => r.data),

  setTier: (tier: 'full' | 'hybrid' | 'local'): Promise<PrivacyTierState> =>
    http.put<PrivacyTierState>('/api/privacy/tier', { tier }).then((r) => r.data),
};
