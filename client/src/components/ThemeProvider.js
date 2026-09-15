// src/components/ThemeProvider.js
import React, { createContext, useContext, useState, useEffect } from 'react';
import { theme } from '../theme';

const ThemeContext = createContext();

const STORAGE_KEY = 'theme';

// localStorage throws in some private-browsing and embedded contexts.
const readStoredTheme = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    return null;
  }
};

const writeStoredTheme = (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch (error) {
    /* preference simply won't persist */
  }
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  // Resolved before first paint so a stored light preference doesn't flash dark.
  const [darkMode, setDarkMode] = useState(() => {
    const saved = readStoredTheme();
    return saved ? saved === 'dark' : true; // new visitors get dark
  });

  useEffect(() => {
    writeStoredTheme(darkMode ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', darkMode);
    document.body.style.backgroundColor = darkMode ? theme.page.dark : theme.page.light;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', darkMode ? theme.page.dark : theme.page.light);
    }
  }, [darkMode]);

  const toggleTheme = () => setDarkMode((prev) => !prev);

  return (
    <ThemeContext.Provider value={{ darkMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
