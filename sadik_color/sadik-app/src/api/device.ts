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

export interface PlayClipResult {
  success: boolean;
  clip?: string;
  loop?: boolean;
  error?: string;
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
    http.post<{ success: boolean }>(
      '/api/device/frame',
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      { headers: { 'Content-Type': 'application/octet-stream' } },
    ).then((r) => r.data),
  autoConnect: () =>
    http.post<AutoConnectResult>('/api/device/auto-connect').then((r) => r.data),
  setBrightness: (percent: number) =>
    http.post<BrightnessResult>('/api/device/brightness', { percent }).then((r) => r.data),
  setSleepTimeout: (minutes: number) =>
    http.post<SleepTimeoutResult>('/api/device/sleep-timeout', { minutes }).then((r) => r.data),

  /**
   * Tell the backend to stream a codec .bin clip to the device.
   * Backend resolves name → assets/codec/<name>.bin and streams via serial.
   * Returns immediately; stream runs in background on the backend.
   */
  playClip: (name: string, loop = false) =>
    http.post<PlayClipResult>('/api/device/play-clip', { name, loop }).then((r) => r.data),

  /**
   * Abort the current codec stream (no-op if nothing is playing).
   */
  stopClip: () =>
    http.post<{ success: boolean }>('/api/device/stop-clip').then((r) => r.data),
};
