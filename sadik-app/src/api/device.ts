import http from './http';

export interface DeviceStatus {
  connected: boolean;
  method: string | null;
  port: string | null;
  ip: string | null;
}

export interface SerialPort {
  port: string;
  description: string;
  hwid: string;
}

export const deviceApi = {
  getStatus: () => http.get<DeviceStatus>('/api/device/status').then((r) => r.data),
  connect: (data: { method: string; port?: string; ip?: string }) =>
    http.post<DeviceStatus>('/api/device/connect', data).then((r) => r.data),
  disconnect: () => http.post<DeviceStatus>('/api/device/disconnect').then((r) => r.data),
  listPorts: () => http.get<SerialPort[]>('/api/device/ports').then((r) => r.data),
  sendCommand: (command: string) =>
    http.post<{ success: boolean; error?: string }>('/api/device/command', { command }).then((r) => r.data),
};
