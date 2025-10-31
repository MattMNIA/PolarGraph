import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ThemeProvider, useTheme } from './components/ThemeProvider';
import { theme, getThemeClasses } from './theme';
import HomePage from './sections/HomePage';
import ProjectsSection from './sections/ProjectsSection';
import SkillsSection from './sections/SkillsSection';
import ExperienceSection from './sections/ExperienceSection';
import { ChevronUp, Linkedin, Mail } from 'lucide-react';
import { SiGithub } from 'react-icons/si';

// Main App Content Component
const AppContent = () => {
  const { darkMode } = useTheme();
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 400);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  return (
    <div className={getThemeClasses(
      'min-h-screen transition-colors duration-300',
      { light: 'bg-gray-50 text-gray-900', dark: 'bg-gray-900 text-white' },
      darkMode
    )}>
      <HomePage />
      <ProjectsSection />
      <SkillsSection />
      <ExperienceSection />

      {/* Footer */}
      <footer className={getThemeClasses(
        'py-10 border-t',
        { light: 'bg-white border-gray-200', dark: 'bg-gray-900 border-gray-800' },
        darkMode
      )}>
        <div className={theme.styles.container}>
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="mb-6 md:mb-0">
              <h2 className={theme.styles.text.heading.secondary}>
                <span className={getThemeClasses(
                  '',
                  { light: 'text-blue-600', dark: 'text-blue-400' },
                  darkMode
                )}>Matthew Morgan</span>
              </h2>
              <p className="mt-2 opacity-80">Built with React</p>
            </div>

            <div className="flex space-x-6 items-center">
              <motion.a
                href="https://github.com/MattMNIA"
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ y: -3 }}
                className="opacity-80 hover:opacity-100"
              >
                <SiGithub size={20} />
              </motion.a>
              <motion.a
                href="https://www.linkedin.com/in/mattmn/"
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ y: -3 }}
                className="opacity-80 hover:opacity-100"
              >
                <Linkedin size={20} />
              </motion.a>
              <motion.a
                href="mailto:mattmn@iastate.edu"
                whileHover={{ y: -3 }}
                className="opacity-80 hover:opacity-100"
              >
                <Mail size={20} />
              </motion.a>
            </div>
          </div>

          <div className="mt-8 text-center">
            <p className="opacity-60 text-sm">© {new Date().getFullYear()} Matthew Morgan. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Scroll to top button */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            onClick={scrollToTop}
            className={getThemeClasses(
              'fixed bottom-6 right-6 p-3 rounded-full shadow-lg transition-colors z-50',
              { light: 'bg-white hover:bg-gray-100', dark: 'bg-gray-800 hover:bg-gray-700' },
              darkMode
            )}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <ChevronUp size={24} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};

// Main App Component
const App = () => {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
};

export default App;