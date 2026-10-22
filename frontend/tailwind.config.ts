import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      // Extra steps so alpha modifiers like bg-red-500/12 and border-accent/35 generate.
      opacity: {
        '4': '0.04',
        '6': '0.06',
        '8': '0.08',
        '12': '0.12',
        '16': '0.16',
        '18': '0.18',
        '22': '0.22',
        '28': '0.28',
        '35': '0.35',
        '45': '0.45',
        '55': '0.55',
        '65': '0.65',
        '85': '0.85',
      },
      colors: {
        soc: {
          950: '#070a12',
          900: '#0b1120',
          850: '#0e1526',
          800: '#121a2d',
          750: '#16203a',
          700: '#1c2846',
          600: '#27355a',
          500: '#3a4a72',
          400: '#5a6b93',
          300: '#8b9ac0',
          200: '#b6c2e0',
          100: '#dee5f5',
        },
        severity: {
          info: '#64748b',
          low: '#0ea5e9',
          high: '#f59e0b',
          critical: '#ef4444',
        },
        accent: {
          DEFAULT: '#38bdf8',
          dim: '#0c4a6e',
        },
      },
      boxShadow: {
        panel: '0 1px 2px 0 rgb(0 0 0 / 0.4), 0 8px 24px -12px rgb(0 0 0 / 0.7)',
        glow: '0 0 0 1px rgb(56 189 248 / 0.25), 0 0 20px -4px rgb(56 189 248 / 0.35)',
      },
      keyframes: {
        'row-flash': {
          '0%': { backgroundColor: 'rgb(56 189 248 / 0.22)' },
          '100%': { backgroundColor: 'rgb(56 189 248 / 0)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseDot: {
          '0%,100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.35', transform: 'scale(0.8)' },
        },
      },
      animation: {
        'row-flash': 'row-flash 2.4s ease-out 1',
        'fade-in': 'fade-in 0.25s ease-out both',
        'pulse-dot': 'pulseDot 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
