import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ListTodo, MessageSquare, BarChart2, Lightbulb, Rocket, Repeat, CalendarDays,
} from 'lucide-react';

const navItems = [
  { to: '/',         icon: LayoutDashboard, label: 'Ana Sayfa',    activeClass: 'bg-accent-purple/15 text-accent-purple' },
  { to: '/tasks',    icon: ListTodo,        label: 'Görevler',     activeClass: 'bg-accent-cyan/15 text-accent-cyan' },
  { to: '/agenda',   icon: CalendarDays,    label: 'Ajanda',       activeClass: 'bg-accent-purple/15 text-accent-purple' },
  { to: '/habits',   icon: Repeat,          label: 'Alışkanlıklar', activeClass: 'bg-accent-orange/15 text-accent-orange' },
  { to: '/memory',   icon: Lightbulb,       label: 'Düşünceler',   activeClass: 'bg-accent-yellow/15 text-accent-yellow' },
  { to: '/workspace', icon: Rocket,         label: 'Alan',         activeClass: 'bg-accent-pink/15 text-accent-pink' },
  { to: '/chat',     icon: MessageSquare,   label: 'Sohbet',       activeClass: 'bg-accent-red/15 text-accent-red' },
  { to: '/insights', icon: BarChart2,       label: 'Kullanım',     activeClass: 'bg-accent-green/15 text-accent-green' },
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 glass border border-white/10 rounded-2xl px-2 py-1.5 flex items-center gap-1 shadow-nav">
      {navItems.map(({ to, icon: Icon, label, activeClass }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          title={label}
          data-tutorial={to === '/tasks' ? 'nav-tasks' : undefined}
          className={({ isActive }) =>
            `p-3 rounded-xl transition-all flex items-center justify-center ${
              isActive
                ? activeClass
                : 'text-text-secondary/50 hover:text-text-primary hover:bg-white/5'
            }`
          }
        >
          <Icon size={22} />
        </NavLink>
      ))}
    </nav>
  );
}
