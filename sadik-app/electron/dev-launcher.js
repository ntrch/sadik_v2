'use strict';

/**
 * dev-launcher.js — starts webpack-dev-server AND Electron together.
 *
 * Usage:
 *   node electron/dev-launcher.js
 *   npm run dev:electron          ← preferred
 *
 * Startup chain:
 *   1. Spawn `npm run dev`       → webpack-dev-server on port 3000
 *   2. Poll http://localhost:3000 until the server responds (max 60 s)
 *   3. Spawn `npm run electron`  → Electron loads electron/main.js
 *   4. When Electron exits       → kill webpack and exit with same code
 *   5. SIGINT (Ctrl-C)           → kill both processes and exit cleanly
 *
 * Why this is needed:
 *   package.json has two independent scripts ("dev" and "electron") with no
 *   combined launcher.  Running only `npm run dev` starts webpack-dev-server
 *   but never spawns Electron, so electron/main.js never executes — the app
 *   tracker, tray, TTS, and before-quit flush are all absent.
 */

const { spawn } = require('child_process');
const http      = require('http');
const path      = require('path');

// sadik-app root (one directory above electron/)
const ROOT = path.join(__dirname, '..');

// ── Helpers ───────────────────────────────────────────────────────────────────

function spawnNpm(script, label) {
  // shell: true is required on Windows — without it, spawning npm (a .cmd
  // script) calls CreateProcess directly on the .cmd file, which is not a PE
  // executable, and Node throws EINVAL synchronously.  With shell: true,
  // Node routes the call through cmd.exe /c on Windows and /bin/sh -c on
  // POSIX, so plain 'npm' resolves correctly on every platform.
  const child = spawn('npm', ['run', script], {
    cwd:   ROOT,
    stdio: 'inherit',   // share stdout/stderr with this terminal
    shell: true,
  });
  console.log(`[dev-launcher] ${label} started (pid ${child.pid})`);
  child.on('error', (err) => {
    console.error(`[dev-launcher] ${label} spawn error:`, err.message);
  });
  return child;
}

/**
 * Resolve when localhost:port returns any HTTP response, or reject after
 * timeoutMs milliseconds.  Each attempt is separated by 800 ms.
 */
function waitForPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function attempt() {
      const req = http.get(`http://localhost:${port}/`, (res) => {
        res.resume();   // drain so the socket is released
        resolve();
      });
      req.setTimeout(1000, () => req.destroy());
      req.on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error(`localhost:${port} not ready after ${timeoutMs} ms`));
        } else {
          setTimeout(attempt, 800);
        }
      });
    }

    attempt();
  });
}

// ── 1. Start webpack-dev-server ───────────────────────────────────────────────

const webpackProc = spawnNpm('dev', 'webpack-dev-server');

// ── 2. Wait for port 3000, then launch Electron ───────────────────────────────

console.log('[dev-launcher] Waiting for webpack-dev-server on localhost:3000 …');

waitForPort(3000, 60_000)
  .then(() => {
    console.log('[dev-launcher] webpack-dev-server is ready — launching Electron');

    const electronProc = spawnNpm('electron', 'Electron');

    // When Electron closes (user quit, window closed, etc.) stop webpack too.
    electronProc.on('close', (code) => {
      console.log(`[dev-launcher] Electron exited (code ${code ?? 0}) — stopping webpack`);
      webpackProc.kill();
      process.exit(code ?? 0);
    });
  })
  .catch((err) => {
    console.error('[dev-launcher] Startup failed:', err.message);
    webpackProc.kill();
    process.exit(1);
  });

// ── 3. Ctrl-C → shut down both child processes cleanly ───────────────────────

process.on('SIGINT', () => {
  console.log('\n[dev-launcher] SIGINT — shutting down webpack and Electron');
  webpackProc.kill();
  process.exit(0);
});
