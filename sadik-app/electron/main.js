'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, session, ipcMain } = require('electron');
const path    = require('path');
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
      nodeIntegration:  false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle:    process.platform === 'darwin' ? 'hidden' : 'default',
    autoHideMenuBar:  true,
  });

  mainWindow = win;

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
  win.on('focus',       () => tlog('[SADIK] Window focus'));
  win.on('blur',        () => tlog('[SADIK] Window blur'));
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
// Chromium flags — must be set BEFORE app.whenReady()
// =============================================================================
//
// MediaFoundationAsyncCreate: on some Windows audio drivers, async MF device
// creation races against the WASAPI capture session and causes a
// STATUS_ACCESS_VIOLATION (0xC0000005) in the renderer process.
// Disabling it forces synchronous device creation, eliminating the race.
app.commandLine.appendSwitch('disable-features', 'MediaFoundationAsyncCreate');

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
