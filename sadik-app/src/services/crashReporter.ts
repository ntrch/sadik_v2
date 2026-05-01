/**
 * crashReporter.ts — Renderer-process crash/unhandled-rejection hooks.
 *
 * Listens for window.error and window.unhandledrejection, then forwards
 * the report to the main process via IPC (which POSTs to the backend).
 * Consent is cached at init and refreshed whenever toggleConsent() is called.
 */
import { telemetryApi } from '../api/telemetry';

let _consentCached: boolean | null = null;

async function _getConsent(): Promise<boolean> {
  if (_consentCached !== null) return _consentCached;
  try {
    const { enabled } = await telemetryApi.getConsent();
    _consentCached = enabled;
    return enabled;
  } catch {
    _consentCached = false;
    return false;
  }
}

/** Call when the user changes the consent toggle so the cache is invalidated. */
export function invalidateCrashReporterConsent(enabled: boolean) {
  _consentCached = enabled;
}

function _viaIpc(payload: {
  app_version?: string;
  platform?: string;
  error_type?: string;
  message?: string;
  stack?: string;
  context?: Record<string, unknown>;
}) {
  const api = (window as any).electronAPI;
  if (api?.reportCrash) {
    api.reportCrash(payload).catch(() => {});
  }
}

async function _handleError(
  errorType: string,
  message: string,
  stack: string | undefined,
  context: Record<string, unknown>,
) {
  try {
    if (!(await _getConsent())) return;
    _viaIpc({
      app_version: (window as any).__APP_VERSION__ ?? undefined,
      platform:    navigator.platform,
      error_type:  errorType,
      message,
      stack,
      context: { process: 'renderer', url: window.location.hash || '/', ...context },
    });
  } catch { /* crash reporter must never throw */ }
}

let _initialized = false;

/** Call once at app startup to wire renderer-process crash hooks. */
export function initCrashReporter() {
  if (_initialized) return;
  _initialized = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    const err = event.error;
    _handleError(
      err?.constructor?.name ?? 'Error',
      err?.message ?? event.message ?? 'Unknown error',
      err?.stack,
      { filename: event.filename, lineno: event.lineno, colno: event.colno },
    );
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const err    = reason instanceof Error ? reason : new Error(String(reason));
    _handleError(
      'UnhandledRejection',
      err.message,
      err.stack,
      {},
    );
  });
}
