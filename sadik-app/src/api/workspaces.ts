import http from './http';

// ── Payload union types ────────────────────────────────────────────────────

export interface LaunchAppPayload {
  path: string;
  args?: string[];
}

export interface OpenUrlPayload {
  url: string;
}

export interface SystemSettingPayload {
  setting: 'night_light';
  enabled: boolean;
}

export interface WindowSnapPayload {
  target: string;
  side: 'left' | 'right' | 'top' | 'bottom' | 'maximize';
}

export type ActionPayload =
  | LaunchAppPayload
  | OpenUrlPayload
  | SystemSettingPayload
  | WindowSnapPayload
  | Record<string, unknown>;

export type ActionType = 'launch_app' | 'open_url' | 'system_setting' | 'window_snap';

// ── Workspace types ────────────────────────────────────────────────────────

export interface WorkspaceAction {
  id: number;
  order_index: number;
  type: ActionType;
  payload: ActionPayload;
}

export interface Workspace {
  id: number;
  name: string;
  color: string;
  icon: string;
  mode_sync: string | null;
  actions: WorkspaceAction[];
  created_at: string;
  updated_at: string;
}

export interface WorkspaceActionCreate {
  order_index: number;
  type: ActionType;
  payload: ActionPayload;
}

export interface WorkspaceCreate {
  name: string;
  color?: string;
  icon?: string;
  mode_sync?: string | null;
  actions?: WorkspaceActionCreate[];
}

export interface WorkspaceUpdate {
  name?: string;
  color?: string;
  icon?: string;
  mode_sync?: string | null;
  actions?: WorkspaceActionCreate[];
}

// ── API client ─────────────────────────────────────────────────────────────

export const workspacesApi = {
  list: () =>
    http.get<Workspace[]>('/api/workspaces').then((r) => r.data),
  get: (id: number) =>
    http.get<Workspace>(`/api/workspaces/${id}`).then((r) => r.data),
  create: (data: WorkspaceCreate) =>
    http.post<Workspace>('/api/workspaces', data).then((r) => r.data),
  update: (id: number, data: WorkspaceUpdate) =>
    http.patch<Workspace>(`/api/workspaces/${id}`, data).then((r) => r.data),
  delete: (id: number) =>
    http.delete(`/api/workspaces/${id}`),
};
