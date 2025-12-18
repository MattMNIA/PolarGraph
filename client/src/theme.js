// src/theme.js
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
    success: {
      50: '#f0fdf4',
      500: '#22c55e',
      900: '#14532d',
    },
    warning: {
      50: '#fffbeb',
      500: '#f59e0b',
      900: '#78350f',
    },
    error: {
      50: '#fef2f2',
      500: '#ef4444',
      900: '#7f1d1d',
    },
  },
  styles: {
    section: {
      base: 'py-3',
      light: 'bg-gray-100',
      dark: 'bg-gray-800',
    },
    card: {
      base: 'p-6 rounded-xl shadow-lg transition-all duration-300',
      light: 'bg-white',
      dark: 'bg-gray-900',
    },
    button: {
      primary: {
        base: 'px-6 py-3 rounded-lg font-semibold transition-colors',
        light: 'bg-blue-600 hover:bg-blue-700 text-white',
        dark: 'bg-blue-500 hover:bg-blue-600 text-white',
      },
      secondary: {
        base: 'text-sm',
        light: 'text-blue-600 hover:text-blue-500',
        dark: 'text-blue-400 hover:text-blue-300',
      },
    },
    text: {
      heading: {
        primary: 'text-3xl md:text-4xl font-bold mb-4',
        secondary: 'text-xl font-bold mb-2',
      },
      body: 'opacity-90',
    },
    container: 'px-6 safe-area-px',
    divider: {
      base: 'h-1 w-20 mx-auto',
      light: 'bg-blue-600',
      dark: 'bg-blue-500',
    },
  },
  animations: {
    fadeInUp: {
      initial: { opacity: 0, y: 20 },
      whileInView: { opacity: 1, y: 0 },
      viewport: { once: true },
      transition: { duration: 0.6 },
    },
    staggerContainer: {
      initial: {},
      whileInView: {},
      viewport: { once: true },
      transition: { staggerChildren: 0.1 },
    },
    staggerItem: {
      initial: { opacity: 0, y: 20 },
      whileInView: { opacity: 1, y: 0 },
      transition: { duration: 0.5 },
    },
    hover: {
      whileHover: { scale: 1.05 },
      whileTap: { scale: 0.95 }
    },
  },
};

export const getThemeClasses = (base, variants, darkMode) => {
  return `${base} ${darkMode ? variants.dark : variants.light}`;
};