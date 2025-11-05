import React, { useState } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import Whiteboard from './components/Whiteboard';
import MotorTestPage from './components/MotorTestPage';

function App() {
  const [view, setView] = useState('whiteboard');

  const toggleView = () => {
    setView((prev) => (prev === 'whiteboard' ? 'test' : 'whiteboard'));
  };

  const isWhiteboard = view === 'whiteboard';

  return (
    <ThemeProvider>
      <div className="relative min-h-screen">
        <div className="fixed bottom-6 left-6 z-50">
          <button
            type="button"
            onClick={toggleView}
            className="px-4 py-2 rounded-lg shadow bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            {isWhiteboard ? 'Open Motor Test' : 'Back to Designer'}
          </button>
        </div>
        {isWhiteboard ? <Whiteboard /> : <MotorTestPage />}
      </div>
    </ThemeProvider>
  );
}

export default App;
