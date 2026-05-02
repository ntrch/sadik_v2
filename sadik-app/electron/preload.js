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

// Separate namespace for new APIs (keeps sadikElectron stable for existing callers).
contextBridge.exposeInMainWorld('electronAPI', {
  // Open a URL in the system default browser.
  shellOpenExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  // Toggle Windows Focus Assist / DND via main process IPC.
  // Returns a Promise<{ ok: boolean; error?: string }>.
  setDnd: (enabled) => ipcRenderer.invoke('set-dnd', enabled),
  // Window focus state — fires whenever the app window gains/loses focus.
  // callback: (focused: boolean) => void
  onAppFocusChanged: (callback) => {
    ipcRenderer.on('app-focus-changed', (_event, focused) => callback(focused));
  },
  // Returns a Promise<boolean> with the current focus state of the window.
  getFocusState: () => ipcRenderer.invoke('get-focus-state'),
  // Execute a workspace: runs each action sequentially (launch_app, open_url,
  // system_setting, window_snap). Returns { ok: true, results: [...] }.
  executeWorkspace: (payload) => ipcRenderer.invoke('workspace:execute', payload),
  // Opens a native file picker filtered to executables. Returns Electron's
  // dialog result: { canceled: boolean, filePaths: string[] }.
  pickExe: () => ipcRenderer.invoke('workspace:pick-exe'),
  // Returns a list of installed apps from Start Menu .lnk files (Windows only).
  // Returns { name: string, path: string }[] sorted alphabetically.
  listApps: () => ipcRenderer.invoke('workspace:list-apps'),
  // Restore a window to its pre-snap position. args: { hwnd: string, rect: { left, top, right, bottom } }
  restoreWindowPosition: (args) => ipcRenderer.invoke('restore-window-position', args),
  // Kill processes by PID (tree kill). args: { pids: number[] }
  killPids: (args) => ipcRenderer.invoke('kill-pids', args),
  // Toplantı modu önerisi için native OS bildirimi tetikler. Windows'ta
  // ToastXml action'ları ile Onayla/Reddet butonları gösterilir.
  showMeetingNotification: ({ title, body }) =>
    ipcRenderer.send('show-meeting-notification', { title, body }),
  // Native toast butonlarından dönen yanıt ('accept' | 'deny').
  // Returns unsubscribe fn.
  onMeetingNotificationAction: (cb) => {
    const l = (_e, action) => cb(action);
    ipcRenderer.on('meeting-notification-action', l);
    return () => ipcRenderer.removeListener('meeting-notification-action', l);
  },
  // Subscribe to snap-captured events emitted during a workspace run.
  // Returns an unsubscribe function.
  onWorkspaceSnapCaptured: (cb) => {
    const l = (_e, data) => cb(data);
    ipcRenderer.on('workspace-snap-captured', l);
    return () => ipcRenderer.removeListener('workspace-snap-captured', l);
  },
  // Capture the current window as a PNG. Returns a base64 string or null.
  captureScreenshot: () => ipcRenderer.invoke('feedback:capture-screenshot'),
  // Forward a renderer crash report to the main process (which POSTs to backend).
  reportCrash: (payload) => ipcRenderer.invoke('telemetry:crash', payload),
  // Auto-updater bridge
  onUpdateAvailable: (cb) => { ipcRenderer.on('updater:update-available', cb); },
  onUpdateDownloaded: (cb) => { ipcRenderer.on('updater:update-downloaded', cb); },
  quitAndInstall: () => ipcRenderer.send('updater:quit-and-install'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
});
