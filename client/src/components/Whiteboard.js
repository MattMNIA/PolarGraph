// src/components/Whiteboard.js
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from './ThemeProvider';
import { theme, getThemeClasses } from '../theme';
import { Play, Download, Upload, Type, Palette, Settings, Eye, EyeOff, ChevronUp, Trash2, Sun, Moon } from 'lucide-react';

// Navbar Component
const Navbar = () => {
  const { darkMode, toggleTheme } = useTheme();

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className={getThemeClasses('border-b',
        { light: 'bg-white border-gray-200', dark: 'bg-gray-900 border-gray-800' }, darkMode)}
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              Whiteboard Designer
            </h1>
          </div>
          <div className="flex items-center space-x-4">
            <motion.button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </motion.button>
          </div>
        </div>
      </div>
    </motion.nav>
  );
};

// Scroll to Top Button
const ScrollToTopButton = () => {
  const { darkMode } = useTheme();
  const [showScrollTop, setShowScrollTop] = useState(false);

  React.useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <AnimatePresence>
      {showScrollTop && (
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          onClick={scrollToTop}
          className={getThemeClasses(
            'fixed bottom-6 right-6 p-3 rounded-full shadow-lg transition-colors z-50',
            { light: 'bg-white hover:bg-gray-100', dark: 'bg-gray-800 hover:bg-gray-700' }, darkMode
          )}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <ChevronUp className="w-6 h-6" />
        </motion.button>
      )}
    </AnimatePresence>
  );
};

// Footer Component
const Footer = () => {
  const { darkMode } = useTheme();

  return (
    <footer className={getThemeClasses('py-10 border-t',
      { light: 'bg-white border-gray-200', dark: 'bg-gray-900 border-gray-800' }, darkMode)}>
      <div className={theme.styles.container}>
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="mb-6 md:mb-0">
            <h2 className="text-xl font-bold">
              <span className={getThemeClasses('', { light: 'text-blue-600', dark: 'text-blue-400' }, darkMode)}>
                Whiteboard Designer
              </span>
            </h2>
            <p className="mt-2 opacity-80">Built with React & TailwindCSS</p>
          </div>
          <div className="text-center md:text-right">
            <p className="opacity-60 text-sm">
              © {new Date().getFullYear()} Whiteboard Designer. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

const Whiteboard = () => {
  const { darkMode } = useTheme();
  const [elements, setElements] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [fontSize, setFontSize] = useState(36);
  const [fontFamily, setFontFamily] = useState('Inter');
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [selectedColor, setSelectedColor] = useState(darkMode ? '#ffffff' : '#000000');
  const [textRenderingStyle, setTextRenderingStyle] = useState('filled'); // 'filled' or 'outline'
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);

  // Update selected color when theme changes
  useEffect(() => {
    setSelectedColor(darkMode ? '#ffffff' : '#000000');
  }, [darkMode]);

  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        // Create a temporary image to get dimensions
        const img = new Image();
        img.onload = () => {
          // Canvas dimensions (fixed at 1150x730 to match backend)
          const maxCanvasWidth = 1150;
          const maxCanvasHeight = 730;

          // Calculate scale to fit image within 70% of canvas size for easy manipulation
          const maxWidth = maxCanvasWidth * 0.7;
          const maxHeight = maxCanvasHeight * 0.7;

          const scaleX = maxWidth / img.width;
          const scaleY = maxHeight / img.height;
          const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down

          const scaledWidth = Math.round(img.width * scale);
          const scaledHeight = Math.round(img.height * scale);

          const newElement = {
            id: Date.now(),
            type: 'image',
            src: e.target.result,
            x: Math.random() * (maxCanvasWidth - scaledWidth - 100) + 50, // Random position with margin
            y: Math.random() * (maxCanvasHeight - scaledHeight - 100) + 50,
            width: scaledWidth,
            height: scaledHeight,
            originalWidth: img.width,
            originalHeight: img.height,
          };
          setElements(prev => [...prev, newElement]);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const addTextElement = () => {
    if (textInput.trim()) {
      const newElement = {
        id: Date.now(),
        type: 'text',
        text: textInput,
        fontSize,
        fontFamily,
        isBold,
        isItalic,
        color: selectedColor,
        textRenderingStyle,
        x: Math.random() * 300 + 50,
        y: Math.random() * 200 + 50,
        width: Math.max(textInput.length * fontSize * 0.6, 150),
        height: fontSize + 20,
      };
      setElements(prev => [...prev, newElement]);
      setTextInput('');
    }
  };

  const updateElement = useCallback((id, updates) => {
    setElements(prev => prev.map(el => el.id === id ? { ...el, ...updates } : el));
  }, []);

  const deleteElement = (id) => {
    setElements(prev => prev.filter(el => el.id !== id));
  };

  // Custom drag implementation to avoid findDOMNode issues
  const [dragging, setDragging] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizing, setResizing] = useState(null);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  // Uniform scaling state
  const [uniformScaling, setUniformScaling] = useState(true);

  // Drawing method state
  const [drawingMethod, setDrawingMethod] = useState('contour');
  const [hatchSpacing, setHatchSpacing] = useState(4);

  // Visualization state
  const [isVisualizing, setIsVisualizing] = useState(false);
  const [visualizationResult, setVisualizationResult] = useState(null);
  const [animationResult, setAnimationResult] = useState(null);

  const handleMouseDown = (e, element) => {
    if (e.target.closest('.delete-btn') || e.target.closest('.resize-handle')) return;
    if (!canvasRef.current) return; // Guard against null ref
    setDragging(element.id);
    const rect = canvasRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left - element.x,
      y: e.clientY - rect.top - element.y,
    });
  };

  const handleResizeMouseDown = (e, element) => {
    e.stopPropagation();
    setResizing(element.id);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: element.width,
      height: element.height,
      aspectRatio: element.originalWidth && element.originalHeight
        ? element.originalWidth / element.originalHeight
        : element.width / element.height,
    });
  };

  const handleMouseMove = useCallback((e) => {
    if (dragging) {
      if (!canvasRef.current) return; // Guard against null ref
      const rect = canvasRef.current.getBoundingClientRect();
      const newX = e.clientX - rect.left - dragOffset.x;
      const newY = e.clientY - rect.top - dragOffset.y;
      updateElement(dragging, { x: Math.max(0, newX), y: Math.max(0, newY) });
    } else if (resizing) {
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;

      if (uniformScaling) {
        // Maintain aspect ratio
        const aspectRatio = resizeStart.aspectRatio;
        const newWidth = Math.max(50, resizeStart.width + deltaX);
        const newHeight = newWidth / aspectRatio;
        updateElement(resizing, { width: newWidth, height: newHeight });
      } else {
        // Free resize
        const newWidth = Math.max(50, resizeStart.width + deltaX);
        const newHeight = Math.max(30, resizeStart.height + deltaY);
        updateElement(resizing, { width: newWidth, height: newHeight });
      }
    }
  }, [dragging, dragOffset, resizing, resizeStart, updateElement, uniformScaling]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    setResizing(null);
  }, []);

  React.useEffect(() => {
    if (dragging || resizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragging, resizing, handleMouseMove, handleMouseUp]);

  // Visualization function
  const runVisualization = async () => {
    if (elements.length === 0) {
      alert('Please add some elements to the whiteboard first.');
      return;
    }

    setIsVisualizing(true);
    setVisualizationResult(null);
    setAnimationResult(null);

    try {
      // Prepare image and text data for the Python script
      const imageElements = elements.filter(el => el.type === 'image');
      const textElements = elements.filter(el => el.type === 'text');
      const canvasWidth = 1150; // Match the Python script default
      const canvasHeight = 730;

      if (imageElements.length === 0 && textElements.length === 0) {
        alert('Please add some elements to the whiteboard first.');
        setIsVisualizing(false);
        return;
      }

      // Convert canvas coordinates to the visualization coordinate system
      const positions = [];
      const imagePaths = [];
      const textData = [];

      imageElements.forEach(element => {
        // Convert from canvas coordinates to visualization coordinates (both use 1150x730)
        const x = Math.round(element.x);
        const y = Math.round(element.y);
        const width = Math.round(element.width);
        const height = Math.round(element.height);

        positions.push(x, y, width, height);
        imagePaths.push(element.src);
      });

      textElements.forEach(element => {
        textData.push({
          text: element.text,
          x: Math.round(element.x),
          y: Math.round(element.y),
          width: Math.round(element.width),
          height: Math.round(element.height),
          fontSize: element.fontSize,
          fontFamily: element.fontFamily,
          isBold: element.isBold,
          isItalic: element.isItalic,
          color: element.color,
          textRenderingStyle: element.textRenderingStyle,
        });
      });

      // Call the Python visualization script
      const response = await fetch('http://localhost:3001/api/visualize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          images: imagePaths,
          positions: positions,
          textElements: textData,
          boardWidth: canvasWidth,
          boardHeight: canvasHeight,
          method: drawingMethod,
          spacing: hatchSpacing,
        }),
      });

      if (!response.ok) {
        throw new Error(`Visualization failed: ${response.statusText}`);
      }

      const result = await response.json();
      setVisualizationResult(result);

      // Automatically create animation after visualization
      try {
        await createAnimation();
      } catch (animationError) {
        console.error('Auto animation creation failed:', animationError);
        // Don't show alert for auto animation failure, just log it
      }

    } catch (error) {
      console.error('Visualization error:', error);
      alert('Failed to run visualization. Please check the console for details.');
    } finally {
      setIsVisualizing(false);
    }
  };

  // Animation creation function
  const createAnimation = async () => {
    // Use the same data as the visualization
    const imageElements = elements.filter(el => el.type === 'image');
    const textElements = elements.filter(el => el.type === 'text');
    const canvasWidth = 1150;
    const canvasHeight = 730;

    const positions = [];
    const imagePaths = [];
    const textData = [];

    imageElements.forEach(element => {
      const x = Math.round(element.x);
      const y = Math.round(element.y);
      const width = Math.round(element.width);
      const height = Math.round(element.height);

      positions.push(x, y, width, height);
      imagePaths.push(element.src);
    });

    textElements.forEach(element => {
      textData.push({
        text: element.text,
        x: Math.round(element.x),
        y: Math.round(element.y),
        width: Math.round(element.width),
        height: Math.round(element.height),
        fontSize: element.fontSize,
        fontFamily: element.fontFamily,
        isBold: element.isBold,
        isItalic: element.isItalic,
        color: element.color,
        textRenderingStyle: element.textRenderingStyle,
      });
    });

    // Call the animation endpoint
    const response = await fetch('http://localhost:3001/api/animation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        images: imagePaths,
        positions: positions,
        textElements: textData,
        boardWidth: canvasWidth,
        boardHeight: canvasHeight,
        method: drawingMethod,
        spacing: hatchSpacing,
      }),
    });

    if (!response.ok) {
      throw new Error(`Animation creation failed: ${response.statusText}`);
    }

    const result = await response.json();
    setAnimationResult(result);

    return result;
  };

  return (
    <div className={getThemeClasses('min-h-screen transition-colors duration-300',
      { light: 'bg-gray-50 text-gray-900', dark: 'bg-gray-900 text-white' }, darkMode)}>

      <Navbar />

      {/* Hero Section */}
      <section className={getThemeClasses(theme.styles.section.base + ' mx-0 pt-12', theme.styles.section, darkMode)}>
        <div className={theme.styles.container}>
          <motion.div
            {...theme.animations.fadeInUp}
            className="text-center mb-4"
          >
            <div className="flex items-center justify-center gap-3 mb-4">
              <h1 className={theme.styles.text.heading.primary}>
                Whiteboard Designer
              </h1>
            </div>
            <div className={getThemeClasses(theme.styles.divider.base, theme.styles.divider, darkMode)}></div>
            <p className="text-xl max-w-2xl mx-auto opacity-90">
              Create stunning whiteboard layouts with images and text. Drag, resize, and customize your designs with our intuitive interface.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Main Content Section - Controls + Canvas */}
      <section className={getThemeClasses('py-2', { light: 'bg-gray-100', dark: 'bg-gray-800' }, darkMode)}>
        <div className="max-w-full px-4">
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-8 h-screen">
            {/* Left Side - Controls */}
            <div className="xl:col-span-2 space-y-8 overflow-y-auto">
              <motion.div
                {...theme.animations.fadeInUp}
                className="text-center mb-8"
              >
                <h2 className={theme.styles.text.heading.secondary}>Design Controls</h2>
                <p className="opacity-90">Add and customize elements for your whiteboard</p>
              </motion.div>

              <div className="space-y-6">
                {/* Image Upload & Generate Path Card */}
                <motion.div
                  {...theme.animations.staggerItem}
                  className={getThemeClasses(theme.styles.card.base, theme.styles.card, darkMode)}
                >
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-6">
                      <Upload className={getThemeClasses('', { light: 'text-blue-600', dark: 'text-blue-400' }, darkMode)} size={24} />
                      <h3 className="text-lg font-semibold">Add Images</h3>
                    </div>
                    <div className="space-y-4">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        ref={fileInputRef}
                        className="hidden"
                      />
                      <motion.button
                        onClick={() => fileInputRef.current.click()}
                        className={getThemeClasses(theme.styles.button.primary.base, theme.styles.button.primary, darkMode)}
                        {...theme.animations.hover}
                      >
                        <Upload className="w-4 h-4 mr-2 inline" />
                        Upload Image
                      </motion.button>
                    </div>

                    {/* Compute button positioned on the right, centered vertically */}
                    <div className="absolute top-1/2 right-4 transform -translate-y-1/2">
                      <motion.button
                        onClick={runVisualization}
                        disabled={isVisualizing || elements.length === 0}
                        className={getThemeClasses(
                          theme.styles.button.primary.base + ' flex items-center gap-2 px-6 py-3 text-base font-medium',
                          theme.styles.button.primary, darkMode
                        )}
                        {...theme.animations.hover}
                      >
                        {isVisualizing ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            Computing...
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4" />
                            Compute Simplified Image
                          </>
                        )}
                      </motion.button>
                    </div>
                  </div>
                </motion.div>

                {/* Text Controls Card */}
                <motion.div
                  {...theme.animations.staggerItem}
                  className={getThemeClasses(theme.styles.card.base, theme.styles.card, darkMode)}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <Type className={getThemeClasses('', { light: 'text-blue-600', dark: 'text-blue-400' }, darkMode)} size={24} />
                    <h3 className="text-lg font-semibold">Add Text</h3>
                  </div>
                  <div className="space-y-4">
                    <input
                      type="text"
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      placeholder="Enter your text..."
                      className={getThemeClasses(
                        'w-full px-4 py-3 border rounded-lg transition-colors',
                        { light: 'bg-white border-gray-300 focus:border-blue-500', dark: 'bg-gray-800 border-gray-600 focus:border-blue-400' }, darkMode
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <select
                        value={fontFamily}
                        onChange={(e) => setFontFamily(e.target.value)}
                        className={getThemeClasses(
                          'px-3 py-2 border rounded-lg',
                          { light: 'bg-white border-gray-300', dark: 'bg-gray-800 border-gray-600' }, darkMode
                        )}
                      >
                        <option value="Inter">Inter</option>
                        <option value="Arial">Arial</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Courier New">Courier New</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Verdana">Verdana</option>
                      </select>

                      <input
                        type="number"
                        value={fontSize}
                        onChange={(e) => setFontSize(parseInt(e.target.value))}
                        min="36"
                        max="72"
                        className={getThemeClasses(
                          'px-3 py-2 border rounded-lg',
                          { light: 'bg-white border-gray-300', dark: 'bg-gray-800 border-gray-600' }, darkMode
                        )}
                      />
                    </div>

                    <div className="flex items-center gap-6">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isBold}
                          onChange={(e) => setIsBold(e.target.checked)}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium">Bold</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isItalic}
                          onChange={(e) => setIsItalic(e.target.checked)}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium">Italic</span>
                      </label>
                    </div>

                    {/* Text Rendering Style */}
                    <div className="space-y-2">
                      <span className="text-sm font-medium">Text Rendering</span>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="textRenderingStyle"
                            value="filled"
                            checked={textRenderingStyle === 'filled'}
                            onChange={(e) => setTextRenderingStyle(e.target.value)}
                            className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium">Filled</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="textRenderingStyle"
                            value="outline"
                            checked={textRenderingStyle === 'outline'}
                            onChange={(e) => setTextRenderingStyle(e.target.value)}
                            className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium">Outline</span>
                        </label>
                      </div>
                    </div>

                    <motion.button
                      onClick={addTextElement}
                      disabled={!textInput.trim()}
                      className={getThemeClasses(theme.styles.button.primary.base, theme.styles.button.primary, darkMode)}
                      {...theme.animations.hover}
                    >
                      <Type className="w-4 h-4 mr-2 inline" />
                      Add Text Element
                    </motion.button>
                  </div>
                </motion.div>

                {/* Uniform Scaling Control */}
                <motion.div
                  {...theme.animations.staggerItem}
                  className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium text-gray-900 dark:text-white">Uniform Scaling</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Maintain aspect ratio when resizing</p>
                    </div>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={uniformScaling}
                        onChange={(e) => setUniformScaling(e.target.checked)}
                        className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm font-medium">Enabled</span>
                    </label>
                  </div>
                </motion.div>

                {/* Drawing Method Control */}
                <motion.div
                  {...theme.animations.staggerItem}
                  className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900 dark:text-white">Drawing Method</h4>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Choose how images are converted to drawing paths</p>
                      </div>
                      <div className="flex flex-col space-y-3 ml-4">
                        <label className="flex items-center">
                          <input
                            type="radio"
                            name="drawingMethod"
                            value="contour"
                            checked={drawingMethod === 'contour'}
                            onChange={(e) => setDrawingMethod(e.target.value)}
                            className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="ml-2 text-sm font-medium">Contour</span>
                          <span className="ml-2 text-xs text-gray-500">Traces edges and outlines</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="radio"
                            name="drawingMethod"
                            value="hatch"
                            checked={drawingMethod === 'hatch'}
                            onChange={(e) => setDrawingMethod(e.target.value)}
                            className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="ml-2 text-sm font-medium">Hatch</span>
                          <span className="ml-2 text-xs text-gray-500">Creates cross-hatch patterns</span>
                        </label>
                      </div>
                    </div>
                    {drawingMethod === 'hatch' && (
                      <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                          Hatch Spacing: {hatchSpacing}px
                        </label>
                        <input
                          type="range"
                          min="2"
                          max="20"
                          value={hatchSpacing}
                          onChange={(e) => setHatchSpacing(parseInt(e.target.value))}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                        />
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>Dense</span>
                          <span>Wide</span>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>


              </div>
            </div>

            {/* Right Side - Canvas */}
            <div className="xl:col-span-2 flex flex-col">
              <motion.div
                {...theme.animations.fadeInUp}
                className="text-center mb-8"
              >
                <h2 className={theme.styles.text.heading.secondary}>Canvas</h2>
                <p className="opacity-90">Drag and resize your elements on the whiteboard</p>
              </motion.div>

              <motion.div
                {...theme.animations.fadeInUp}
                ref={canvasRef}
                className={getThemeClasses(
                  'relative border-2 border-dashed rounded-xl overflow-hidden mx-auto',
                  { light: 'bg-white border-gray-300', dark: 'bg-gray-800 border-gray-600' }, darkMode
                )}
                style={{ width: '1150px', height: '730px', cursor: dragging ? 'grabbing' : resizing ? 'se-resize' : 'default' }}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              >
                <AnimatePresence>
                  {elements
                    .sort((a, b) => {
                      // Sort so text elements appear above image elements
                      if (a.type === 'text' && b.type === 'image') return 1;
                      if (a.type === 'image' && b.type === 'text') return -1;
                      return 0;
                    })
                    .map((element) => (
                    <motion.div
                      key={element.id}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
                      className="absolute group"
                      style={{
                        left: element.x,
                        top: element.y,
                        width: element.width,
                        height: element.height,
                      }}
                      onMouseDown={(e) => handleMouseDown(e, element)}
                    >
                      <div className={getThemeClasses(
                        'relative w-full h-full border rounded-lg overflow-hidden transition-all duration-200',
                        { light: element.type === 'text' ? 'border-gray-300 shadow-lg group-hover:shadow-xl' : 'bg-white border-gray-200 shadow-lg group-hover:shadow-xl', dark: element.type === 'text' ? 'border-gray-600 shadow-lg group-hover:shadow-xl' : 'bg-gray-700 border-gray-600 shadow-lg group-hover:shadow-xl' }, darkMode
                      )}>
                        {element.type === 'image' ? (
                          <img
                            src={element.src}
                            alt="Uploaded"
                            className="w-full h-full object-contain"
                            onDragStart={(e) => e.preventDefault()} // Prevent browser's default drag behavior
                            draggable={false} // Explicitly disable dragging
                          />
                        ) : (
                          <div
                            className="w-full h-full flex items-center justify-center p-4 select-none relative bg-black bg-opacity-10 dark:bg-white dark:bg-opacity-10 rounded-lg"
                            style={{
                              fontSize: element.fontSize,
                              fontFamily: element.fontFamily,
                              fontWeight: element.isBold ? 'bold' : 'normal',
                              fontStyle: element.isItalic ? 'italic' : 'normal',
                              color: element.color,
                            }}
                            onDragStart={(e) => e.preventDefault()} // Prevent browser's default drag behavior
                            draggable={false} // Explicitly disable dragging
                          >
                            {/* Centering indicator */}
                            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-blue-500 rounded-full opacity-50 group-hover:opacity-100 transition-opacity duration-200"></div>
                            {element.text}
                          </div>
                        )}

                        {/* Delete button */}
                        <motion.button
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          onClick={() => deleteElement(element.id)}
                          className="delete-btn absolute -top-2 -right-2 w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                          {...theme.animations.hover}
                        >
                          <Trash2 className="w-4 h-4" />
                        </motion.button>

                        {/* Resize handle */}
                        <div
                          className="resize-handle absolute bottom-0 right-0 w-4 h-4 bg-blue-500 rounded-tl-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-se-resize"
                          onMouseDown={(e) => handleResizeMouseDown(e, element)}
                        >
                          <div className="absolute bottom-1 right-1 w-2 h-2 border-r-2 border-b-2 border-white"></div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {elements.length === 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 flex items-center justify-center text-gray-400 dark:text-gray-500"
                  >
                    <div className="text-center">
                      <Palette className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p className="text-lg">Start by adding images and text to your whiteboard</p>
                    </div>
                  </motion.div>
                )}
              </motion.div>

              {/* Stats */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="mt-4 text-center text-gray-600 dark:text-gray-400"
              >
                <p>{elements.length} element{elements.length !== 1 ? 's' : ''} on your whiteboard</p>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* Visualization Section */}
      <section className={getThemeClasses(theme.styles.section.base, theme.styles.section, darkMode)}>
        <div className={theme.styles.container}>
          <motion.div
            {...theme.animations.fadeInUp}
            className="text-center mb-12"
          >
            <h2 className={theme.styles.text.heading.secondary}>Visualization</h2>
            <p className="opacity-90">See how your whiteboard design will look when drawn by the polargraph</p>
          </motion.div>

          <div className="flex flex-col items-center space-y-8">
            {/* Results will appear here */}
            {!(visualizationResult || animationResult) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={getThemeClasses(
                  'w-full p-12 rounded-lg border-2 border-dashed text-center',
                  {
                    light: 'bg-gray-50 border-gray-300 text-gray-500',
                    dark: 'bg-gray-800 border-gray-600 text-gray-400'
                  }, darkMode
                )}
              >
                <div className="space-y-4">
                  <div className="w-16 h-16 mx-auto opacity-50">
                    <svg className="w-full h-full" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-medium mb-2">Visualization Results</h3>
                    <p className="text-sm opacity-75">Click "Compute Simplified Image" above to generate your drawing path and animation</p>
                  </div>
                </div>
              </motion.div>
            )}

            {(visualizationResult || animationResult) && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className={getThemeClasses(theme.styles.card.base + ' p-8', theme.styles.card, darkMode)}
              >
                <h3 className="text-lg font-semibold mb-4">Visualization Results</h3>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Combined Layout */}
                  {visualizationResult?.previewImage && (
                    <div className="text-center">
                      <h4 className="text-sm font-medium mb-2">Combined Layout</h4>
                      <img
                        src={visualizationResult.previewImage}
                        alt="Combined Layout"
                        className="max-w-full h-auto rounded-lg border mx-auto"
                        style={{ maxHeight: '350px', objectFit: 'contain' }}
                      />
                      <p className="text-xs opacity-75 mt-2">Images + drawing path</p>
                    </div>
                  )}

                  {/* Drawing Path */}
                  {visualizationResult?.pathImage && (
                    <div className="text-center">
                      <h4 className="text-sm font-medium mb-2">Drawing Path</h4>
                      <img
                        src={visualizationResult.pathImage}
                        alt="Drawing Path"
                        className="max-w-full h-auto rounded-lg border mx-auto"
                        style={{ maxHeight: '350px', objectFit: 'contain' }}
                      />
                      <p className="text-xs opacity-75 mt-2">Path preview</p>
                    </div>
                  )}

                  {/* Animation */}
                  {animationResult?.animationGif && (
                    <div className="text-center">
                      <h4 className="text-sm font-medium mb-2">Drawing Animation</h4>
                      <img
                        src={animationResult.animationGif}
                        alt="Drawing Animation"
                        className="max-w-full h-auto rounded-lg border mx-auto"
                        style={{ maxHeight: '350px', objectFit: 'contain' }}
                      />
                      <p className="text-xs opacity-75 mt-2">Animated sequence</p>
                      <motion.button
                        onClick={() => {
                          const link = document.createElement('a');
                          link.href = animationResult.animationGif;
                          link.download = 'drawing_animation.gif';
                          link.click();
                        }}
                        className={getThemeClasses(theme.styles.button.primary.base + ' mt-2', theme.styles.button.primary, darkMode)}
                        {...theme.animations.hover}
                      >
                        <Download className="w-4 h-4 mr-2 inline" />
                        Download GIF
                      </motion.button>
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="text-sm opacity-75 text-center">
                    <p>Board Size: {visualizationResult?.boardWidth || 'N/A'} × {visualizationResult?.boardHeight || 'N/A'}</p>
                    <p>Images: {visualizationResult?.imageCount || 'N/A'} | Path Points: {visualizationResult?.pathLength || 'N/A'}</p>
                    {animationResult && (
                      <p>Animation: {animationResult.frameCount || 'N/A'} frames | Duration: {animationResult.duration || 'N/A'}</p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </section>



      <Footer />
      <ScrollToTopButton />
    </div>
  );
};

export default Whiteboard;