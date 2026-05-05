import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Bug, Sparkles, MessageSquare, Camera } from 'lucide-react';
import { feedbackApi, FeedbackBody } from '../../api/feedback';

// ── Types ─────────────────────────────────────────────────────────────────────

type FeedbackType = 'bug' | 'feature' | 'other';

interface Props {
  onClose: () => void;
}

// ── Label maps ────────────────────────────────────────────────────────────────

const TYPE_OPTIONS: { value: FeedbackType; label: string; icon: React.ReactNode }[] = [
  { value: 'bug',     label: 'Hata (Bug)',       icon: <Bug size={14} /> },
  { value: 'feature', label: 'Özellik İsteği',   icon: <Sparkles size={14} /> },
  { value: 'other',   label: 'Diğer',            icon: <MessageSquare size={14} /> },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getContextInfo() {
  return {
    app_version: (window as any).__APP_VERSION__ ?? undefined,
    os_info: navigator.platform ?? undefined,
    current_page: window.location.hash || '/',
  };
}

async function captureScreenshot(): Promise<string | null> {
  const api = (window as any).electronAPI;
  if (!api?.captureScreenshot) return null;
  try {
    const b64: string | null = await api.captureScreenshot();
    return b64 ?? null;
  } catch {
    return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FeedbackModal({ onClose }: Props) {
  const [type, setType] = useState<FeedbackType>('bug');
  const [body, setBody] = useState('');
  const [screenshotEnabled, setScreenshotEnabled] = useState(false);
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isHiddenForCapture, setIsHiddenForCapture] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Electron API availability
  const hasElectronScreenshot = typeof (window as any).electronAPI?.captureScreenshot === 'function';

  // ESC to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Auto-capture when toggle turns on
  useEffect(() => {
    if (!screenshotEnabled) {
      setScreenshotBase64(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsCapturing(true);
      setIsHiddenForCapture(true);
      try {
        await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        await new Promise(r => setTimeout(r, 80));
        const b64 = await captureScreenshot();
        if (!cancelled) setScreenshotBase64(b64);
      } finally {
        if (!cancelled) {
          setIsHiddenForCapture(false);
          setIsCapturing(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [screenshotEnabled]);

  const showToast = useCallback((message: string, ok: boolean) => {
    setToast({ message, ok });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const isValid = body.trim().length >= 10 && body.trim().length <= 2000;

  const handleSubmit = async () => {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    const ctx = getContextInfo();
    const payload: FeedbackBody = {
      type,
      body: body.trim(),
      screenshot_base64: screenshotBase64 ?? undefined,
      ...ctx,
    };
    try {
      await feedbackApi.submit(payload);
      showToast('Teşekkürler, geri bildiriminiz alındı 🙌', true);
      setTimeout(() => onClose(), 2800);
    } catch {
      showToast('Gönderilemedi, lütfen tekrar deneyin', false);
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
        style={{ display: isHiddenForCapture ? 'none' : undefined }}
      />

      {/* Modal panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Geri Bildirim Gönder"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
        style={{ display: isHiddenForCapture ? 'none' : undefined }}
      >
        <div
          className="pointer-events-auto w-full max-w-lg bg-bg-card border border-border rounded-card shadow-card flex flex-col animate-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <MessageSquare size={18} className="text-accent-purple" />
              <span className="font-semibold text-text-primary">Geri Bildirim Gönder</span>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
              aria-label="Kapat"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-4 px-5 py-4">
            {/* Type selector */}
            <div>
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 block">
                Tür
              </label>
              <div className="flex gap-2">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setType(opt.value)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-btn text-sm font-medium border transition-all ${
                      type === opt.value
                        ? 'bg-accent-purple/20 border-accent-purple/50 text-accent-purple'
                        : 'bg-bg-input border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                    }`}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Free-text */}
            <div>
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 block">
                Mesajınız
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Geri bildiriminizi yazın..."
                rows={5}
                maxLength={2000}
                className="w-full bg-bg-input border border-border rounded-btn px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent-purple/60 transition-colors"
              />
              <div className="flex justify-between mt-1">
                {body.trim().length > 0 && body.trim().length < 10 && (
                  <span className="text-xs text-accent-red">En az 10 karakter gerekli</span>
                )}
                <span className="text-xs text-text-muted ml-auto">
                  {body.trim().length} / 2000
                </span>
              </div>
            </div>

            {/* Screenshot toggle */}
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <label className={`flex items-center gap-2 cursor-pointer select-none ${!hasElectronScreenshot ? 'opacity-40 cursor-not-allowed' : ''}`}>
                  <input
                    type="checkbox"
                    checked={screenshotEnabled}
                    disabled={!hasElectronScreenshot}
                    onChange={(e) => setScreenshotEnabled(e.target.checked)}
                    className="w-4 h-4 accent-purple-500 cursor-pointer"
                  />
                  <Camera size={14} className="text-text-secondary" />
                  <span className="text-sm text-text-primary">Ekran görüntüsü ekle</span>
                  {!hasElectronScreenshot && (
                    <span className="text-xs text-text-muted">(yalnızca Electron'da)</span>
                  )}
                </label>
              </div>
              {isCapturing && (
                <span className="text-xs text-text-muted animate-pulse">Alınıyor...</span>
              )}
            </div>

            {/* Screenshot preview */}
            {screenshotBase64 && (
              <div className="relative w-full rounded-btn overflow-hidden border border-border">
                <img
                  src={`data:image/png;base64,${screenshotBase64}`}
                  alt="Screenshot önizleme"
                  className="w-full h-32 object-cover object-top"
                />
                <button
                  onClick={() => { setScreenshotBase64(null); setScreenshotEnabled(false); }}
                  className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                  aria-label="Screenshot'ı kaldır"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            {/* KVKK disclaimer */}
            <p className="text-xs text-text-muted leading-relaxed border-t border-border pt-3">
              Bu mesaj uygulama geliştiricisine gönderilecek. Hiçbir kişisel veri (e-posta, IBAN vb.)
              içermediğinden emin olun. Devam ederek bu bilgiyi paylaşmayı kabul ediyorsunuz.
            </p>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-btn text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
            >
              İptal
            </button>
            <button
              onClick={handleSubmit}
              disabled={!isValid || isSubmitting}
              className="flex items-center gap-2 px-5 py-2 rounded-btn text-sm font-semibold bg-accent-purple hover:bg-accent-purple-hover text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Gönderiliyor...
                </>
              ) : (
                'Gönder'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-5 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-card shadow-card text-sm font-medium text-white animate-fade-in transition-opacity ${
            toast.ok ? 'bg-accent-green' : 'bg-accent-red'
          }`}
        >
          {toast.message}
        </div>
      )}
    </>
  );
}
