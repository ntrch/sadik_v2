/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,js,jsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: {
          main: '#0a0f1a',
          sidebar: '#0d1321',
          card: '#131b2e',
          input: '#1a2342',
          hover: '#1e2a4a',
        },
        border: {
          DEFAULT: '#1e2a4a',
          subtle: '#162036',
        },
        text: {
          primary: '#e2e8f0',
          secondary: '#8892b0',
          muted: '#4a5568',
        },
        accent: {
          blue: '#3b82f6',
          'blue-hover': '#2563eb',
          green: '#10b981',
          yellow: '#f59e0b',
          red: '#ef4444',
          purple: '#8b5cf6',
          brown: '#92643a',
          cyan: '#06b6d4',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
        btn: '8px',
      },
    },
  },
  plugins: [],
};
