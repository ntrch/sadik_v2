import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, MessageSquare, RefreshCw, ChevronDown, ChevronUp, X, CheckCircle, Circle } from 'lucide-react';
import { telemetryApi, AdminTelemetryItem } from '../api/telemetry';
import { settingsApi } from '../api/settings';

const PAGE_SIZE = 20;

type KindFilter     = 'all' | 'crash' | 'feedback';
type ResolvedFilter = 'all' | 'true' | 'false';

// ── Date formatting ────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── Detail drawer ──────────────────────────────────────────────────────────────

function DetailDrawer({
  item,
  onClose,
  onResolveToggle,
}: {
  item: AdminTelemetryItem;
  onClose: () => void;
  onResolveToggle: (item: AdminTelemetryItem) => void;
}) {
  const [resolving, setResolving] = useState(false);

  const handleToggle = async () => {
    setResolving(true);
    try {
      await onResolveToggle(item);
    } finally {
      setResolving(false);
    }
  };

  let contextStr = '';
  if (item.context_json) {
    try { contextStr = JSON.stringify(JSON.parse(item.context_json), null, 2); }
    catch { contextStr = item.context_json; }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {/* Panel */}
      <div className="relative w-full max-w-xl bg-bg-card border-l border-border h-full overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-bg-card z-10">
          <div className="flex items-center gap-2">
            {item.kind === 'crash'
              ? <AlertTriangle size={16} className="text-accent-red" />
              : <MessageSquare size={16} className="text-accent-purple" />}
            <span className="text-sm font-semibold text-text-primary capitalize">{item.kind}</span>
            <span className="text-xs text-text-muted ml-1">#{item.id}</span>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4 flex-1">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-text-muted">Zaman</p>
              <p className="text-text-primary">{fmtDate(item.created_at)}</p>
            </div>
            <div>
              <p className="text-text-muted">Tür</p>
              <p className="text-text-primary">{item.error_type ?? '—'}</p>
            </div>
            <div>
              <p className="text-text-muted">Platform</p>
              <p className="text-text-primary">{item.platform ?? '—'}</p>
            </div>
            <div>
              <p className="text-text-muted">Versiyon</p>
              <p className="text-text-primary">{item.app_version ?? '—'}</p>
            </div>
          </div>

          {/* Message */}
          {item.message && (
            <div>
              <p className="text-xs text-text-muted mb-1">Mesaj</p>
              <p className="text-sm text-text-primary bg-bg-input border border-border rounded-btn p-3 break-words">
                {item.message}
              </p>
            </div>
          )}

          {/* Stack trace */}
          {item.stack && (
            <div>
              <p className="text-xs text-text-muted mb-1">Stack</p>
              <pre className="text-[11px] text-text-secondary bg-bg-input border border-border rounded-btn p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                {item.stack}
              </pre>
            </div>
          )}

          {/* Context */}
          {contextStr && (
            <div>
              <p className="text-xs text-text-muted mb-1">Bağlam</p>
              <pre className="text-[11px] text-text-secondary bg-bg-input border border-border rounded-btn p-3 overflow-x-auto whitespace-pre-wrap">
                {contextStr}
              </pre>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-border sticky bottom-0 bg-bg-card">
          <button
            onClick={handleToggle}
            disabled={resolving}
            className={`w-full py-2.5 text-sm rounded-btn font-semibold transition-colors disabled:opacity-60
              ${item.resolved
                ? 'bg-bg-input border border-border text-text-secondary hover:text-text-primary'
                : 'bg-accent-cyan/20 border border-accent-cyan/40 text-accent-cyan hover:bg-accent-cyan/30'}`}
          >
            {resolving ? 'Kaydediliyor…' : item.resolved ? 'Çözümsüz İşaretle' : 'Çözüldü İşaretle'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminTelemetryPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [items, setItems]     = useState<AdminTelemetryItem[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const [kindFilter,     setKindFilter]     = useState<KindFilter>('all');
  const [resolvedFilter, setResolvedFilter] = useState<ResolvedFilter>('all');
  const [page, setPage] = useState(0);

  const [selectedItem, setSelectedItem] = useState<AdminTelemetryItem | null>(null);

  // Admin check
  useEffect(() => {
    settingsApi.get('is_admin')
      .then((s) => setIsAdmin(s.value === 'true'))
      .catch(() => {
        // 404 → setting not set → not admin
        setIsAdmin(false);
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await telemetryApi.adminList({
        kind:     kindFilter,
        resolved: resolvedFilter,
        limit:    PAGE_SIZE,
        offset:   page * PAGE_SIZE,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [kindFilter, resolvedFilter, page]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const handleResolveToggle = async (item: AdminTelemetryItem) => {
    const newResolved = !item.resolved;
    if (item.kind !== 'crash' && item.kind !== 'feedback') return;
    await telemetryApi.adminResolve(item.kind, item.id, newResolved);
    // Optimistic update
    setItems((prev) => prev.map((i) =>
      i.id === item.id && i.kind === item.kind
        ? { ...i, resolved: newResolved, resolved_at: newResolved ? new Date().toISOString() : null }
        : i
    ));
    if (selectedItem?.id === item.id && selectedItem?.kind === item.kind) {
      setSelectedItem((prev) => prev ? { ...prev, resolved: newResolved } : null);
    }
  };

  if (isAdmin === null) {
    return <div className="p-6 text-text-muted text-sm">Kontrol ediliyor…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <p className="text-text-muted text-sm">Bu sayfaya erişim yetkiniz yok.</p>
        <p className="text-xs text-text-muted mt-1">
          Erişim için Settings'te <code className="bg-bg-input px-1 rounded">is_admin = true</code> ayarlayın
          ya da <code className="bg-bg-input px-1 rounded">SADIK_ADMIN_EMAIL</code> env var'ını tanımlayın.
        </p>
      </div>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-text-primary">Admin — Telemetri</h1>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-btn bg-bg-input border border-border text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs — kind filter */}
      <div className="flex gap-1.5 flex-wrap">
        {(['all', 'crash', 'feedback'] as KindFilter[]).map((k) => (
          <button
            key={k}
            onClick={() => { setKindFilter(k); setPage(0); }}
            className={`px-3 py-1.5 rounded-btn text-xs font-medium transition-colors
              ${kindFilter === k
                ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/40'
                : 'bg-bg-input border border-border text-text-secondary hover:text-text-primary'}`}
          >
            {k === 'all' ? 'Tümü' : k === 'crash' ? 'Crashes' : 'Feedback'}
          </button>
        ))}
        <div className="ml-auto flex gap-1.5">
          {(['all', 'false', 'true'] as ResolvedFilter[]).map((r) => (
            <button
              key={r}
              onClick={() => { setResolvedFilter(r); setPage(0); }}
              className={`px-3 py-1.5 rounded-btn text-xs font-medium transition-colors
                ${resolvedFilter === r
                  ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/40'
                  : 'bg-bg-input border border-border text-text-secondary hover:text-text-primary'}`}
            >
              {r === 'all' ? 'Tümü' : r === 'true' ? 'Çözüldü' : 'Çözülmedi'}
            </button>
          ))}
        </div>
      </div>

      {/* Devices placeholder tab */}
      <div className="bg-bg-card border border-border rounded-card p-4">
        <p className="text-xs text-text-muted">
          <span className="font-medium text-text-secondary">Devices (T7.8)</span> —{' '}
          License server entegrasyonu T7.8'de eklenecek.
        </p>
      </div>

      {error && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-btn p-3 text-xs text-accent-red">
          {error}
        </div>
      )}

      {/* Table */}
      {items.length === 0 && !loading ? (
        <p className="text-text-muted text-sm text-center py-8">Kayıt bulunamadı.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={`${item.kind}-${item.id}`}
              className="bg-bg-card border border-border rounded-card p-3 hover:border-accent-purple/40 transition-colors cursor-pointer"
              onClick={() => setSelectedItem(item)}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0">
                  {item.kind === 'crash'
                    ? <AlertTriangle size={14} className="text-accent-red" />
                    : <MessageSquare size={14} className="text-accent-purple" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-text-primary">
                      {item.error_type ?? '(no type)'}
                    </span>
                    <span className="text-[11px] text-text-muted">{fmtDate(item.created_at)}</span>
                    {item.app_version && (
                      <span className="text-[11px] text-text-muted">v{item.app_version}</span>
                    )}
                    {item.resolved && (
                      <span className="flex items-center gap-0.5 text-[11px] text-accent-cyan">
                        <CheckCircle size={11} /> çözüldü
                      </span>
                    )}
                  </div>
                  {item.message && (
                    <p className="text-xs text-text-secondary mt-0.5 truncate">
                      {item.message}
                    </p>
                  )}
                </div>
                <button
                  className="text-xs text-accent-purple hover:underline flex-shrink-0 ml-2"
                  onClick={(e) => { e.stopPropagation(); setSelectedItem(item); }}
                >
                  Görüntüle
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 text-xs rounded-btn bg-bg-input border border-border text-text-secondary disabled:opacity-40"
          >
            ‹ Önceki
          </button>
          <span className="text-xs text-text-muted">
            {page + 1} / {totalPages} ({total} kayıt)
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 text-xs rounded-btn bg-bg-input border border-border text-text-secondary disabled:opacity-40"
          >
            Sonraki ›
          </button>
        </div>
      )}

      {/* Detail drawer */}
      {selectedItem && (
        <DetailDrawer
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onResolveToggle={handleResolveToggle}
        />
      )}
    </div>
  );
}
