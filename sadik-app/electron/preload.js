'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sadikElectron', {
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  onNotificationClick: (callback) => {
    ipcRenderer.on('notification-clicked', () => callback());
  },
  onIdleTick: (callback) => {
    ipcRenderer.on('sadik:idle-tick', (_event, data) => callback(data));
  },
  // Writes text or image to the OS clipboard via Electron's native clipboard
  // module. Browser clipboard API occasionally fails for images in dev builds
  // (secure-context/permission issues), so this IPC is the reliable path.
  // payload: { type: 'text' | 'image', content: string } — content is the
  //          plain text for 'text' or a data:image/*;base64,... URL for 'image'.
  writeClipboard: (payload) => ipcRenderer.invoke('sadik:write-clipboard', payload),
});
