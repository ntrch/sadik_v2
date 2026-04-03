import React, { useContext } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ListTodo, Timer, MessageSquare, Mic, Settings
} from 'lucide-react';
import OledPreview from './OledPreview';
import DeviceStatus from './DeviceStatus';
import { AppContext } from '../../context/AppContext';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/tasks', icon: ListTodo, label: 'Görevler' },
  { to: '/focus', icon: Timer, label: 'Odaklanma' },
  { to: '/chat', icon: MessageSquare, label: 'Sohbet' },
  { to: '/voice', icon: Mic, label: 'Sesli Asistan' },
  { to: '/settings', icon: Settings, label: 'Ayarlar' },
];

export default function Sidebar() {
  const { wakeWordEnabled, wakeWordActive, toggleWakeWord, wakeWordSensitivity } = useContext(AppContext);

  const SENSITIVITY_LABELS: Record<string, string> = {
    very_high: 'Çok Hassas',
    high:      'Hassas',
    normal:    'Normal',
    low:       'Düşük',
  };

  return (
    <aside className="w-[280px] flex-shrink-0 bg-bg-sidebar h-screen flex flex-col border-r border-border overflow-hidden">
      <div className="p-4 flex-1 overflow-y-auto">
        <OledPreview />
        <DeviceStatus />

        {/* ── Wake word status ─────────────────────────────────────────────── */}
        <div className="mt-2 px-2.5 py-2 bg-bg-card border border-border rounded-btn flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${
              wakeWordActive
                ? 'bg-accent-green animate-pulse'
                : wakeWordEnabled
                  ? 'bg-accent-green opacity-40'
                  : 'bg-text-muted opacity-50'
            }`}
          />
          <div className="flex-1 min-w-0">
            <span className="text-xs text-text-secondary block truncate">
              {wakeWordEnabled ? 'Sesli komut aktif' : 'Sesli komut kapalı'}
            </span>
            {wakeWordEnabled && (
              <span className="text-[10px] text-text-muted block truncate">
                Hassasiyet: {SENSITIVITY_LABELS[wakeWordSensitivity] ?? 'Normal'}
              </span>
            )}
          </div>
          <button
            onClick={toggleWakeWord}
            title={wakeWordEnabled ? 'Sesli komutu kapat' : 'Sesli komutu aç'}
            className={`relative inline-flex h-4 w-8 flex-shrink-0 items-center rounded-full transition-colors
              ${wakeWordEnabled ? 'bg-accent-green' : 'bg-bg-input border border-border'}`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform
                ${wakeWordEnabled ? 'translate-x-4' : 'translate-x-0.5'}`}
            />
          </button>
        </div>

        <div className="border-t border-border-subtle my-3" />
        <nav className="space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-btn text-sm font-medium transition-colors
                ${isActive
                  ? 'bg-accent-blue text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="p-4 border-t border-border-subtle">
        <p className="text-xs text-text-muted text-center">SADIK v2.0</p>
      </div>
    </aside>
  );
}
