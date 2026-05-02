import React, { useEffect, useState } from 'react';

type UpdateState = 'idle' | 'available' | 'downloaded';

export default function UpdateBanner() {
  const [state, setState] = useState<UpdateState>('idle');

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;
    api.onUpdateAvailable?.(() => setState('available'));
    api.onUpdateDownloaded?.(() => setState('downloaded'));
  }, []);

  if (state === 'idle') return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4">
      <div className="bg-bg-card border border-border rounded-card shadow-lg p-4 flex items-center justify-between gap-3">
        <p className="text-sm text-text-primary">
          {state === 'available' ? 'Yeni sürüm indiriliyor...' : 'Yeni sürüm hazır.'}
        </p>
        {state === 'downloaded' && (
          <button
            onClick={() => (window as any).electronAPI?.quitAndInstall()}
            className="shrink-0 px-3 py-1.5 text-xs rounded-btn bg-accent-cyan text-white font-semibold hover:opacity-90 transition-opacity"
          >
            Yeniden başlat
          </button>
        )}
      </div>
    </div>
  );
}
