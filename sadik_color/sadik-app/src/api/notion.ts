import http from './http';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface NotionStatus {
  connected: boolean;
  workspace_name: string | null;
}

export interface NotionDatabase {
  id: string;
  title: string;
}

export interface NotionDatabasesResponse {
  databases: NotionDatabase[];
}

export interface NotionSelectDatabaseResponse {
  ok: boolean;
  database_id: string;
  database_name: string;
}

// ── API client ─────────────────────────────────────────────────────────────────

export const notionApi = {
  /** GET /api/integrations/notion/status → {connected, workspace_name} */
  getStatus: () =>
    http.get<NotionStatus>('/api/integrations/notion/status').then((r) => r.data),

  /** GET /api/integrations/notion/start → {auth_url} */
  startOAuth: () =>
    http.get<{ auth_url: string }>('/api/integrations/notion/start').then((r) => r.data),

  /** POST /api/integrations/notion/disconnect → {ok} */
  disconnect: () =>
    http.post<{ ok: boolean }>('/api/integrations/notion/disconnect').then((r) => r.data),

  /** GET /api/integrations/notion/databases → {databases: [{id, title}]} */
  listDatabases: () =>
    http.get<NotionDatabasesResponse>('/api/integrations/notion/databases').then((r) => r.data),

  /** POST /api/integrations/notion/database → {ok, database_id, database_name} */
  selectDatabase: (database_id: string, database_name: string) =>
    http
      .post<NotionSelectDatabaseResponse>('/api/integrations/notion/database', {
        database_id,
        database_name,
      })
      .then((r) => r.data),
};
