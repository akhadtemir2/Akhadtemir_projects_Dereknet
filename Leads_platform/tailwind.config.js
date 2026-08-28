/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sidebar: '#111412',
        'sidebar-hover': '#1a1d1a',
        main: '#1A1C1A',
        card: '#222520',
        'card-hover': '#272a27',
        border: '#2d302d',
        accent: '#7A8B69',
        'accent-dim': '#5a6b4f',
        beige: '#D4C6B9',
        'text-p': '#e8e4dd',
        'text-s': '#9a9e92',
        'text-m': '#626860',
        hot: '#e8624a',
        'hot-dim': '#3d2018',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
