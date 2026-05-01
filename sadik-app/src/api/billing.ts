import http from './http';

export interface BillingStatus {
  enabled: boolean;
  tier: 'free' | 'pro';
  subscription_id: string;
  expires_at: string;
}

export const billingApi = {
  getStatus: (): Promise<BillingStatus> =>
    http.get<BillingStatus>('/api/billing/status').then((r) => r.data),

  createCheckout: (customerEmail?: string): Promise<{ url: string }> =>
    http
      .post<{ url: string }>('/api/billing/checkout', { customer_email: customerEmail ?? null })
      .then((r) => r.data),

  openPortal: (): Promise<{ url: string }> =>
    http.post<{ url: string }>('/api/billing/portal').then((r) => r.data),
};
