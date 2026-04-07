import React, { useContext, useState, useRef, useEffect } from 'react';
import { Usb, Wifi, ChevronDown, X, RotateCw } from 'lucide-react';
import { useDevice } from '../../hooks/useDevice';
import { deviceApi, SerialPort } from '../../api/device';
import { AppContext } from '../../context/AppContext';

export default function DeviceStatus() {
  const { deviceStatus, connect, disconnect } = useDevice();
  const { autoConnectDevice } = useContext(AppContext);
  const [showPopover, setShowPopover] = useState(false);
  const [tab, setTab] = useState<'serial' | 'wifi'>('serial');
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [wifiIp, setWifiIp] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoConnecting, setAutoConnecting] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    }
    if (showPopover) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showPopover]);

  const openPopover = async () => {
    setShowPopover(true);
    const p = await deviceApi.listPorts().catch(() => []);
    setPorts(p);
  };

  const handleSerialConnect = async (port: string) => {
    setLoading(true);
    try {
      await connect('serial', port);
      setShowPopover(false);
    } catch {}
    setLoading(false);
  };

  const handleWifiConnect = async () => {
    if (!wifiIp) return;
    setLoading(true);
    try {
      await connect('wifi', undefined, wifiIp);
      setShowPopover(false);
    } catch {}
    setLoading(false);
  };

  const handleAutoConnect = async () => {
    setAutoConnecting(true);
    try {
      await autoConnectDevice();
    } finally {
      setAutoConnecting(false);
    }
  };

  const methodLabel = deviceStatus.method === 'serial' ? 'USB' : deviceStatus.method === 'wifi' ? 'WiFi' : null;

  return (
    <div className="relative mb-4" ref={popoverRef}>
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${deviceStatus.connected ? 'bg-accent-green' : 'bg-accent-red'}`} />
          <span className="text-xs text-text-secondary">
            {deviceStatus.connected ? 'Bağlı' : 'Bağlı Değil'}
          </span>
          {methodLabel && (
            <span className="text-xs bg-bg-input text-text-muted px-1.5 py-0.5 rounded">{methodLabel}</span>
          )}
        </div>
        {deviceStatus.connected ? (
          <button onClick={disconnect}
            className="text-xs text-text-muted hover:text-accent-red transition-colors">
            Kes
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={handleAutoConnect}
              disabled={autoConnecting}
              title="Otomatik bağlan"
              className="text-xs text-text-muted hover:text-accent-blue transition-colors disabled:opacity-50"
            >
              <RotateCw size={12} className={autoConnecting ? 'animate-spin' : ''} />
            </button>
            <button onClick={openPopover}
              className="text-xs text-accent-blue hover:text-blue-400 transition-colors flex items-center gap-1">
              Bağlan <ChevronDown size={10} />
            </button>
          </div>
        )}
      </div>

      {showPopover && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-bg-card border border-border rounded-card z-50 shadow-xl p-3 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-text-primary">Cihaz Bağlantısı</span>
            <button onClick={() => setShowPopover(false)} className="text-text-muted hover:text-text-primary">
              <X size={14} />
            </button>
          </div>
          <div className="flex gap-1 mb-3">
            <button onClick={() => setTab('serial')}
              className={`flex-1 text-xs py-1.5 rounded flex items-center justify-center gap-1 transition-colors
                ${tab === 'serial' ? 'bg-accent-blue text-white' : 'bg-bg-input text-text-secondary hover:text-text-primary'}`}>
              <Usb size={11} /> USB
            </button>
            <button onClick={() => setTab('wifi')}
              className={`flex-1 text-xs py-1.5 rounded flex items-center justify-center gap-1 transition-colors
                ${tab === 'wifi' ? 'bg-accent-blue text-white' : 'bg-bg-input text-text-secondary hover:text-text-primary'}`}>
              <Wifi size={11} /> WiFi
            </button>
          </div>

          {tab === 'serial' && (
            <div className="space-y-1">
              {ports.length === 0 ? (
                <p className="text-xs text-text-muted text-center py-2">Port bulunamadı</p>
              ) : (
                ports.map((p) => (
                  <button key={p.port} onClick={() => handleSerialConnect(p.port)} disabled={loading}
                    className="w-full text-left text-xs px-2 py-1.5 bg-bg-input hover:bg-bg-hover rounded transition-colors">
                    <span className="text-text-primary font-medium">{p.port}</span>
                    <span className="text-text-muted ml-2 truncate">{p.description}</span>
                  </button>
                ))
              )}
              <button onClick={() => handleSerialConnect('auto')} disabled={loading}
                className="w-full text-xs px-2 py-1.5 bg-accent-blue hover:bg-accent-blue-hover text-white rounded transition-colors mt-1">
                Otomatik Bul
              </button>
            </div>
          )}

          {tab === 'wifi' && (
            <div className="space-y-2">
              <input
                type="text"
                value={wifiIp}
                onChange={(e) => setWifiIp(e.target.value)}
                placeholder="192.168.1.x"
                className="w-full bg-bg-input border border-border rounded text-xs px-2 py-1.5 text-text-primary placeholder-text-muted outline-none focus:border-accent-blue"
              />
              <button onClick={handleWifiConnect} disabled={loading || !wifiIp}
                className="w-full text-xs px-2 py-1.5 bg-accent-blue hover:bg-accent-blue-hover text-white rounded transition-colors disabled:opacity-50">
                Bağlan
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
