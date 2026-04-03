/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0a',
        foreground: '#ededed',
        card: '#141414',
        'card-hover': '#1a1a1a',
        border: '#262626',
        muted: '#a1a1aa',
        accent: '#3b82f6',
        'accent-hover': '#2563eb',
      },
    },
  },
  plugins: [],
}
