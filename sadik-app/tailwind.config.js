/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,js,jsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: {
          main:     'rgb(var(--bg-main) / <alpha-value>)',
          sidebar:  'rgb(var(--bg-sidebar) / <alpha-value>)',
          card:     'rgb(var(--bg-card) / <alpha-value>)',
          input:    'rgb(var(--bg-input) / <alpha-value>)',
          hover:    'rgb(var(--bg-hover) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          subtle:  'rgb(var(--border-subtle) / <alpha-value>)',
          focus:   '#A78BFA',
        },
        text: {
          primary:   'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted:     'rgb(var(--text-muted) / <alpha-value>)',
        },
        accent: {
          primary: '#A78BFA',
          'primary-hover': '#8b5cf6',
          'primary-dim': 'rgba(167, 139, 250, 0.12)',
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
