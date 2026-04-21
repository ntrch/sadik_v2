'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, session, ipcMain, powerMonitor, clipboard } = require('electron');
const path    = require('path');
const crypto  = require('crypto');
const { execFile } = require('child_process');
const fs      = require('fs');
const os      = require('os');
const http    = require('http');
const zlib    = require('zlib');

// =============================================================================
// Startup proof marker — written before anything else
// =============================================================================
//
// Purpose: prove which file Electron is actually loading in the current dev
// workflow.  If this file does not exist after launch, electron/main.js is NOT
// the file being executed.
//
// Check: %TEMP%\sadik_main_process_started.txt
//        Get-Content $env:TEMP\sadik_main_process_started.txt

const STARTUP_MARKER_PATH = path.join(os.tmpdir(), 'sadik_main_process_started.txt');
try {
  fs.writeFileSync(
    STARTUP_MARKER_PATH,
    `SADIK Electron main process started\ntimestamp: ${new Date().toISOString()}\nfile:      ${__filename}\n`,
    'utf8',
  );
  console.log('[SADIK] Startup marker written →', STARTUP_MARKER_PATH);
} catch (e) {
  console.warn('[SADIK] Could not write startup marker:', e.message);
}

// =============================================================================
// App Usage Tracker
// =============================================================================
//
// Polls the active foreground window every POLL_INTERVAL_MS using a PowerShell
// script (Windows only).  When the active app changes the previous session is
// POSTed to the backend for persistence.  A periodic flush prevents data loss
// during long uninterrupted sessions.
//
// Architecture boundary: this module only detects which OS app is focused and
// records durations.  No voice, TTS, or device logic is touched here.
// =============================================================================

const POLL_INTERVAL_MS  = 15000;  // poll every 15 s
const FLUSH_INTERVAL_MS = 60000;  // flush long session every 60 s
// Use explicit IPv4 loopback instead of 'localhost'.
// On Windows with Node.js ≥ 17, `localhost` resolves via the OS resolver which
// now prefers IPv6 (::1) per RFC 6724.  FastAPI's uvicorn only binds to
// 127.0.0.1 by default, so http.request('localhost') → ::1 → ECONNREFUSED.
const BACKEND_ORIGIN    = 'http://127.0.0.1:8000';

// =============================================================================
// Tracker debug logger — writes to console AND a persistent file
// =============================================================================
//
// Problem: Electron main-process stdout is NOT visible in the webpack dev-server
// terminal.  Without opening Electron DevTools on the main process explicitly,
// every console.log here is silently discarded.
//
// Solution: all [AppTracker] and [SADIK] logs are routed through tlog/twarn
// which appends each line (with ISO timestamp) to a plain-text file so the
// full tracker pipeline can be inspected at any time with:
//
//   Get-Content $env:TEMP\sadik_app_tracker.log -Wait   (PowerShell, live tail)
//   type %TEMP%\sadik_app_tracker.log                    (cmd, static dump)
//
// The file is appended — never truncated — so previous runs accumulate.
// A session separator is written at module load so runs are easy to tell apart.

const TRACKER_LOG_PATH = path.join(os.tmpdir(), 'sadik_app_tracker.log');

/** Format args the same way console.log does for primitives and strings. */
function _fmt(...args) {
  return args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
}

function tlog(...args) {
  const line = `${new Date().toISOString()}  ${_fmt(...args)}`;
  console.log(line);
  try { fs.appendFileSync(TRACKER_LOG_PATH, line + '\n', 'utf8'); } catch { /* best-effort */ }
}

function twarn(...args) {
  const line = `${new Date().toISOString()}  WARN  ${_fmt(...args)}`;
  console.warn(line);
  try { fs.appendFileSync(TRACKER_LOG_PATH, line + '\n', 'utf8'); } catch { /* best-effort */ }
}

// Write session separator so each app run is clearly delimited in the file.
try {
  const sep =
    '\n' + '='.repeat(72) + '\n' +
    `${new Date().toISOString()}  SADIK App Tracker — new session\n` +
    '='.repeat(72) + '\n';
  fs.appendFileSync(TRACKER_LOG_PATH, sep, 'utf8');
  // Log the file path to BOTH console and file so it is findable from either sink
  tlog(`[AppTracker] Debug log → ${TRACKER_LOG_PATH}`);
} catch (e) {
  console.warn(`[AppTracker] Could not open debug log at ${TRACKER_LOG_PATH}: ${e.message}`);
}

// ── PowerShell script written once to a temp file ────────────────────────────
//
// DESIGN RATIONALE — why UIAutomationClient instead of Add-Type -Language CSharp:
//
//   The old script used `Add-Type -Language CSharp @"..."@` which invokes csc.exe
//   (the C# compiler) inside every fresh powershell.exe spawn.  On Windows 10/11
//   with Defender scanning temp .cs/.dll files, csc.exe routinely takes 3–8 s.
//   With an 8 000 ms execFile timeout, polls timed out and resolved(null), so
//   currentApp was never set and postSession was never called.
//
//   `Add-Type -AssemblyName UIAutomationClient` loads an already-compiled GАC
//   assembly in < 300 ms — no C# compilation, no csc.exe, no Defender delays.
//   `AutomationElement.FocusedElement` returns the exact UI element with keyboard
//   focus and lets us retrieve the owning process ID directly.
//   A CPU-sorted fallback covers elevated/system windows where UIА cannot cross
//   the integrity boundary.

const PS_SCRIPT_PATH = path.join(os.tmpdir(), 'sadik_active_win.ps1');
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
# Force UTF-8 output so Node.js can decode the JSON without encoding surprises.
# PowerShell 5.1 defaults to the OEM code page (CP850/CP437) which garbles any
# non-ASCII character in a window title and silently breaks JSON.parse in Node.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Primary: UIAutomationClient — loads a pre-compiled GAC DLL (< 300 ms, no csc.exe).
# AutomationElement.FocusedElement gives the exact process that owns keyboard focus.
try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $el = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($el) {
        $procId = [int]$el.GetCurrentPropertyValue(
            [System.Windows.Automation.AutomationElement]::ProcessIdProperty
        )
        if ($procId -gt 0) {
            $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($p) {
                @{ name = $p.ProcessName; title = $p.MainWindowTitle } | ConvertTo-Json -Compress
                exit 0
            }
        }
    }
} catch { }

# Fallback: first windowed process.
# NOTE: Sort-Object CPU was removed — Process.CPU is a nullable float and null
# values cause Sort-Object to throw (swallowed by $ErrorActionPreference) which
# empties the pipeline silently.  Select-Object -First 1 short-circuits the
# pipeline lazily so only the first matching process is ever evaluated.
$p = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1
if ($p) {
    @{ name = $p.ProcessName; title = $p.MainWindowTitle } | ConvertTo-Json -Compress
}
`.trimStart();

let psScriptReady = false;
try {
  fs.writeFileSync(PS_SCRIPT_PATH, PS_SCRIPT, 'utf8');
  psScriptReady = true;
  tlog('[AppTracker] PS script written to', PS_SCRIPT_PATH);
} catch (e) {
  twarn('[AppTracker] Could not write PowerShell script:', e.message);
}

// ── Session state ─────────────────────────────────────────────────────────────

let currentApp   = null;   // { name: string, title: string }
let sessionStart = null;   // Date
let pollTimer    = null;
let flushTimer   = null;

// quitting: set inside before-quit to prevent re-entry into that handler.
// forceQuit: set externally (tray Exit, or close-with-tray-off) to tell the
//            window close handler to pass through without intercepting.
let quitting  = false;
let forceQuit = false;

let idleCheckInterval = null;

// ── Active window detection ───────────────────────────────────────────────────

function getActiveWindow() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(null); return; }

    if (!psScriptReady) {
      twarn('[AppTracker] getActiveWindow: psScriptReady=false — PS script was never written');
      resolve(null);
      return;
    }

    // Verify the script file still exists (could be cleared by a tmp cleanup tool)
    const scriptExists = fs.existsSync(PS_SCRIPT_PATH);
    if (!scriptExists) {
      twarn(`[AppTracker] getActiveWindow: PS script file missing at ${PS_SCRIPT_PATH} — re-writing...`);
      try {
        fs.writeFileSync(PS_SCRIPT_PATH, PS_SCRIPT, 'utf8');
        tlog('[AppTracker] PS script re-written successfully');
      } catch (writeErr) {
        twarn('[AppTracker] PS script re-write failed:', writeErr.message);
        resolve(null);
        return;
      }
    }

    const psStart = Date.now();
    tlog('[AppTracker] Invoking powershell.exe -File', PS_SCRIPT_PATH);

    execFile(
      'powershell.exe',
      [
        '-NonInteractive',
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', PS_SCRIPT_PATH,
      ],
      // encoding: 'utf8' ensures stdout/stderr arrive as strings decoded in UTF-8,
      // consistent with the [Console]::OutputEncoding = UTF8 we set inside the script.
      { timeout: 8000, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const elapsedMs = Date.now() - psStart;

        if (err) {
          // err.code 'ETIMEDOUT' → process was killed after 8 s timeout
          // err.code 'ENOENT'    → powershell.exe not found in PATH
          twarn(`[AppTracker] PS exec error [${err.code}] after ${elapsedMs}ms: ${err.message.slice(0, 150)}`);
          if (stderr && stderr.trim()) {
            twarn('[AppTracker] PS stderr:', stderr.trim().slice(0, 300));
          }
          resolve(null);
          return;
        }

        tlog(
          `[AppTracker] PS finished in ${elapsedMs}ms` +
          ` | stdout length=${stdout ? stdout.trim().length : 0}` +
          ` | stderr length=${stderr ? stderr.trim().length : 0}`
        );

        if (stderr && stderr.trim()) {
          twarn('[AppTracker] PS stderr (non-fatal):', stderr.trim().slice(0, 300));
        }

        if (!stdout || !stdout.trim()) {
          // Expected when focus is on the Desktop, Taskbar, a UAC prompt, or an
          // elevated process UIА cannot cross-inspect.  Fallback also ran and
          // found no windowed process (edge case: all windows minimised).
          tlog('[AppTracker] getActiveWindow: PS produced no output');
          resolve(null);
          return;
        }

        const raw = stdout.trim();
        try {
          const data = JSON.parse(raw);
          const result = {
            name:  String(data.name  || 'Unknown'),
            title: String(data.title || ''),
          };
          tlog(`[AppTracker] getActiveWindow → name="${result.name}" title="${result.title.slice(0, 60)}"`);
          resolve(result);
        } catch (parseErr) {
          twarn(
            `[AppTracker] getActiveWindow: JSON.parse failed: ${parseErr.message}` +
            ` | raw stdout snippet: ${raw.slice(0, 150)}`
          );
          resolve(null);
        }
      },
    );
  });
}

// ── HTTP POST to backend (best-effort, fire-and-forget) ───────────────────────

function postSession(appName, windowTitle, startedAt, endedAt) {
  const durationSeconds = Math.round((endedAt - startedAt) / 1000);
  if (durationSeconds < 2) {
    tlog(`[AppTracker] postSession: skipped (${durationSeconds}s too short) — "${appName}"`);
    return;
  }

  const body = JSON.stringify({
    app_name:         appName,
    window_title:     windowTitle || '',
    started_at:       startedAt.toISOString(),
    ended_at:         endedAt.toISOString(),
    duration_seconds: durationSeconds,
  });

  tlog(`[AppTracker] POST /api/stats/app-usage — app="${appName}" duration=${durationSeconds}s`);

  // Derive host/port from BACKEND_ORIGIN so there is one source of truth.
  // Previously this block hard-coded hostname:'localhost' which Node resolved
  // to ::1 (IPv6) on Windows, causing ECONNREFUSED against uvicorn's IPv4 socket.
  const _url = new URL(`${BACKEND_ORIGIN}/api/stats/app-usage`);

  tlog(`[AppTracker] HTTP target → ${_url.protocol}//${_url.hostname}:${_url.port}${_url.pathname}`);

  const options = {
    hostname: _url.hostname,          // '127.0.0.1' — numeric literal, no DNS
    port:     Number(_url.port),      // 8000
    path:     _url.pathname,          // '/api/stats/app-usage'
    method:   'POST',
    headers: {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const req = http.request(options, (res) => {
    // Drain the response body so Node.js releases the socket.
    // Without this the keep-alive socket stays half-open indefinitely.
    let responseBody = '';
    res.on('data', (chunk) => { responseBody += chunk; });
    res.on('end', () => {
      tlog(
        `[AppTracker] POST response: HTTP ${res.statusCode} for app="${appName}"` +
        (res.statusCode !== 201 ? ` | body: ${responseBody.slice(0, 120)}` : '')
      );
    });
  });
  req.on('error', (err) => {
    twarn(`[AppTracker] POST failed for app="${appName}": [${err.code}] ${err.message}`);
  });
  req.write(body);
  req.end();
}

// ── Flush current session without ending it ───────────────────────────────────

function flushCurrentSession() {
  if (!currentApp || !sessionStart) {
    tlog('[AppTracker] Periodic flush: no active session to flush');
    return;
  }
  const now             = new Date();
  const elapsedSeconds  = Math.round((now - sessionStart) / 1000);
  tlog(`[AppTracker] Periodic flush — "${currentApp.name}" (${elapsedSeconds}s since last flush)`);
  postSession(currentApp.name, currentApp.title, sessionStart, now);
  sessionStart = now;
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

async function pollActiveWindow() {
  // ── State snapshot — printed on every tick so the full pipeline is visible ──
  const sessionAgeS = (currentApp && sessionStart)
    ? Math.round((Date.now() - sessionStart.getTime()) / 1000)
    : null;
  tlog(
    '[AppTracker] Poll tick |' +
    ` currentApp=${currentApp ? `"${currentApp.name}"` : 'null'}` +
    ` sessionStart=${sessionStart ? sessionStart.toISOString() : 'null'}` +
    ` sessionAge=${sessionAgeS !== null ? `${sessionAgeS}s` : 'n/a'}`
  );

  try {
    const win = await getActiveWindow();

    if (!win) {
      tlog('[AppTracker] Poll: getActiveWindow returned null — skipping state update');
      return;
    }

    if (!currentApp) {
      tlog(`[AppTracker] First session started — app="${win.name}"`);
      currentApp   = win;
      sessionStart = new Date();
      return;
    }

    if (win.name !== currentApp.name) {
      const now            = new Date();
      const elapsedSeconds = Math.round((now - sessionStart) / 1000);
      tlog(
        `[AppTracker] App switched "${currentApp.name}" → "${win.name}" ` +
        `after ${elapsedSeconds}s — posting previous session`
      );
      postSession(currentApp.name, currentApp.title, sessionStart, now);
      currentApp   = win;
      sessionStart = now;
    } else {
      // Same app still focused — no action needed, state snapshot already logged above
    }
  } catch (e) {
    twarn('[AppTracker] Poll error:', e.message, e.stack ? e.stack.slice(0, 300) : '');
  }
}

// ── Start / stop ──────────────────────────────────────────────────────────────

function startAppTracker() {
  if (process.platform !== 'win32') {
    tlog('[AppTracker] Non-Windows platform — tracker disabled');
    return;
  }
  tlog(`[AppTracker] Starting — poll every ${POLL_INTERVAL_MS}ms, flush every ${FLUSH_INTERVAL_MS}ms`);
  tlog(`[AppTracker] PS script ready: ${psScriptReady} | path: ${PS_SCRIPT_PATH}`);
  // First poll after 3 s so the backend has time to finish initialising
  setTimeout(() => {
    tlog('[AppTracker] Running initial poll (3 s delay)');
    pollActiveWindow();
  }, 3000);
  pollTimer  = setInterval(pollActiveWindow, POLL_INTERVAL_MS);
  tlog('[AppTracker] Poll interval registered');
  flushTimer = setInterval(flushCurrentSession, FLUSH_INTERVAL_MS);
  tlog('[AppTracker] Flush interval registered');
}

function stopTrackerTimers() {
  if (pollTimer)  { clearInterval(pollTimer);  pollTimer  = null; }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
}

// ── Shutdown: flush final session before quit ─────────────────────────────────

app.on('before-quit', (event) => {
  if (quitting) return; // prevent re-entry
  quitting = true;

  // Destroy tray icon before exit so it disappears immediately from the taskbar
  if (tray) { try { tray.destroy(); } catch { /* ignore */ } tray = null; }

  stopTrackerTimers();
  if (idleCheckInterval) { clearInterval(idleCheckInterval); idleCheckInterval = null; }
  if (clipboardPollTimer) { clearInterval(clipboardPollTimer); clipboardPollTimer = null; }

  if (currentApp && sessionStart) {
    tlog(`[AppTracker] before-quit: flushing final session for "${currentApp.name}"`);
    event.preventDefault();
    const now = new Date();
    postSession(currentApp.name, currentApp.title, sessionStart, now);
    currentApp   = null;
    sessionStart = null;
    // Allow 800 ms for the HTTP request to reach the backend
    setTimeout(() => app.quit(), 800);
  } else {
    tlog('[AppTracker] before-quit: no active session — exiting cleanly');
  }

  // Clean up temp files
  try { fs.unlinkSync(PS_SCRIPT_PATH); }  catch { /* ignore */ }
  try { fs.unlinkSync(TRAY_ICON_PATH); }  catch { /* ignore */ }
});

// =============================================================================
// Tray icon — programmatic 16×16 RGB PNG (no external assets required)
// =============================================================================
//
// Builds a solid-color PNG using only Node.js built-ins:
//   • zlib.deflateSync  — produces RFC-1950 (zlib-wrapped) deflate, as PNG requires
//   • CRC-32            — computed from the IEEE 802.3 polynomial (no npm packages)
//
// The resulting PNG is written to tmpdir (same pattern as the PS script) so
// nativeImage.createFromPath() can load it reliably.

const TRAY_ICON_PATH = path.join(os.tmpdir(), 'sadik_tray_icon.png');

function buildSolidColorPNG(width, height, r, g, b) {
  // ── CRC-32 (IEEE 802.3, 0xEDB88320 reflected polynomial) ─────────────────
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ── PNG chunk builder ─────────────────────────────────────────────────────
  function makeChunk(type, data) {
    const lenBuf  = Buffer.allocUnsafe(4);  lenBuf.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf  = Buffer.allocUnsafe(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  // ── Raw scanlines: filter byte (0 = None) + RGB per pixel ────────────────
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const base = y * (1 + width * 3);
    raw[base] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3]     = r;
      raw[base + 1 + x * 3 + 1] = g;
      raw[base + 1 + x * 3 + 2] = b;
    }
  }

  // ── IHDR: 13-byte header ──────────────────────────────────────────────────
  const ihdrData = Buffer.allocUnsafe(13);
  ihdrData.writeUInt32BE(width,  0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8]  = 8; // bit depth
  ihdrData[9]  = 2; // color type: RGB truecolor
  ihdrData[10] = 0; // compression: deflate/inflate
  ihdrData[11] = 0; // filter: adaptive
  ihdrData[12] = 0; // interlace: none

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG signature
    makeChunk('IHDR', ihdrData),
    makeChunk('IDAT', zlib.deflateSync(raw)),  // RFC-1950 zlib = correct for PNG
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Write icon to tmpdir once at module load (same pattern as the PS script)
try {
  fs.writeFileSync(TRAY_ICON_PATH, buildSolidColorPNG(16, 16, 0x3b, 0x82, 0xf6)); // #3b82f6 blue
  console.log('[Tray] Icon written to', TRAY_ICON_PATH);
} catch (e) {
  console.warn('[Tray] Could not write tray icon:', e.message);
}

// =============================================================================
// Tray
// =============================================================================

let mainWindow = null;
let tray       = null;
let trayNotificationShown = false; // one-time notification per session

/** Show and focus the main window (restore from tray). */
function showMainWindow() {
  const win = mainWindow;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function initTray() {
  const iconExists = fs.existsSync(TRAY_ICON_PATH);
  const icon = iconExists
    ? nativeImage.createFromPath(TRAY_ICON_PATH)
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('SADIK');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Sadık'ı Aç",
      click: () => showMainWindow(),
    },
    { type: 'separator' },
    {
      label: 'Çıkış',
      click: () => {
        // Real exit via tray: set forceQuit so the close handler passes through,
        // then quit normally so before-quit can flush the session.
        forceQuit = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Double-click restores the window on Windows
  tray.on('double-click', () => showMainWindow());

  console.log('[Tray] System tray initialized');
}

// =============================================================================
// Settings helper — reads close_to_tray from the backend (best-effort)
// =============================================================================
//
// Called just-in-time when the user hits the window close button so we always
// get the most recent value without needing IPC or caching.  Defaults to true
// if the backend is unavailable (e.g., hasn't started yet).

function fetchCloseToTray() {
  return new Promise((resolve) => {
    const req = http.get(
      `${BACKEND_ORIGIN}/api/settings/close_to_tray`,
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try   { resolve(JSON.parse(body).value !== 'false'); }
          catch { resolve(true); }
        });
      },
    );
    req.setTimeout(2000, () => { req.destroy(); resolve(true); });
    req.on('error', () => resolve(true));
  });
}

// =============================================================================
// Electron window
// =============================================================================

function createWindow() {
  const win = new BrowserWindow({
    width:           1400,
    height:          900,
    minWidth:        1100,
    minHeight:       700,
    backgroundColor: '#0a0f1a',
    webPreferences: {
      nodeIntegration:        false,
      contextIsolation:       true,
      // Disable Chromium's background throttling globally. When another app
      // (Chrome fullscreen, alt+tab target) occludes or takes focus, Chromium
      // would otherwise throttle rAF to ~1 fps, freezing the OLED frame pump
      // mid-clip (e.g. 'confirming' clip got stuck on device).  Runtime
      // setBackgroundThrottling(false) isn't always applied in time — setting
      // it here at creation is the reliable path. CPU cost is small for the
      // 12 fps canvas + 1 KiB frame pipeline.
      backgroundThrottling:   false,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle:    process.platform === 'darwin' ? 'hidden' : 'default',
    autoHideMenuBar:  true,
  });

  mainWindow = win;

  // Background throttling is disabled in webPreferences above, so the animation
  // loop keeps ticking when the window is hidden to tray, blurred, or occluded.

  // ── Shell open external URL ─────────────────────────────────────────────
  ipcMain.handle('shell:openExternal', async (_e, url) => {
    const { shell } = require('electron');
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Clipboard write IPC ─────────────────────────────────────────────────
  // Uses Electron's native clipboard module, which works without
  // secure-context / permission prompts that the DOM ClipboardItem API
  // needs in some Electron configurations.
  ipcMain.handle('sadik:write-clipboard', async (_event, payload) => {
    try {
      if (!payload || typeof payload !== 'object') return { ok: false, error: 'bad payload' };
      if (payload.type === 'text') {
        clipboard.writeText(String(payload.content ?? ''));
        return { ok: true };
      }
      if (payload.type === 'image') {
        const content = String(payload.content ?? '');
        // Accept data:image/*;base64,<...>
        const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(content);
        if (!m) return { ok: false, error: 'not a data URL' };
        const buf = Buffer.from(m[1], 'base64');
        const img = nativeImage.createFromBuffer(buf);
        if (img.isEmpty()) return { ok: false, error: 'empty image' };
        clipboard.writeImage(img);
        return { ok: true };
      }
      return { ok: false, error: 'unknown type' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Focus-state IPC ────────────────────────────────────────────────────────
  // Renderer can query initial focus state on mount so focus-look is applied
  // correctly even before the first focus/blur event fires.
  ipcMain.handle('get-focus-state', () => (win ? win.isFocused() : false));

  // ── DND IPC — toggle Focus Assist / Do Not Disturb ─────────────────────────
  //
  // WINDOWS: NtUpdateWnfStateData is trust-gated since Win11 1909 — user-land
  //   writes are silently rejected. Registry writes have no visible effect either.
  //   SADIK's in-app DND (TTS mute / toast suppression / OLED) is handled at the
  //   renderer layer. OS-level Focus Assist must be toggled manually: Win+A → Focus.
  //
  // MACOS APPROACH (Ventura+ Shortcuts CLI):
  //   Uses `shortcuts run "Turn On/Off Do Not Disturb"` — these are built-in
  //   system Shortcuts on macOS Ventura+. Falls back to a `defaults write`
  //   on com.apple.ncprefs if the `shortcuts` CLI is absent or fails.
  //   CAVEAT: Shortcuts CLI may prompt for Accessibility permission on first run.
  //   The built-in "Turn On Do Not Disturb" Shortcut must exist (default on Ventura+).
  ipcMain.handle('set-dnd', async (_event, enabled) => {
    const { exec } = require('child_process');

    // ── Windows branch ────────────────────────────────────────────────────────
    if (process.platform === 'win32') {
      // Windows 11 blocks user-land Focus Assist toggling (WNF state is trust-gated since 1909).
      // SADIK's in-app DND (TTS/toasts/OLED) is handled at the renderer layer — no OS call here.
      // User must toggle system Focus Assist manually (Win+A → Focus).
      return { ok: true, note: 'in-app only on Windows' };

    // ── macOS branch ──────────────────────────────────────────────────────────
    } else if (process.platform === 'darwin') {
      const shortcutName = enabled ? 'Turn On Do Not Disturb' : 'Turn Off Do Not Disturb';

      return new Promise((resolve) => {
        // Primary: Shortcuts CLI (Ventura+, built-in system shortcut)
        exec(
          `shortcuts run "${shortcutName}"`,
          { timeout: 8000 },
          (err) => {
            if (!err) {
              tlog(`[DND] macOS Shortcuts: "${shortcutName}" executed`);
              resolve({ ok: true });
              return;
            }
            tlog(`[DND] shortcuts CLI failed (${err.message}), trying defaults write fallback`);
            // Fallback: legacy defaults write on com.apple.ncprefs (best-effort, may need re-login)
            // dnd_prefs is a base64-encoded binary plist; we toggle the global dndStart/End
            // by writing a well-known minimal plist. Limited to older macOS / partial effect.
            const dndFlag = enabled ? 1 : 0;
            const fallbackCmd = [
              `defaults write com.apple.ncprefs dnd_prefs -dict-add userPref ${dndFlag}`,
              `killall usernoted 2>/dev/null || true`,
            ].join(' && ');
            exec(fallbackCmd, { timeout: 6000 }, (fbErr) => {
              if (fbErr) {
                resolve({ ok: false, error: `shortcuts: ${err.message} | defaults: ${fbErr.message}` });
              } else {
                tlog(`[DND] macOS defaults write fallback applied (DND ${enabled ? 'ON' : 'OFF'})`);
                resolve({ ok: true });
              }
            });
          }
        );
      });

    // ── Unsupported platform ──────────────────────────────────────────────────
    } else {
      return { ok: false, error: 'unsupported platform' };
    }
  });

  // ── Workspace execute IPC ─────────────────────────────────────────────────
  //
  // Runs a list of workspace actions sequentially.  Each action is wrapped in
  // try/catch so a single failure does not abort the remaining chain.
  //
  // Action types:
  //   launch_app     — spawn a process detached so it outlives SADIK
  //   open_url       — open a URL in the default browser via shell.openExternal
  //   system_setting — night_light: best-effort; opens ms-settings:nightlight.
  //                    Windows' actual night light state lives in a WNF blob
  //                    requiring native calls (same class as Focus Assist) —
  //                    not toggled reliably; we surface the panel for the user.
  //   window_snap    — PowerShell P/Invoke: FindWindow + SetWindowPos.
  //                    Reliability caveat: elevated/UWP windows may be invisible
  //                    to Get-Process MainWindowHandle; retry up to 3× with 500ms
  //                    gap.  Snap accuracy depends on workarea DPI.
  ipcMain.handle('workspace:execute', async (_e, { actions, workspaceName, workspaceRunId }) => {
    const { spawn } = require('child_process');
    const { shell } = require('electron');
    const { execFile } = require('child_process');

    // Alias map for common app names → executable
    const APP_ALIAS = {
      code: 'code',
      vscode: 'code',
      terminal: 'wt.exe',
      wt: 'wt.exe',
      spotify: 'spotify',
    };

    function resolveApp(rawPath) {
      const lower = rawPath.trim().toLowerCase();
      return APP_ALIAS[lower] ?? rawPath;
    }

    // Run a PowerShell command via -EncodedCommand (UTF-16LE base64) to avoid
    // quoting hell — same pattern as the DND handler above.
    function runPowerShell(script) {
      return new Promise((resolve) => {
        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
          { timeout: 40000 },
          (err, stdout, stderr) => {
            resolve({ err, stdout: stdout ? stdout.trim() : '', stderr: stderr ? stderr.trim() : '' });
          }
        );
      });
    }

    // Resolve the real target exe path of a .lnk shortcut via WScript.Shell COM.
    async function resolveLnkTarget(lnkPath) {
      const escaped = lnkPath.replace(/'/g, "''");
      const ps = `$sh = New-Object -ComObject WScript.Shell; $lnk = $sh.CreateShortcut('${escaped}'); Write-Output $lnk.TargetPath`;
      const { stdout } = await runPowerShell(ps);
      const target = (stdout || '').trim();
      return target || null;
    }

    // Window snap via PowerShell inline C# P/Invoke + EnumWindows for reliability.
    async function windowSnap(target, side, knownPid) {
      tlog('[Snap] target=' + target + ' side=' + side + ' knownPid=' + knownPid);
      const sadikPid = process.pid;
      const psScript = `
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinSnap {
  public delegate bool EnumWndProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWndProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndAfter, int X, int Y, int W, int H, uint uFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint uAction, uint uParam, ref RECT lpvParam, uint fuWinIni);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<IntPtr> GetWindowsForPid(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h, _) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  // Find any visible top-level window whose owning process is in allowedPids,
  // excluding windows owned by excludePids. Requires a non-empty title and
  // no owner window (to filter out tool/splash windows).
  public static IntPtr FindWindowByPids(HashSet<int> allowedPids, HashSet<int> excludePids) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, _) => {
      if (!IsWindowVisible(h)) return true;
      if (GetWindowTextLength(h) == 0) return true;
      uint p; GetWindowThreadProcessId(h, out p);
      int pid = (int)p;
      if (excludePids.Contains(pid)) return true;
      if (!allowedPids.Contains(pid)) return true;
      found = h;
      return false;
    }, IntPtr.Zero);
    return found;
  }
  // Find any visible top-level window whose title contains titleMatch (case-insensitive),
  // excluding windows owned by excludePids. Last-resort fallback.
  public static IntPtr FindWindowByTitle(string titleMatch, HashSet<int> excludePids) {
    IntPtr found = IntPtr.Zero;
    string needle = titleMatch.ToLowerInvariant();
    EnumWindows((h, _) => {
      if (!IsWindowVisible(h)) return true;
      int len = GetWindowTextLength(h);
      if (len == 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(h, sb, sb.Capacity);
      if (sb.ToString().ToLowerInvariant().IndexOf(needle) < 0) return true;
      uint p; GetWindowThreadProcessId(h, out p);
      if (excludePids.Contains((int)p)) return true;
      found = h;
      return false;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$target   = '${target.replace(/'/g, "''")}'
$side     = '${side}'
$knownPid = ${knownPid ? knownPid : 0}
$sadikPid = ${sadikPid}

$progressLog = Join-Path $env:TEMP "sadik_snap_progress.log"
function Write-Progress-Log($msg) {
  $ts = (Get-Date).ToString("HH:mm:ss.fff")
  Add-Content -Path $progressLog -Value "[$ts][pid=$PID target=$target side=$side knownPid=$knownPid] $msg" -ErrorAction SilentlyContinue
}
Write-Progress-Log "PS started, Add-Type done"

# Only exclude SADIK's own process — NOT descendants. Target name filter
# (e.g. "chrome", "Canva") already disqualifies SADIK/PS helpers. Excluding
# descendants risks excluding the target app itself when shell.openPath
# parents it under SADIK (observed with Chrome browser process).
$excludeSet = New-Object System.Collections.Generic.HashSet[int]
[void]$excludeSet.Add([int]$sadikPid)
Write-Progress-Log "excludeSet sadikPid only"

$hWnd = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds(60)
$iter = 0
$foundPath = ''
while ((Get-Date) -lt $deadline) {
  $iter++
  # PATH 1 (fastest, most reliable): direct PID lookup when we know the PID
  # from launch. Works for UWP, .lnk, and .exe uniformly since we captured
  # the PID via process diff at launch time.
  if ($knownPid -gt 0) {
    $pidSet = New-Object System.Collections.Generic.HashSet[int]
    [void]$pidSet.Add([int]$knownPid)
    # Also include child processes (UWP apps sometimes spawn UI in child).
    try {
      $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$knownPid" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessId
      foreach ($k in $kids) { [void]$pidSet.Add([int]$k) }
    } catch { }
    $hWnd = [WinSnap]::FindWindowByPids($pidSet, $excludeSet)
    if ($hWnd -ne [IntPtr]::Zero) { $foundPath = "byKnownPid"; break }
  }
  # PATH 2: name-based PID set.
  $namedPids = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -eq $target -or $_.ProcessName -like "$target*"
  } | Select-Object -ExpandProperty Id)
  if ($iter -eq 1 -or $iter % 10 -eq 0) {
    Write-Progress-Log "iter=$iter namedPids=$($namedPids.Count) knownPid=$knownPid"
  }
  if ($namedPids.Count -gt 0) {
    $allowedSet = New-Object System.Collections.Generic.HashSet[int]
    foreach ($np in $namedPids) { [void]$allowedSet.Add([int]$np) }
    $hWnd = [WinSnap]::FindWindowByPids($allowedSet, $excludeSet)
    if ($hWnd -ne [IntPtr]::Zero) { $foundPath = "byPids"; break }
  }
  # PATH 3 (last-resort): title substring match.
  if ($target.Length -gt 0) {
    $hWnd = [WinSnap]::FindWindowByTitle($target, $excludeSet)
    if ($hWnd -ne [IntPtr]::Zero) { $foundPath = "byTitle"; break }
  }
  Start-Sleep -Milliseconds 300
}
if ($hWnd -ne [IntPtr]::Zero) {
  Write-Progress-Log "window found iter=$iter path=$foundPath hWnd=$hWnd"
}
if ($hWnd -eq [IntPtr]::Zero) {
  Write-Progress-Log "NOTFOUND after $iter iterations"
  $diag = Get-Process | Where-Object { $_.ProcessName -like "*$target*" } | Select-Object Id, ProcessName, MainWindowHandle, MainWindowTitle | Format-Table -AutoSize | Out-String
  Write-Output "NOTFOUND"
  Write-Output "DIAG-BEGIN"
  Write-Output $diag
  Write-Output "DIAG-END"
  exit 1
}

$wa = New-Object WinSnap+RECT
[WinSnap]::SystemParametersInfo(0x30, 0, [ref]$wa, 0) | Out-Null
$W  = $wa.Right  - $wa.Left
$H  = $wa.Bottom - $wa.Top
$HW = [int]($W / 2)
$HH = [int]($H / 2)

$preRect = New-Object WinSnap+RECT
[WinSnap]::GetWindowRect($hWnd, [ref]$preRect) | Out-Null
Write-Output "PRE_RECT hWnd=$hWnd L=$($preRect.Left) T=$($preRect.Top) R=$($preRect.Right) B=$($preRect.Bottom)"

if ($side -eq 'maximize') {
  [WinSnap]::ShowWindow($hWnd, 3) | Out-Null
} else {
  $x = $wa.Left; $y = $wa.Top; $w = $HW; $h = $H
  if ($side -eq 'right')  { $x = $wa.Left + $HW }
  if ($side -eq 'top')    { $w = $W; $h = $HH }
  if ($side -eq 'bottom') { $w = $W; $h = $HH; $y = $wa.Top + $HH }
  [WinSnap]::ShowWindow($hWnd, 9) | Out-Null
  Start-Sleep -Milliseconds 250
  $sp = [WinSnap]::SetWindowPos($hWnd, [IntPtr]::Zero, $x, $y, $w, $h, 0x0000)
  Write-Progress-Log "SetWindowPos hWnd=$hWnd x=$x y=$y w=$w h=$h result=$sp"
}
Write-Progress-Log "OK"
Write-Output "OK"
`;
      const snapResult = await runPowerShell(psScript);
      tlog('[Snap] stdout=' + (snapResult.stdout||'').slice(0,1500) + ' stderr=' + (snapResult.stderr||'').slice(0,500) + ' errmsg=' + (snapResult.err?.message||''));
      // Parse PRE_RECT line if present
      const preRectMatch = (snapResult.stdout || '').match(/PRE_RECT hWnd=(\S+) L=(-?\d+) T=(-?\d+) R=(-?\d+) B=(-?\d+)/);
      if (preRectMatch) {
        snapResult.preRect = {
          hwnd: preRectMatch[1],
          rect: {
            left:   parseInt(preRectMatch[2], 10),
            top:    parseInt(preRectMatch[3], 10),
            right:  parseInt(preRectMatch[4], 10),
            bottom: parseInt(preRectMatch[5], 10),
          },
        };
      }
      return snapResult;
    }

    // Capture the PID of a newly launched process by diffing the process set
    // before and after launch.  Polls every 200 ms until a new process with a
    // visible main window appears, or until timeoutMs elapses.
    // expectedName (optional): if provided, only consider processes whose name
    // contains this string (case-insensitive, PowerShell -like wildcard match).
    async function captureNewPid(preSet, timeoutMs = 3000, expectedName) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        try {
          const nameFilter = expectedName
            ? `$_.ProcessName -like "*${expectedName}*" -and `
            : '';
          const { stdout } = await runPowerShell(
            `Get-Process | Where-Object { ${nameFilter}$_.MainWindowTitle -ne '' } | Select-Object -ExpandProperty Id`
          );
          const nowPids = stdout.split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
          const newPid = nowPids.find((p) => !preSet.has(p));
          if (newPid != null) return newPid;
        } catch { /* keep polling */ }
      }
      return null;
    }

    // Snapshot the current set of process IDs that have a visible window.
    async function snapshotPidSet() {
      try {
        const { stdout } = await runPowerShell(
          `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -ExpandProperty Id`
        );
        return new Set(stdout.split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)));
      } catch {
        return new Set();
      }
    }

    const results = [];

    for (const action of (actions ?? [])) {
      try {
        const { type, payload } = action;

        if (type === 'launch_app') {
          const appPath = payload.path ?? '';
          const isUwp   = appPath.startsWith('shell:AppsFolder\\');
          const exePath = isUwp ? appPath : resolveApp(appPath);
          const args    = payload.args ?? [];
          const lnkBasename = path.basename(appPath).replace(/\.lnk$/i, '');
          let launchedPid = null;
          let resolvedExe = null; // set in .lnk branch; used for snapTarget below

          let wasPreExisting = false;
          try {
            if (isUwp) {
              // UWP: launch via explorer.exe; diff-based PID capture
              const preSet = await snapshotPidSet();
              const child = spawn('explorer.exe', [exePath], { detached: true, stdio: 'ignore' });
              child.unref();
              const uwpExpectedName = (exePath.split('!').pop() || exePath.split('.').pop()).toLowerCase();
              launchedPid = await captureNewPid(preSet, 8000, uwpExpectedName);
              wasPreExisting = (launchedPid == null);
              tlog('[Snap] capturedPid=' + launchedPid + ' for ' + exePath);
            } else if (exePath.toLowerCase().endsWith('.lnk')) {
              // .lnk shortcuts can't be spawned directly — delegate to shell; diff-based PID capture.
              // Resolve the real target exe first so captureNewPid/windowSnap use the correct process name.
              resolvedExe = await resolveLnkTarget(exePath);
              tlog('[Snap] .lnk resolved target=' + (resolvedExe || 'null') + ' for ' + exePath);
              const lnkBase = resolvedExe
                ? path.basename(resolvedExe, '.exe').toLowerCase()
                : path.basename(exePath, '.lnk').toLowerCase().replace(/\s+/g, '');
              const preSet = await snapshotPidSet();
              await shell.openPath(exePath);
              launchedPid = await captureNewPid(preSet, 15000, lnkBase);
              wasPreExisting = (launchedPid == null);
              tlog('[Snap] capturedPid=' + launchedPid + ' for ' + exePath);
              if (launchedPid == null) {
                const { stdout: lnkPidOut } = await runPowerShell(
                  `Get-Process | Where-Object { $_.ProcessName -like "*${lnkBase}*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1 -ExpandProperty Id`
                );
                const parsed = parseInt(lnkPidOut.trim(), 10);
                if (!isNaN(parsed)) launchedPid = parsed;
              }
            } else {
              // Check if process already running to avoid duplicate launch
              const exeBase = path.basename(exePath).replace(/\.exe$/i, '');
              let existingPid = null;
              try {
                const { stdout: pidOut } = await runPowerShell(
                  `Get-Process -Name '${exeBase.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id`
                );
                const parsed = parseInt(pidOut.trim(), 10);
                if (!isNaN(parsed)) existingPid = parsed;
              } catch { /* ignore */ }

              if (existingPid) {
                launchedPid = existingPid;
                wasPreExisting = true;
              } else {
                const child = spawn(exePath, args, { detached: true, stdio: 'ignore' });
                launchedPid = child.pid;
                wasPreExisting = false;
                child.on('exit', (code) => console.log('[workspace] launched pid', child.pid, 'exited code', code));
                child.unref();
              }
            }
          } catch (launchErr) {
            results.push({ type, ok: false, error: String(launchErr) });
            continue;
          }
          // If snap is requested: fire-and-forget so the IPC returns fast
          // and the UI doesn't block for the 30s PowerShell deadline.
          if (payload.snap) {
            const resolvedSnapBase = exePath.toLowerCase().endsWith('.lnk') && typeof resolvedExe === 'string' && resolvedExe
              ? path.basename(resolvedExe, '.exe')
              : null;
            // For UWP (shell:AppsFolder\Publisher.Name_hash!EntryPoint), use the part
            // after "!" as the target name (e.g. "Spotify"). This matches the
            // actual .exe process name for most UWP apps.
            const uwpSnapBase = isUwp ? (exePath.split('!').pop() || '') : null;
            const snapTarget = resolvedSnapBase || uwpSnapBase || lnkBasename || path.basename(exePath).replace(/\.exe$/i, '');
            const snapSide = payload.snap;
            const snapPid  = launchedPid;
            const snapWasPreExisting = wasPreExisting;
            // No pre-delay — PS script has its own poll loop that waits for
            // the window to become available (up to 30s).
            windowSnap(snapTarget, snapSide, snapPid).then((snapResult) => {
              if (snapResult.preRect && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('workspace-snap-captured', {
                  workspaceRunId,
                  pid: snapPid,
                  hwnd: snapResult.preRect.hwnd,
                  rect: snapResult.preRect.rect,
                  target: snapTarget,
                  wasPreExisting: snapWasPreExisting,
                });
              }
            }).catch((e) => {
              tlog('[Snap-BG] error ' + (e?.message || e));
            });
          }
          results.push({ type, ok: true, pid: launchedPid, wasPreExisting, target: path.basename(exePath).replace(/\.exe$/i, '').replace(/\.lnk$/i, '') });

        } else if (type === 'open_url') {
          await shell.openExternal(payload.url ?? '');
          results.push({ type, ok: true });

        } else if (type === 'system_setting') {
          if (payload.setting === 'night_light') {
            // Opens the Night Light settings panel — best-effort only.
            // Programmatic state toggling requires a trust-gated WNF blob write
            // (same restriction as Focus Assist) and is not reliably available
            // from user-land.
            spawn('powershell.exe', ['-Command', 'Start-Process ms-settings:nightlight'], {
              detached: true, stdio: 'ignore', shell: false,
            }).unref();
            results.push({ type, ok: true, note: 'opens Night Light settings panel; toggle is manual' });
          } else {
            results.push({ type, ok: false, error: `unknown setting: ${payload.setting}` });
          }

        } else if (type === 'window_snap') {
          const { err, stdout } = await windowSnap(payload.target ?? '', payload.side ?? 'maximize');
          if (err || stdout === 'NOTFOUND') {
            results.push({ type, ok: false, error: err ? err.message : 'window not found' });
          } else {
            results.push({ type, ok: true });
          }

        } else {
          results.push({ type, ok: false, error: `unknown action type: ${type}` });
        }
      } catch (err) {
        results.push({ type: action.type, ok: false, error: err.message });
      }
    }

    tlog(`[Workspace] "${workspaceName}" executed — ${results.length} actions, ${results.filter((r) => r.ok).length} ok`);
    return { ok: true, results };
  });

  // ── Workspace stop: restore window position ──────────────────────────────
  ipcMain.handle('restore-window-position', async (_evt, { hwnd, rect }) => {
    const { execFile } = require('child_process');
    const L = rect.left, T = rect.top, R = rect.right, B = rect.bottom;
    const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinRestore {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndAfter, int X, int Y, int W, int H, uint uFlags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
[WinRestore]::ShowWindow([IntPtr]${hwnd}, 9) | Out-Null
Start-Sleep -Milliseconds 200
[WinRestore]::SetWindowPos([IntPtr]${hwnd}, [IntPtr]::Zero, ${L}, ${T}, ${R - L}, ${B - T}, 0x0000) | Out-Null
Write-Output "OK"
`;
    return new Promise((resolve) => {
      const encoded = Buffer.from(ps, 'utf16le').toString('base64');
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeout: 10000 }, (err, stdout) => {
        if (err) { resolve({ ok: false, error: err.message }); }
        else { resolve({ ok: (stdout || '').includes('OK') }); }
      });
    });
  });

  // ── Workspace stop: kill PIDs ─────────────────────────────────────────────
  ipcMain.handle('kill-pids', async (_evt, { pids }) => {
    const { execFile } = require('child_process');
    const killed = [], failed = [];
    await Promise.all((pids ?? []).map((pid) => new Promise((resolve) => {
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], (err) => {
        if (err) { failed.push(pid); } else { killed.push(pid); }
        resolve();
      });
    })));
    return { killed, failed };
  });

  // ── Installed apps list (Windows Start Menu .lnk scan) ───────────────────
  ipcMain.handle('workspace:list-apps', async () => {
    if (process.platform !== 'win32') return [];
    const startMenuDirs = [
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      path.join(process.env.APPDATA || os.homedir(), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ];

    const LNK_SKIP_KEYWORDS = /uninstall|unins|readme|license|release notes|help|documentation|kaldır|website|modify|repair/i;
    const LNK_SKIP_PYTHON   = /^(python|idle|pip|conda)\b/i;

    async function walkDir(dir) {
      const results = [];
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return results;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const sub = await walkDir(full);
          results.push(...sub);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) {
          const baseName = entry.name.slice(0, -4);
          if (LNK_SKIP_KEYWORDS.test(baseName)) continue;
          if (LNK_SKIP_PYTHON.test(baseName)) continue;
          results.push({ name: baseName, path: full, type: 'lnk' });
        }
      }
      return results;
    }

    const all = [];
    for (const dir of startMenuDirs) {
      const found = await walkDir(dir);
      all.push(...found);
    }

    // UWP apps via Get-StartApps (inline PS runner — list-apps handler scope)
    let uwpApps = [];
    try {
      const script = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress';
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      const uwpRes = await new Promise((resolve) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
          { timeout: 40000, maxBuffer: 10 * 1024 * 1024 },
          (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }),
        );
      });
      if (uwpRes.err) {
        console.warn('[workspace:list-apps] Get-StartApps error:', uwpRes.err.message || uwpRes.err, uwpRes.stderr);
      }
      const parsed = JSON.parse(uwpRes.stdout.trim() || '[]');
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      uwpApps = arr
        .filter((e) => e && e.Name && e.AppID)
        .map((e) => ({
          name: e.Name,
          path: `shell:AppsFolder\\${e.AppID}`,
          type: 'uwp',
        }));
      console.log('[workspace:list-apps] UWP apps found:', uwpApps.length);
    } catch (uwpErr) {
      console.warn('[workspace:list-apps] UWP parse failed:', uwpErr.message);
    }

    // Dedupe by name (case-insensitive), lnk wins over uwp for same name
    const seen = new Set();
    const unique = [];
    for (const app of [...all, ...uwpApps]) {
      const key = app.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(app);
      }
    }

    // Sort alphabetically
    unique.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    return unique;
  });

  // ── Workspace EXE file picker ─────────────────────────────────────────────
  ipcMain.handle('workspace:pick-exe', async () => {
    const { dialog } = require('electron');
    return dialog.showOpenDialog(win, {
      title: 'Uygulama Seç',
      properties: ['openFile'],
      filters: [
        { name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'cmd'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
  });

  // ── Proactive notification IPC ───────────────────────────────────────────
  ipcMain.on('show-notification', (_event, { title, body }) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: false });
    n.on('click', () => {
      win.show();
      win.focus();
      win.webContents.send('notification-clicked');
    });
    n.show();
  });

  // ── Window lifecycle diagnostics ──────────────────────────────────────────
  win.once('ready-to-show', () => tlog('[SADIK] Window ready-to-show'));
  win.on('show',        () => tlog('[SADIK] Window show'));
  win.on('focus',       () => { tlog('[SADIK] Window focus'); win.webContents.send('app-focus-changed', true); });
  win.on('blur',        () => { tlog('[SADIK] Window blur');  win.webContents.send('app-focus-changed', false); });
  win.on('closed',      () => tlog('[SADIK] Window closed'));
  win.on('unresponsive',() => twarn('[SADIK] Window UNRESPONSIVE'));
  win.on('responsive',  () => tlog('[SADIK] Window responsive (was unresponsive)'));

  // ── Renderer / load diagnostics ───────────────────────────────────────────
  const wc = win.webContents;
  wc.on('did-start-loading', () => tlog('[SADIK] webContents did-start-loading'));
  wc.on('did-finish-load',   () => tlog('[SADIK] webContents did-finish-load'));
  wc.on('did-fail-load', (_e, errCode, errDesc, validatedURL) =>
    twarn(`[SADIK] webContents did-fail-load — code=${errCode} desc="${errDesc}" url="${validatedURL}"`));
  wc.on('render-process-gone', (_e, details) =>
    twarn(`[SADIK] webContents RENDER PROCESS GONE — reason=${details.reason} exitCode=${details.exitCode}`));
  // Forward renderer console output to the main-process log file.
  // level: 0=verbose 1=info 2=warning 3=error
  //
  // Threshold lowered from ≥2 to ≥1 so console.log (level=1) is also captured.
  // This is required for crash isolation — all [WakeWord] diagnostic logs use
  // console.log/warn and were previously invisible in the log file.
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 1) {
      if (level >= 2) {
        const label = level === 3 ? 'ERROR' : 'WARN';
        twarn(`[Renderer][${label}] ${message}  (${sourceId}:${line})`);
      } else {
        tlog(`[Renderer][INFO] ${message}  (${sourceId}:${line})`);
      }
    }
  });

  win.loadURL('http://localhost:3000');
  win.setMenuBarVisibility(false);

  // ── Close-to-tray handler ─────────────────────────────────────────────────
  //
  // Intercepts the window close event.  If close_to_tray is enabled and no
  // real quit is in progress, the window is hidden instead of destroyed so
  // background tasks (usage tracking, proactive polling, wake word) continue.
  //
  // Real quits come from two sources:
  //   1. Tray "Çıkış" → sets forceQuit = true, calls app.quit()
  //   2. Close with tray disabled → we set forceQuit = true, call app.quit()
  //
  // In both cases forceQuit causes this handler to pass through, allowing
  // before-quit to flush the session normally.
  win.on('close', async (event) => {
    // If a real quit is already underway, let the close proceed normally.
    if (forceQuit || quitting) return;

    // Prevent the close while we ask the backend for the current setting.
    event.preventDefault();

    const shouldHide = await fetchCloseToTray();

    if (shouldHide && tray) {
      win.hide();

      // One-time native notification the first time we hide to tray this session
      if (!trayNotificationShown) {
        trayNotificationShown = true;
        try {
          new Notification({
            title: 'SADIK',
            body:  'Sadık arka planda çalışmaya devam ediyor.',
          }).show();
        } catch { /* Notification not supported on this system — safe to skip */ }
      }
    } else {
      // close_to_tray is disabled (or tray was never created) — real exit.
      // Set forceQuit so this handler does not re-intercept the close event
      // that Electron fires as part of the quit sequence.
      forceQuit = true;
      app.quit();
    }
  });
}

// =============================================================================
// Clipboard monitor — polls the OS clipboard while the app is running and
// POSTs each new text/image value to /api/memory/clipboard. Fire-and-forget.
// Only runs while the Electron process is alive; if the app is quit, logging
// stops — this matches the user's spec ("app açıkken loglanan tüm ctrl+c'ler").
// =============================================================================

const CLIPBOARD_POLL_MS = 3000; // was 800 ms — 3 s reduces idle CPU while still catching all Ctrl+C events promptly
let clipboardPollTimer = null;
let lastClipboardHash  = null;

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function postClipboardItem(contentType, content, contentHash) {
  const body = JSON.stringify({
    content_type: contentType,
    content,
    content_hash: contentHash,
  });
  const _url = new URL(`${BACKEND_ORIGIN}/api/memory/clipboard`);
  const options = {
    hostname: _url.hostname,
    port:     Number(_url.port),
    path:     _url.pathname,
    method:   'POST',
    headers: {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };
  const req = http.request(options, (res) => {
    res.on('data', () => {});
    res.on('end',  () => {});
  });
  req.on('error', (err) => {
    twarn(`[Clipboard] POST failed: [${err.code}] ${err.message}`);
  });
  req.write(body);
  req.end();
}

function pollClipboard() {
  try {
    // Prefer image if present (image formats usually also have a text repr)
    const img = clipboard.readImage();
    if (img && !img.isEmpty()) {
      const pngBuf  = img.toPNG();
      const hash    = sha1(pngBuf);
      if (hash !== lastClipboardHash) {
        lastClipboardHash = hash;
        const dataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`;
        tlog(`[Clipboard] New image ${pngBuf.length}B hash=${hash.slice(0,8)}`);
        postClipboardItem('image', dataUrl, hash);
      }
      return;
    }

    const text = clipboard.readText();
    if (text && text.trim()) {
      const hash = sha1(Buffer.from(text, 'utf8'));
      if (hash !== lastClipboardHash) {
        lastClipboardHash = hash;
        tlog(`[Clipboard] New text ${text.length} chars hash=${hash.slice(0,8)}`);
        postClipboardItem('text', text, hash);
      }
    }
  } catch (e) {
    twarn('[Clipboard] poll error:', e.message);
  }
}

function startClipboardMonitor() {
  tlog(`[Clipboard] Starting monitor — poll every ${CLIPBOARD_POLL_MS}ms`);
  // Prime baseline so the value already on the clipboard at startup is not
  // re-logged on first tick.
  try {
    const img = clipboard.readImage();
    if (img && !img.isEmpty()) {
      lastClipboardHash = sha1(img.toPNG());
    } else {
      const text = clipboard.readText();
      if (text) lastClipboardHash = sha1(Buffer.from(text, 'utf8'));
    }
  } catch { /* ignore */ }
  clipboardPollTimer = setInterval(pollClipboard, CLIPBOARD_POLL_MS);
}

// =============================================================================
// Chromium flags — must be set BEFORE app.whenReady()
// =============================================================================
//
// MediaFoundationAsyncCreate: on some Windows audio drivers, async MF device
// creation races against the WASAPI capture session and causes a
// STATUS_ACCESS_VIOLATION (0xC0000005) in the renderer process.
// Disabling it forces synchronous device creation, eliminating the race.
app.commandLine.appendSwitch('disable-features', 'MediaFoundationAsyncCreate');

// Windows toast notifications require a stable AppUserModelID so the OS can
// associate the notification with a registered application. Without this,
// Electron running as electron.exe (dev) or an unsigned build will silently
// drop all Notification.show() calls on Windows 10/11.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.sadik.app');
}

app.whenReady().then(() => {
  tlog('[SADIK] app.whenReady() fired — starting initialization');
  tlog(`[SADIK] Backend base URL: ${BACKEND_ORIGIN}`);
  tlog(`[SADIK] Platform: ${process.platform} | Electron: ${process.versions.electron}`);

  // ── Media permission handler ──────────────────────────────────────────────
  //
  // Without this, Chromium routes getUserMedia and enumerateDevices through the
  // OS permission-request code path.  On Windows this path can produce a
  // STATUS_ACCESS_VIOLATION (exitCode -1073741819 / 0xC0000005) inside
  // Chromium's WASAPI audio-device initialisation, crashing the renderer.
  //
  // Registering a handler here intercepts the permission check in the main
  // process BEFORE the native OS dialog / WinRT device enumeration is reached,
  // which prevents the crash.  Media access is granted unconditionally because
  // SADIK is a local desktop assistant that legitimately needs the microphone.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const MEDIA_PERMISSIONS = new Set(['media', 'microphone', 'camera', 'mediaKeySystem']);
    const granted = MEDIA_PERMISSIONS.has(permission);
    tlog(`[SADIK] Permission request: "${permission}" → ${granted ? 'granted' : 'denied'}`);
    callback(granted);
  });

  // setPermissionCheckHandler: intercepts synchronous permission checks (e.g.
  // navigator.permissions.query, MediaDevices.getUserMedia pre-checks).
  // Without this, Chromium may still reach the native OS WinRT path for the
  // check phase even though the request handler already grants the actual request.
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const MEDIA_PERMISSIONS = new Set(['media', 'microphone', 'camera', 'mediaKeySystem']);
    const granted = MEDIA_PERMISSIONS.has(permission);
    tlog(`[SADIK] Permission check: "${permission}" → ${granted ? 'granted' : 'denied'}`);
    return granted;
  });

  initTray();
  createWindow();
  startAppTracker();

  // Emit raw idle seconds every 30s; renderer applies user-configured threshold
  // (oled_sleep_timeout_minutes) and gates on device-connected state. When the
  // device is disconnected, firmware owns sleep decisions and we stay silent.
  startClipboardMonitor();

  idleCheckInterval = setInterval(() => {
    if (!mainWindow) return;
    const idleSeconds = powerMonitor.getSystemIdleTime();
    mainWindow.webContents.send('sadik:idle-tick', { idleSeconds });
  }, 30000);

  tlog('[SADIK] Initialization sequence dispatched');
});

// Only quit via window-all-closed when:
//   • tray was never created, OR
//   • forceQuit is already set (real quit already in progress)
// When hiding to tray the main window is merely hidden, not closed, so this
// event should not fire in normal tray-hide flow.  The guard covers edge cases
// such as the window being force-closed by an external process.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!tray || forceQuit) app.quit();
  }
});

app.on('activate', () => {
  // macOS: re-show or recreate the window when the dock icon is clicked.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    showMainWindow();
  }
});
