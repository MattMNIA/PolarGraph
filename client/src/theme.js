// src/theme.js
//
// Brand tokens for the Whiteboard Designer.
// These follow ../../PortfolioSite/DESIGN_SYSTEM.md so this app reads as the same
// brand as mattmn.com: one blue accent on a neutral gray ladder, generous vertical
// air, soft-cornered cards floating on flat section bands, hierarchy by opacity,
// and one 20px-rise fade for everything.

export const cn = (...classes) => classes.filter(Boolean).join(' ');

export const theme = {
  colors: {
    primary: {
      50: '#eff6ff',
      100: '#dbeafe',
      200: '#bfdbfe',
      300: '#93c5fd',
      400: '#60a5fa',
      500: '#3b82f6',
      600: '#2563eb',
      700: '#1d4ed8',
      800: '#1e40af',
      900: '#1e3a8a',
    },
    gray: {
      50: '#f9fafb',
      100: '#f3f4f6',
      200: '#e5e7eb',
      300: '#d1d5db',
      400: '#9ca3af',
      500: '#6b7280',
      600: '#4b5563',
      700: '#374151',
      800: '#1f2937',
      900: '#111827',
    },
  },

  // Page background pairs, used to drive <body> so safe areas never flash white.
  page: {
    light: '#f9fafb', // gray-50
    dark: '#111827', // gray-900
  },

  layout: {
    // One width for the whole app.
    container: 'mx-auto w-full max-w-6xl px-5 sm:px-6 safe-area-px',
    section: 'py-16 md:py-24',
    sectionTight: 'py-12 md:py-16',
    // Bands alternate down the page; there are no rules between sections.
    band: {
      a: 'bg-gray-50 dark:bg-gray-900',
      b: 'bg-gray-100 dark:bg-gray-800',
    },
  },

  surface: {
    // Cards always step *away* from their band: lighter in light, darker in dark.
    card: 'rounded-xl shadow-lg transition-colors duration-300 bg-white dark:bg-gray-900',
    // Inset areas inside a card (image frames, status panels, empty states).
    well: 'rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60',
  },

  animations: {
    fadeInUp: {
      initial: { opacity: 0, y: 20 },
      whileInView: { opacity: 1, y: 0 },
      viewport: { once: true, margin: '-40px' },
      transition: { duration: 0.6 },
    },
    fadeIn: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: 0.4 },
    },
    hover: {
      whileHover: { scale: 1.05 },
      whileTap: { scale: 0.95 },
    },
    hoverSubtle: {
      whileHover: { scale: 1.02 },
      whileTap: { scale: 0.98 },
    },
  },
};

// Adds a delay to the house transition without mutating it.
export const fadeInUpDelayed = (delay = 0) => ({
  ...theme.animations.fadeInUp,
  transition: { ...theme.animations.fadeInUp.transition, delay },
});

// Kept for call sites that still pick classes from a darkMode boolean.
export const getThemeClasses = (base, variants, darkMode) =>
  cn(base, darkMode ? variants.dark : variants.light);
