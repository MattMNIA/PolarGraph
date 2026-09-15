/** @type {import('tailwindcss').Config} */

// The brand runs on exactly two ramps: Tailwind's stock `blue` (the only
// chromatic colour) and stock `gray`. No custom palette is needed — see
// ../../PortfolioSite/DESIGN_SYSTEM.md §1.1. Red appears only on destructive
// machine controls and error text.
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Native UI type is part of the look; no display webfont.
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Noto Sans',
          'sans-serif',
          'Apple Color Emoji',
          'Segoe UI Emoji',
        ],
      },
    },
  },
  plugins: [],
}
