/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,js,jsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: {
          main: '#121212',
          sidebar: '#1a1a1a',
          card: 'rgba(45, 45, 45, 0.55)',
          input: 'rgba(56, 56, 56, 0.6)',
          hover: '#404040',
          elevated: '#252525',
        },
        border: {
          DEFAULT: '#404040',
          subtle: '#333333',
          focus: '#7c3aed',
        },
        text: {
          primary: '#e4e4e7',
          secondary: '#a1a1aa',
          muted: '#6b6b73',
        },
        accent: {
          purple: '#a78bfa',
          'purple-hover': '#8b5cf6',
          'purple-dim': 'rgba(167, 139, 250, 0.12)',
          blue: '#7dd3fc',
          green: '#6ee7b7',
          yellow: '#fcd34d',
          red: '#fca5a5',
          orange: '#fdba74',
          cyan: '#67e8f9',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        card: '14px',
        btn: '14px',
        nav: '16px',
        full: '9999px',
      },
      boxShadow: {
        'glow': '0 0 20px rgba(167, 139, 250, 0.15)',
        'card': '0 2px 8px rgba(0, 0, 0, 0.3)',
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
