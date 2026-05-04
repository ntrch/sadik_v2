/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,js,jsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: {
          main: '#0B0F17',
          sidebar: '#0F1624',
          card: '#121826',
          input: '#1a2233',
          hover: '#1e2638',
          elevated: '#161d2b',
        },
        border: {
          DEFAULT: '#2a313b',
          subtle: '#1f242c',
          focus: '#22d3ee',
        },
        text: {
          primary: '#E6EAF2',
          secondary: '#8B93A7',
          muted: '#6b7280',
        },
        accent: {
          primary: '#6C5CE7',
          'primary-hover': '#5848d4',
          'primary-dim': 'rgba(108, 92, 231, 0.12)',
          purple: '#a78bfa',
          'purple-hover': '#8b5cf6',
          'purple-dim': 'rgba(167, 139, 250, 0.12)',
          blue: '#7dd3fc',
          green: '#6ee7b7',
          yellow: '#fcd34d',
          red: '#fca5a5',
          orange: '#fdba74',
          cyan: '#67e8f9',
          pink: '#f472b6',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        card: '18px',
        btn: '14px',
        nav: '16px',
        pill: '9999px',
        full: '9999px',
      },
      boxShadow: {
        'glow': '0 0 20px rgba(34, 211, 238, 0.15)',
        'card': '0 1px 2px rgba(0, 0, 0, 0.25)',
        'nav': '0 -4px 20px rgba(0, 0, 0, 0.4)',
        'header': '0 4px 20px rgba(0, 0, 0, 0.4)',
      },
      backdropBlur: {
        nav: '20px',
      },
    },
  },
  plugins: [],
};
