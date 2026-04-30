import http from './http';

export interface DeviceStatus {
  connected: boolean;
  method: string | null;
  port: string | null;
  ip: string | null;
  device_line?: string | null;
}

export interface SerialPort {
  port: string;
  description: string;
  hwid: string;
}

export interface AutoConnectResult {
  connected: boolean;
  port: string | null;
  method: string | null;
  message: string;
  scanned_ports: number;
  matched_ports: string[];
  error: string | null;
}

export interface BrightnessResult {
  success: boolean;
  percent: number;
  device_value: number;
  message: string;
}

export interface SleepTimeoutResult {
  success: boolean;
  minutes: number;
  device_value_ms: number;
  response: string | null;
  message: string;
}

export const deviceApi = {
  getStatus: () => http.get<DeviceStatus>('/api/device/status').then((r) => r.data),
  connect: (data: { method: string; port?: string; ip?: string }) =>
    http.post<DeviceStatus>('/api/device/connect', data).then((r) => r.data),
  disconnect: () => http.post<DeviceStatus>('/api/device/disconnect').then((r) => r.data),
  listPorts: () => http.get<SerialPort[]>('/api/device/ports').then((r) => r.data),
  sendCommand: (command: string) =>
    http.post<{ success: boolean; error?: string }>('/api/device/command', { command }).then((r) => r.data),
  sendFrame: (buffer: Uint8Array) =>
    http.post<{ success: boolean }>('/api/device/frame', {
      data: Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join(''),
    }).then((r) => r.data),
  autoConnect: () =>
    http.post<AutoConnectResult>('/api/device/auto-connect').then((r) => r.data),
  setBrightness: (percent: number) =>
    http.post<BrightnessResult>('/api/device/brightness', { percent }).then((r) => r.data),
  setSleepTimeout: (minutes: number) =>
    http.post<SleepTimeoutResult>('/api/device/sleep-timeout', { minutes }).then((r) => r.data),
};
