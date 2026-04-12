'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sadikElectron', {
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  onNotificationClick: (callback) => {
    ipcRenderer.on('notification-clicked', () => callback());
  },
});
