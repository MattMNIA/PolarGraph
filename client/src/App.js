import React, { useState } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import Whiteboard from './components/Whiteboard';
import MotorTestPage from './components/MotorTestPage';
import MotorControlPage from './components/MotorControlPage';

const VIEW_WHITEBOARD = 'whiteboard';
const VIEW_CONTROL = 'control';
const VIEW_TEST = 'test';

function App() {
  const [view, setView] = useState(VIEW_WHITEBOARD);
  const showMotorTest = process.env.REACT_APP_SHOW_MOTOR_TEST === 'true';

  const openWhiteboard = () => setView(VIEW_WHITEBOARD);
  const openMotorControl = () => setView(VIEW_CONTROL);
  const toggleMotorTest = () => {
    setView((prev) => (prev === VIEW_WHITEBOARD ? VIEW_TEST : VIEW_WHITEBOARD));
  };

  const isWhiteboard = view === VIEW_WHITEBOARD;
  const isMotorControl = view === VIEW_CONTROL;

  return (
    <ThemeProvider>
      <div className="relative min-h-screen">
        {isMotorControl ? (
          <MotorControlPage onBack={openWhiteboard} />
        ) : (
          <>
            {showMotorTest && (
              <div className="fixed bottom-6 left-6 z-50">
                <button
                  type="button"
                  onClick={toggleMotorTest}
                  className="px-4 py-2 rounded-lg shadow bg-blue-600 text-white hover:bg-blue-700 transition"
                >
                  {isWhiteboard ? 'Open Motor Test' : 'Back to Designer'}
                </button>
              </div>
            )}
            {isWhiteboard || !showMotorTest ? (
              <Whiteboard onOpenMotorControl={openMotorControl} />
            ) : (
              <MotorTestPage />
            )}
          </>
        )}
      </div>
    </ThemeProvider>
  );
}

export default App;
