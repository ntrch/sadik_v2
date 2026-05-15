import http from './http';

export const voiceApi = {
  listDevices: () => http.get('/api/voice/devices').then((r) => r.data),
};
