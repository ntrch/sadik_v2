import React, { useEffect, useState } from 'react';
import { telemetryApi } from '../../api/telemetry';
import { settingsApi } from '../../api/settings';
import { invalidateCrashReporterConsent } from '../../services/crashReporter';

/**
 * One-time banner shown after first launch asking for crash telemetry consent.
 * Shown only if `telemetry_consent_asked` is false in settings.
 * User choice persists immediately; banner never shows again.
 */
export default function TelemetryConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Check if we've asked before
    settingsApi.get('telemetry_consent_asked')
      .then((s) => {
        if (s.value !== 'true') setVisible(true);
      })
      .catch(() => {});
  }, []);

  const _markAsked = () => {
    settingsApi.update({ telemetry_consent_asked: 'true' }).catch(() => {});
    setVisible(false);
  };

  const handleAllow = async () => {
    try {
      await telemetryApi.setConsent(true);
      invalidateCrashReporterConsent(true);
    } catch { /* best-effort */ }
    _markAsked();
  };

  const handleDeny = () => {
    // Leave consent as false (default); just mark asked
    invalidateCrashReporterConsent(false);
    _markAsked();
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4">
      <div className="bg-bg-card border border-border rounded-card shadow-lg p-4 space-y-3">
        <p className="text-sm font-semibold text-text-primary">
          Crash raporlarına izin ver?
        </p>
        <p className="text-xs text-text-muted leading-relaxed">
          Uygulama çöktüğünde anonim hata bilgisini geliştiriciye gönderir.
          Kişisel veri gönderilmez. Ayarlar'dan her zaman değiştirebilirsin.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleDeny}
            className="flex-1 py-2 text-xs rounded-btn bg-bg-input border border-border text-text-secondary hover:text-text-primary transition-colors"
          >
            Hayır
          </button>
          <button
            onClick={handleAllow}
            className="flex-[2] py-2 text-xs rounded-btn bg-accent-cyan text-white font-semibold hover:opacity-90 transition-opacity"
          >
            İzin ver
          </button>
        </div>
      </div>
    </div>
  );
}
