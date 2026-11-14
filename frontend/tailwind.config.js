/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // "teal & saffron": ink = near-black with a cool green cast; electric = luminous teal (primary); violet = saffron gold (accent)
        ink: { 950: '#030608', 900: '#060b0f', 850: '#0a1218', 800: '#0f1a22', 700: '#182833' },
        electric: { 300: '#8ff5e8', 400: '#3fe6d2', 500: '#14c9b5', 600: '#0ea494' },
        violet: { 300: '#ffd89a', 400: '#ffbf57', 500: '#f5a524' },
        good: '#34d399', warn: '#fbbf24', bad: '#f87171',
      },
      fontFamily: {
        display: ['Sora', 'Noto Sans Devanagari', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'Noto Sans Devanagari', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: { glow: '0 0 40px -8px rgba(20,201,181,.55)', violet: '0 0 50px -10px rgba(245,165,36,.45)' },
      keyframes: {
        aurora: { '0%,100%': { transform: 'translate(0,0) scale(1)' }, '50%': { transform: 'translate(6%,-4%) scale(1.15)' } },
        spin: { to: { transform: 'rotate(360deg)' } },
        marquee: { to: { transform: 'translateX(-50%)' } },
        shine: { '0%': { transform: 'translateX(-120%) skewX(-20deg)' }, '60%,100%': { transform: 'translateX(220%) skewX(-20deg)' } },
      },
      animation: { aurora: 'aurora 18s ease-in-out infinite', 'spin-slow': 'spin 6s linear infinite', marquee: 'marquee 40s linear infinite', shine: 'shine 3.2s ease-in-out infinite' },
    },
  },
  plugins: [],
}
