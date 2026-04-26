'use strict';

const { app, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const BACKEND_PORT = 8000;
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;
const HEALTH_PATH = '/api/health';
const HEALTH_INTERVAL_MS = 250;
const HEALTH_TIMEOUT_MS = 30000;
const SHUTDOWN_GRACE_MS = 3000;

let child = null;
let logStream = null;
let stopping = false;

function logPath() {
  return path.join(app.getPath('logs'), 'backend.log');
}

function ensureLogStream() {
  if (logStream) return logStream;
  const dir = app.getPath('logs');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  logStream = fs.createWriteStream(logPath(), { flags: 'a' });
  logStream.write(`\n=== Backend launcher session ${new Date().toISOString()} ===\n`);
  return logStream;
}

function blog(line) {
  try { ensureLogStream().write(`[${new Date().toISOString()}] ${line}\n`); } catch { /* ignore */ }
  console.log('[backend-launcher]', line);
}

function backendBinaryPath() {
  const exeName = process.platform === 'win32' ? 'sadik-backend.exe' : 'sadik-backend';
  return path.join(process.resourcesPath, 'backend', exeName);
}

function pingHealth() {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: BACKEND_PORT, path: HEALTH_PATH, method: 'GET', timeout: 1000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { try { req.destroy(); } catch { /* ignore */ } resolve(false); });
    req.end();
  });
}

async function waitForHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await pingHealth()) return true;
    await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
  }
  return false;
}

async function startBackend() {
  // Dev mode: backend runs separately (uvicorn from venv). No spawn.
  if (!app.isPackaged) {
    blog('isPackaged=false → dev mode, skipping spawn');
    return;
  }

  const binPath = backendBinaryPath();
  if (!fs.existsSync(binPath)) {
    const msg = `Backend binary not found at ${binPath}`;
    blog(msg);
    dialog.showErrorBox('SADIK', `Sunucu dosyası bulunamadı:\n${binPath}`);
    app.quit();
    return;
  }

  blog(`spawning ${binPath}`);
  child = spawn(binPath, [], {
    cwd: path.dirname(binPath),
    env: { ...process.env, SADIK_BACKEND_PORT: String(BACKEND_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    windowsHide: true,
  });

  const stream = ensureLogStream();
  child.stdout.on('data', (b) => stream.write(b));
  child.stderr.on('data', (b) => stream.write(b));

  child.on('exit', (code, signal) => {
    blog(`backend exited code=${code} signal=${signal} stopping=${stopping}`);
    child = null;
    if (!stopping) {
      dialog.showErrorBox('SADIK', `Sunucu beklenmedik şekilde kapandı (code=${code}). Uygulama kapatılıyor.`);
      app.quit();
    }
  });

  const healthy = await waitForHealth();
  if (!healthy) {
    blog('health check timeout');
    dialog.showErrorBox('SADIK', `Sunucu ${HEALTH_TIMEOUT_MS / 1000}s içinde başlamadı. Log: ${logPath()}`);
    stopBackend();
    app.quit();
    return;
  }
  blog('backend healthy');
}

function stopBackend() {
  if (!child) return;
  stopping = true;
  blog('stopping backend (SIGTERM)');
  try { child.kill('SIGTERM'); } catch (e) { blog(`SIGTERM failed: ${e.message}`); }

  setTimeout(() => {
    if (child) {
      blog('grace expired — SIGKILL');
      try { child.kill('SIGKILL'); } catch (e) { blog(`SIGKILL failed: ${e.message}`); }
    }
  }, SHUTDOWN_GRACE_MS);
}

module.exports = { startBackend, stopBackend, BACKEND_ORIGIN };
