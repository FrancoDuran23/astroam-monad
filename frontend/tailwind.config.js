/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep space grounds, from the page down to raised surfaces.
        space: {
          950: '#05050C',
          900: '#0A0A16',
          850: '#0F0F20',
          800: '#15152B',
          700: '#1F1F3B',
        },
        line: {
          DEFAULT: 'rgba(243, 242, 251, 0.08)',
          strong: 'rgba(243, 242, 251, 0.16)',
        },
        ink: {
          DEFAULT: '#F3F2FB',
          muted: '#A3A0BF',
          faint: '#6E6B8C',
        },
        // Accent: the signal. Primary actions and live data.
        signal: {
          DEFAULT: '#3CE6D4',
          deep: '#14B8A6',
          dim: 'rgba(60, 230, 212, 0.12)',
        },
        // AstroAm's ring violet: secondary brand color.
        orbit: {
          DEFAULT: '#8B6CFF',
          dim: 'rgba(139, 108, 255, 0.14)',
        },
        // The star in the logo. Used sparingly.
        star: '#FDDA24',
        ok: '#4ADE80',
        warn: '#FBBF24',
        alert: '#FF6B6B',
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"Space Mono"', 'ui-monospace', 'monospace'],
        pixel: ['"Press Start 2P"', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        floaty: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        tick: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '15%, 70%': { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(-14px)' },
        },
      },
      animation: {
        rise: 'rise 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both',
        floaty: 'floaty 5s ease-in-out infinite',
        tick: 'tick 1.6s ease-out both',
      },
    },
  },
  plugins: [],
}
