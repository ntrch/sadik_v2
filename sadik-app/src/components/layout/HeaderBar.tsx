import React, { useContext, useState, useEffect } from 'react';
import { Usb, Wifi, ChevronDown, X, RotateCw, Sun, SunDim, Mic, MicOff, Settings, Sunrise, CloudSun, Sunset, Moon, Radio, BellOff, Bell, CloudRain, CloudDrizzle, CloudSnow, CloudLightning, Cloud, CloudFog } from 'lucide-react';
import type { WeatherGroup } from '../../api/weather';
import { useDevice } from '../../hooks/useDevice';
import { useNavigate, useLocation } from 'react-router-dom';
import { deviceApi, SerialPort } from '../../api/device';
import { settingsApi } from '../../api/settings';
import { AppContext } from '../../context/AppContext';
import OledPreview from './OledPreview';

function useCurrentTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function getTimeOfDayIcon(hour: number, size = 40) {
  if (hour >= 6 && hour < 12) return <Sunrise size={size} className="text-accent-yellow" />;
  if (hour >= 12 && hour < 17) return <CloudSun size={size} className="text-accent-orange" />;
  if (hour >= 17 && hour < 20) return <Sunset size={size} className="text-accent-orange" />;
  if (hour >= 20 && hour < 23) return <Moon size={size} className="text-accent-purple" />;
  return <Moon size={size} className="text-accent-yellow" />;
}

/** Standalone weather icon — colored, shown to the right of the clock when
 *  the feature is enabled. Sized to match the old time-of-day icon. */
function getWeatherIcon(group: WeatherGroup | undefined, size = 42) {
  if (!group) return null;
  const filled = { fill: 'currentColor', strokeWidth: 1.25 } as const;
  switch (group) {
    case 'clear':        return <Sun            size={size} className="text-accent-yellow" {...filled} />;
    case 'partly_cloudy':return <CloudSun       size={size} className="text-accent-orange" {...filled} />;
    case 'clouds':       return <Cloud          size={size} className="text-text-secondary" {...filled} />;
    case 'rain':         return <CloudRain      size={size} className="text-accent-cyan" {...filled} />;
    case 'drizzle':      return <CloudDrizzle   size={size} className="text-accent-cyan" {...filled} />;
    case 'thunderstorm': return <CloudLightning size={size} className="text-accent-purple" {...filled} />;
    case 'snow':         return <CloudSnow      size={size} className="text-white" {...filled} />;
    case 'mist':         return <CloudFog       size={size} className="text-text-secondary" {...filled} />;
    default:             return <Cloud          size={size} className="text-text-secondary" {...filled} />;
  }
}

export default function HeaderBar() {
  const {
    deviceStatus, oledBrightnessPercent, setOledBrightness,
    autoConnectDevice, wakeWordEnabled, wakeWordActive, toggleWakeWord,
    voiceAssistantActive, setVoiceUiVisible,
    dndActive, setDndActive,
    weatherEnabled, weatherData,
  } = useContext(AppContext);
  const { connect, disconnect } = useDevice();
  const navigate = useNavigate();
  const location = useLocation();
  const now = useCurrentTime();

  const [showConnect, setShowConnect] = useState(false);
  const [tab, setTab] = useState<'serial' | 'wifi'>('serial');
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [wifiIp, setWifiIp] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoConnecting, setAutoConnecting] = useState(false);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    settingsApi.getAll().then((s) => {
      setUserName(s['user_name'] ?? '');
    }).catch(() => {});
  }, []);

  const openConnect = async () => {
    setShowConnect(true);
    const p = await deviceApi.listPorts().catch(() => []);
    setPorts(p);
  };

  const handleSerial = async (port: string) => {
    setLoading(true);
    try { await connect('serial', port); setShowConnect(false); } catch {}
    setLoading(false);
  };

  const handleWifi = async () => {
    if (!wifiIp) return;
    setLoading(true);
    try { await connect('wifi', undefined, wifiIp); setShowConnect(false); } catch {}
    setLoading(false);
  };

  const handleAuto = async () => {
    setAutoConnecting(true);
    try { await autoConnectDevice(); } finally { setAutoConnecting(false); }
  };

  const timeStr = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const hour = now.getHours();

  return (
    <header className="glass-heavy border-b border-border shadow-header sticky top-0 z-30">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center pl-8 pr-5 py-2.5">
        {/* Left — weather icon (°C top-left) → clock+date → time-of-day icon → greeting */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            {/* Weather icon first (colored, with °C badge top-left, spaced) */}
            {weatherEnabled && weatherData && (
              <>
                <div
                  className="relative inline-flex items-center justify-center flex-shrink-0"
                  style={{ width: 48, height: 48 }}
                  title={`${weatherData.description} • ${weatherData.city} • hissedilen ${weatherData.feels_like_c}°C`}
                >
                  {getWeatherIcon(weatherData.condition_group, 44)}
                  <span className="absolute -top-3 -left-3 text-[10px] font-semibold text-text-primary tabular-nums bg-bg-card/90 rounded-full px-1.5 py-0.5 shadow-sm leading-none">
                    {Math.round(weatherData.temp_c)}°
                  </span>
                </div>
                <div className="w-px h-8 bg-border/40" />
              </>
            )}
            {/* Clock + date with time-of-day icon inline next to the time */}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold text-text-primary tabular-nums tracking-wide leading-none">{timeStr}</span>
                <span className="flex-shrink-0">{getTimeOfDayIcon(hour, 24)}</span>
              </div>
              <p className="text-xs text-text-secondary mt-0.5 capitalize">{dateStr}</p>
            </div>
          </div>
          {userName && (
            <>
              <div className="w-px h-8 bg-border/40" />
              <span className="text-xl font-semibold text-text-primary truncate">Merhaba, {userName}</span>
            </>
          )}
        </div>

        {/* Center — OLED preview + connection */}
        <div className="flex flex-col items-center gap-1">
          <OledPreview />
          <div className="flex items-center justify-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${deviceStatus.connected ? 'bg-accent-green' : 'bg-accent-red'}`} />
            {deviceStatus.connected ? (
              <>
                <span className="text-[10px] text-accent-green font-medium">Bağlı</span>
                <button onClick={disconnect}
                  title="Bağlantıyı kes"
                  className="w-5 h-5 rounded-full flex items-center justify-center text-text-muted hover:bg-accent-red/20 hover:text-accent-red transition-all">
                  <X size={10} />
                </button>
              </>
            ) : (
              <>
                <button onClick={handleAuto} disabled={autoConnecting}
                  title="Otomatik bağlan"
                  className="w-5 h-5 rounded-full flex items-center justify-center text-text-muted hover:text-accent-purple transition-all">
                  <RotateCw size={10} className={autoConnecting ? 'animate-spin' : ''} />
                </button>
                <button onClick={openConnect}
                  className="text-[10px] text-accent-purple hover:text-accent-purple-hover font-medium transition-colors flex items-center gap-0.5">
                  Bağlan <ChevronDown size={8} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Right — brightness + mic + settings */}
        <div className="flex items-center gap-3 justify-self-end">
          {voiceAssistantActive && (
            <button
              onClick={() => { navigate('/chat'); setVoiceUiVisible(true); }}
              title="Sesli asistan çalışıyor — görmek için tıkla"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-cyan/15 border border-accent-cyan/40 text-accent-cyan text-xs font-semibold animate-pulse"
            >
              <Radio size={12} />
              Sesli Asistan Aktif
            </button>
          )}
          {(() => {
            // OLED effectively has two usable levels (dim / full), so expose a
            // toggle instead of a misleading 0-100 slider. Icon reflects state.
            const isFull = oledBrightnessPercent > 50;
            const nextValue = isFull ? 30 : 100;
            return (
              <button
                onClick={() => setOledBrightness(nextValue)}
                title={isFull ? 'Ekstra Parlaklık: Açık' : 'Ekstra Parlaklık: Kapalı'}
                className={`p-2.5 rounded-full transition-all ${
                  isFull
                    ? 'bg-accent-yellow/20 text-accent-yellow hover:bg-accent-yellow/30'
                    : 'bg-bg-input text-text-muted hover:text-text-secondary'
                }`}
              >
                {isFull ? <Sun size={20} /> : <SunDim size={20} />}
              </button>
            );
          })()}

          <button
            onClick={() => setDndActive(!dndActive)}
            title="Rahatsız Etmeyin (Windows'ta sistem Focus Assist'ini manuel açın: Win+A → Focus)"
            className={`p-2.5 rounded-full transition-all ${
              dndActive
                ? 'bg-accent-red/20 text-accent-red hover:bg-accent-red/30'
                : 'bg-bg-input text-text-muted hover:text-text-secondary'
            }`}
          >
            {dndActive ? <BellOff size={20} /> : <Bell size={20} />}
          </button>

          <div className="w-px h-5 bg-border/50" />

          <button
            data-tutorial="voice-btn"
            onClick={toggleWakeWord}
            title={wakeWordEnabled ? 'Sesli komutu kapat' : 'Sesli komutu aç'}
            className={`p-2.5 rounded-full transition-all ${
              wakeWordEnabled
                ? 'bg-accent-purple-dim text-accent-purple hover:bg-accent-purple/20'
                : 'bg-bg-input text-text-muted hover:text-text-secondary'
            }`}
          >
            {wakeWordEnabled ? (
              <Mic size={20} className={wakeWordActive ? 'animate-pulse' : ''} />
            ) : (
              <MicOff size={20} />
            )}
          </button>

          <button
            data-tutorial="nav-settings"
            onClick={() => navigate('/settings')}
            title="Ayarlar"
            className={`p-2.5 rounded-full transition-all ${
              location.pathname === '/settings'
                ? 'bg-accent-purple-dim text-accent-purple'
                : 'bg-bg-input text-text-muted hover:text-text-secondary'
            }`}
          >
            <Settings size={20} />
          </button>
        </div>
      </div>

      {/* Connection popover */}
      {showConnect && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-72 glass-heavy border border-border rounded-card shadow-card z-50 p-4 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-text-primary">Cihaz Bağlantısı</span>
            <button onClick={() => setShowConnect(false)} className="text-text-muted hover:text-text-primary">
              <X size={14} />
            </button>
          </div>
          <div className="flex gap-1 mb-3">
            <button onClick={() => setTab('serial')}
              className={`flex-1 text-sm py-2 rounded-btn flex items-center justify-center gap-1.5 transition-colors
                ${tab === 'serial' ? 'bg-accent-purple text-white' : 'bg-bg-input text-text-secondary hover:text-text-primary'}`}>
              <Usb size={14} /> USB
            </button>
            <button onClick={() => setTab('wifi')}
              className={`flex-1 text-sm py-2 rounded-btn flex items-center justify-center gap-1.5 transition-colors
                ${tab === 'wifi' ? 'bg-accent-purple text-white' : 'bg-bg-input text-text-secondary hover:text-text-primary'}`}>
              <Wifi size={14} /> WiFi
            </button>
          </div>

          {tab === 'serial' && (
            <div className="space-y-1.5">
              {ports.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-3">Port bulunamadı</p>
              ) : (
                ports.map((p) => (
                  <button key={p.port} onClick={() => handleSerial(p.port)} disabled={loading}
                    className="w-full text-left text-sm px-3 py-2 bg-bg-input hover:bg-bg-hover rounded-btn transition-colors">
                    <span className="text-text-primary font-medium">{p.port}</span>
                    <span className="text-text-muted ml-2 truncate">{p.description}</span>
                  </button>
                ))
              )}
              <button onClick={() => handleSerial('auto')} disabled={loading}
                className="w-full text-sm px-3 py-2 bg-accent-purple hover:bg-accent-purple-hover text-white rounded-btn transition-colors mt-1">
                Otomatik Bul
              </button>
            </div>
          )}

          {tab === 'wifi' && (
            <div className="space-y-2">
              <input
                type="text" value={wifiIp} onChange={(e) => setWifiIp(e.target.value)}
                placeholder="192.168.1.x"
                className="input-field"
              />
              <button onClick={handleWifi} disabled={loading || !wifiIp}
                className="w-full text-sm px-3 py-2 bg-accent-purple hover:bg-accent-purple-hover text-white rounded-btn transition-colors disabled:opacity-50">
                Bağlan
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
