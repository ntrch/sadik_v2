import { useEffect, useState, useCallback } from 'react';

type Theme = 'dark' | 'light';
const KEY = 'sadik.theme';

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {}
  return 'dark';
}

function apply(t: Theme) {
  const root = document.documentElement;
  if (t === 'light') root.classList.add('light');
  else root.classList.remove('light');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = read();
    apply(t);
    return t;
  });

  useEffect(() => {
    apply(theme);
    try { localStorage.setItem(KEY, theme); } catch {}
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggle };
}
