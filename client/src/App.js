import React from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import Whiteboard from './components/Whiteboard';

function App() {
  return (
    <ThemeProvider>
      <Whiteboard />
    </ThemeProvider>
  );
}

export default App;
