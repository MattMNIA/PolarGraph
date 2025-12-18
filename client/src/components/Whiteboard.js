// src/components/Whiteboard.js
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from './ThemeProvider';
import { theme, getThemeClasses } from '../theme';
import { Play, Pause, Download, Upload, Type, Palette, Settings, Eye, EyeOff, ChevronUp, Trash2, Sun, Moon, Loader2 } from 'lucide-react';
import { buildApiUrl, fetchPathStatus } from '../utils/api';
import { useMemo } from 'react';

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 550;
const BOARD_WIDTH_MM = 1150;
const BOARD_HEIGHT_MM = 730;
const MARGIN_MM = 125;

const SCALE_X = BOARD_WIDTH_MM / CANVAS_WIDTH;
const SCALE_Y = BOARD_HEIGHT_MM / CANVAS_HEIGHT;

const MARGIN_X_PX = MARGIN_MM / SCALE_X;
const MARGIN_Y_PX = MARGIN_MM / SCALE_Y;

const MIN_ELEMENT_WIDTH = 1;
const MIN_ELEMENT_HEIGHT = 1;
const RESIZE_MIN_WIDTH = 50;
const RESIZE_MIN_HEIGHT = 30;
const SPEED_OPTIONS = [
  { label: 'Slow', value: 2000 },
  { label: 'Moderate', value: 5000 },
  { label: 'Fast', value: 9000 },
  { label: 'Extreme', value: 15000 },
];

const clamp = (value, min, max) => {
  if (!Number.isFinite(value)) {
    return min;
  }
  const upperBound = max >= min ? max : min;
  return Math.min(Math.max(value, min), upperBound);
};

const ACTIVE_JOB_STATUSES = new Set(['pending', 'running', 'cancelling']);
const FINAL_JOB_STATUSES = new Set(['idle', 'cancelled', 'completed', 'failed']);

const normalizeFinalJobStatus = (payload, previous) => {
  const controllerStatus = payload?.controllerStatus ?? previous?.controllerStatus ?? null;
  const error = payload?.error ?? null;
  const result = {
    status: payload?.status || 'idle',
    controllerStatus,
  };
  if (error) {
    result.error = error;
  }
  if (payload?.previousJob) {
    result.previousJob = payload.previousJob;
  }
  if (payload?.lastState) {
    result.lastState = payload.lastState;
  }
  return result;
};

const mergeJobStatus = (update, previous) => {
  if (!update) {
    return previous || null;
  }
  if (update.status && FINAL_JOB_STATUSES.has(update.status)) {
    return normalizeFinalJobStatus(update, previous);
  }
  const base = previous ? { ...previous } : {};
  const merged = { ...base, ...update };
  if (!merged.status && previous?.status) {
    merged.status = previous.status;
  }
  if (!merged.controllerStatus && previous?.controllerStatus) {
    merged.controllerStatus = previous.controllerStatus;
  }
  if (merged.status && FINAL_JOB_STATUSES.has(merged.status)) {
    return normalizeFinalJobStatus(merged, previous);
  }
  return merged;
};
// Navbar Component
const Navbar = ({ onOpenMotorControl }) => {
  const { darkMode, toggleTheme } = useTheme();
  const handleOpenMotorControl = typeof onOpenMotorControl === 'function' ? onOpenMotorControl : null;

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className={getThemeClasses('border-b',
        { light: 'bg-white border-gray-200', dark: 'bg-gray-900 border-gray-800' }, darkMode)}
    >
      <div className="max-w-6xl mx-auto px-6 safe-area-px">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              Whiteboard Designer
            </h1>
          </div>
          <div className="flex items-center space-x-4">
            {handleOpenMotorControl && (
              <motion.button
                onClick={handleOpenMotorControl}
                className={getThemeClasses(
                  'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors',
                  { light: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100', dark: 'bg-blue-900 border-blue-700 text-blue-200 hover:bg-blue-800' },
                  darkMode
                )}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Motor Control</span>
              </motion.button>
            )}
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

// Rotate Prompt Component
const RotatePrompt = () => {
  return (
    <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center text-white p-8 text-center">
      <div className="mb-6 animate-bounce">
        <svg 
          width="64" 
          height="64" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          className="transform -rotate-90"
        >
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
          <path d="M12 18h.01"></path>
        </svg>
      </div>
      <h2 className="text-2xl font-bold mb-4">Please Rotate Your Device</h2>
      <p className="text-lg opacity-80">
        For the best experience designing your whiteboard, please use landscape mode.
      </p>
    </div>
  );
};

const Whiteboard = ({ onOpenMotorControl }) => {
  const { darkMode } = useTheme();
  const [elements, setElements] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [fontSize, setFontSize] = useState(36);
  const [fontFamily, setFontFamily] = useState('Inter');
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [selectedColor, setSelectedColor] = useState(darkMode ? '#ffffff' : '#000000');
  const [textRenderingStyle, setTextRenderingStyle] = useState('filled'); // 'filled' or 'outline'
  const [isDragOver, setIsDragOver] = useState(false);
  const [canvasScale, setCanvasScale] = useState(1);
  const [isPortraitMobile, setIsPortraitMobile] = useState(false);
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);

  // Check for mobile portrait orientation
  useEffect(() => {
    const checkOrientation = () => {
      // Check if device is mobile using user agent and screen dimensions
      const userAgent = navigator.userAgent || navigator.vendor || window.opera;
      const isMobileDevice = /android|ipad|iphone|ipod/i.test(userAgent);
      
      // Only trigger for actual mobile devices, not just small windows
      if (!isMobileDevice) {
        setIsPortraitMobile(false);
        return;
      }

      const isPortrait = window.innerHeight > window.innerWidth;
      setIsPortraitMobile(isPortrait);
    };

    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  // Update selected color when theme changes
  useEffect(() => {
    setSelectedColor(darkMode ? '#ffffff' : '#000000');
    // Update body background color to match theme (prevents white bars in safe areas)
    // Dark: bg-gray-800 (#1f2937), Light: bg-gray-100 (#f3f4f6)
    document.body.style.backgroundColor = darkMode ? '#1f2937' : '#f3f4f6';
  }, [darkMode]);

  const processImageFile = (file) => {
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        // Create a temporary image to get dimensions
        const img = new Image();
        img.onload = () => {
          // Canvas dimensions (fixed at CANVAS_WIDTH x CANVAS_HEIGHT to match backend)
          const maxCanvasWidth = CANVAS_WIDTH;
          const maxCanvasHeight = CANVAS_HEIGHT;

          // Calculate scale to fit image within 70% of canvas size for easy manipulation
          const maxWidth = maxCanvasWidth * 0.7;
          const maxHeight = maxCanvasHeight * 0.7;

          const scaleX = maxWidth / img.width;
          const scaleY = maxHeight / img.height;
          const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down

          const scaledWidth = Math.round(img.width * scale);
          const scaledHeight = Math.round(img.height * scale);
          const constrainedWidth = clamp(scaledWidth, MIN_ELEMENT_WIDTH, CANVAS_WIDTH - MARGIN_X_PX * 2);
          const constrainedHeight = clamp(scaledHeight, MIN_ELEMENT_HEIGHT, CANVAS_HEIGHT - MARGIN_Y_PX * 2);

          const minX = MARGIN_X_PX;
          const minY = MARGIN_Y_PX;
          const maxX = Math.max(minX, maxCanvasWidth - MARGIN_X_PX - constrainedWidth);
          const maxY = Math.max(minY, maxCanvasHeight - MARGIN_Y_PX - constrainedHeight);
          
          const randomX = minX + Math.random() * Math.max(0, maxX - minX);
          const randomY = minY + Math.random() * Math.max(0, maxY - minY);

          const newElement = {
            id: Date.now(),
            type: 'image',
            src: e.target.result,
            x: clamp(randomX, minX, maxX),
            y: clamp(randomY, minY, maxY),
            width: constrainedWidth,
            height: constrainedHeight,
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

  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    processImageFile(file);
  };

  const addTextElement = () => {
    if (textInput.trim()) {
      const width = clamp(Math.max(textInput.length * fontSize * 0.6, 150), MIN_ELEMENT_WIDTH, CANVAS_WIDTH - MARGIN_X_PX * 2);
      const height = clamp(fontSize + 20, MIN_ELEMENT_HEIGHT, CANVAS_HEIGHT - MARGIN_Y_PX * 2);
      
      const minX = MARGIN_X_PX;
      const minY = MARGIN_Y_PX;
      const maxX = Math.max(minX, CANVAS_WIDTH - MARGIN_X_PX - width);
      const maxY = Math.max(minY, CANVAS_HEIGHT - MARGIN_Y_PX - height);
      
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
        x: clamp(Math.random() * 300 + 50 + minX, minX, maxX),
        y: clamp(Math.random() * 200 + 50 + minY, minY, maxY),
        width,
        height,
      };
      setElements(prev => [...prev, newElement]);
      setTextInput('');
    }
  };

  const updateElement = useCallback((id, updates) => {
    setElements((prev) => prev.map((el) => {
      if (el.id !== id) {
        return el;
      }

      const next = { ...el, ...updates };
      next.width = clamp(next.width, MIN_ELEMENT_WIDTH, CANVAS_WIDTH - MARGIN_X_PX * 2);
      next.height = clamp(next.height, MIN_ELEMENT_HEIGHT, CANVAS_HEIGHT - MARGIN_Y_PX * 2);

      const minX = MARGIN_X_PX;
      const minY = MARGIN_Y_PX;
      const maxX = CANVAS_WIDTH - MARGIN_X_PX - next.width;
      const maxY = CANVAS_HEIGHT - MARGIN_Y_PX - next.height;
      
      next.x = clamp(next.x, minX, maxX);
      next.y = clamp(next.y, minY, maxY);

      return next;
    }));
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
  const [hatchSpacing, setHatchSpacing] = useState(6);

  // Visualization state
  const [isVisualizing, setIsVisualizing] = useState(false);
  const [visualizationResult, setVisualizationResult] = useState(null);
  const [animationResult, setAnimationResult] = useState(null);
  const [isCreatingAnimation, setIsCreatingAnimation] = useState(false);
  const [animationController, setAnimationController] = useState(null);
  const [controllerUrl, setControllerUrl] = useState('http://192.168.50.95');
  const [controllerSpeed, setControllerSpeed] = useState(9000);
  const [isSendingPath, setIsSendingPath] = useState(false);
  const [pathJobStatus, setPathJobStatus] = useState(null);
  const [pathStatusIssues, setPathStatusIssues] = useState('initial-load');
  const [lastPathStatusAt, setLastPathStatusAt] = useState(null);
  const [pathSendError, setPathSendError] = useState(null);
  const statusPollRef = useRef(null);

  const applyJobStatusUpdate = useCallback((update) => {
    if (!update) {
      setPathJobStatus(null);
      setLastPathStatusAt(null);
      setPathStatusIssues('initial-load');
      return;
    }
    setPathJobStatus((prev) => {
      const merged = mergeJobStatus(update, prev);
      if (!merged) {
        setPathStatusIssues('initial-load');
        setLastPathStatusAt(null);
        return null;
      }
      const jobIsActive = merged.status ? ACTIVE_JOB_STATUSES.has(merged.status) : false;
      const hasHeartbeat = Boolean(merged.controllerStatus && merged.controllerStatus.status != null);
      setLastPathStatusAt(Date.now());
      setPathStatusIssues(jobIsActive ? (hasHeartbeat ? null : 'missing-controller-status') : null);
      return merged;
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const pollStatus = async () => {
      try {
        const data = await fetchPathStatus(controller.signal);
        if (cancelled) {
          return;
        }
        if (!data) {
          setPathStatusIssues('polling-error');
          return;
        }
        applyJobStatusUpdate(data);
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.warn('Status poll failed:', error);
          setPathStatusIssues('polling-error');
        }
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 5000);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [applyJobStatusUpdate]);

  const handleMouseDown = (e, element) => {
    if (e.target.closest('.delete-btn') || e.target.closest('.resize-handle')) return;
    e.preventDefault();
    if (!canvasRef.current) return; // Guard against null ref
    setDragging(element.id);
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;
    const scaleX = canvasWidth / CANVAS_WIDTH; // Display width / original canvas width
    const scaleY = canvasHeight / CANVAS_HEIGHT; // Display height / original canvas height
    
    setDragOffset({
      x: e.clientX - rect.left - (element.x * scaleX),
      y: e.clientY - rect.top - (element.y * scaleY),
    });
  };

  const handleResizeMouseDown = (e, element) => {
    e.stopPropagation();
    e.preventDefault();
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

  const handleTouchStart = (e, element) => {
    if (e.target.closest('.delete-btn') || e.target.closest('.resize-handle')) return;
    // Prevent default to stop scrolling/zooming and mouse emulation
    if (e.cancelable) e.preventDefault();
    
    if (!canvasRef.current) return;
    setDragging(element.id);
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;
    const scaleX = canvasWidth / CANVAS_WIDTH;
    const scaleY = canvasHeight / CANVAS_HEIGHT;
    
    const touch = e.touches[0];
    setDragOffset({
      x: touch.clientX - rect.left - (element.x * scaleX),
      y: touch.clientY - rect.top - (element.y * scaleY),
    });
  };

  const handleResizeTouchStart = (e, element) => {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    setResizing(element.id);
    const touch = e.touches[0];
    setResizeStart({
      x: touch.clientX,
      y: touch.clientY,
      width: element.width,
      height: element.height,
      aspectRatio: element.originalWidth && element.originalHeight
        ? element.originalWidth / element.originalHeight
        : element.width / element.height,
    });
  };

  const handleTouchMove = useCallback((e) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const touch = e.touches[0];

    if (dragging) {
      // Prevent scrolling while dragging
      if (e.cancelable) e.preventDefault();

      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = CANVAS_HEIGHT / rect.height;

      const mouseX = (touch.clientX - rect.left - dragOffset.x) * scaleX;
      const mouseY = (touch.clientY - rect.top - dragOffset.y) * scaleY;

      const element = elements.find((el) => el.id === dragging);
      if (element) {
        const minX = MARGIN_X_PX;
        const minY = MARGIN_Y_PX;
        const maxX = CANVAS_WIDTH - MARGIN_X_PX - element.width;
        const maxY = CANVAS_HEIGHT - MARGIN_Y_PX - element.height;
        updateElement(dragging, {
          x: Math.max(minX, Math.min(maxX, mouseX)),
          y: Math.max(minY, Math.min(maxY, mouseY)),
        });
      }
    } else if (resizing) {
      // Prevent scrolling while resizing
      if (e.cancelable) e.preventDefault();

      const element = elements.find((el) => el.id === resizing);
      if (!element) return;

      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = CANVAS_HEIGHT / rect.height;
      const deltaX = (touch.clientX - resizeStart.x) * scaleX;
      const deltaY = (touch.clientY - resizeStart.y) * scaleY;

      const maxWidth = CANVAS_WIDTH - MARGIN_X_PX - element.x;
      const maxHeight = CANVAS_HEIGHT - MARGIN_Y_PX - element.y;

      if (uniformScaling) {
        const aspectRatio = resizeStart.aspectRatio || 1;
        let newWidth = Math.max(RESIZE_MIN_WIDTH, resizeStart.width + deltaX);
        let newHeight = newWidth / aspectRatio;

        if (newWidth > maxWidth || newHeight > maxHeight) {
          const widthScale = maxWidth / newWidth;
          const heightScale = maxHeight / newHeight;
          const scale = Math.min(widthScale, heightScale, 1);
          newWidth = Math.max(RESIZE_MIN_WIDTH, newWidth * scale);
          newHeight = Math.max(RESIZE_MIN_HEIGHT, newHeight * scale);
        }

        updateElement(resizing, { width: newWidth, height: newHeight });
      } else {
        const newWidth = Math.min(maxWidth, Math.max(RESIZE_MIN_WIDTH, resizeStart.width + deltaX));
        const newHeight = Math.min(maxHeight, Math.max(RESIZE_MIN_HEIGHT, resizeStart.height + deltaY));
        updateElement(resizing, { width: newWidth, height: newHeight });
      }
    }
  }, [dragging, dragOffset, elements, resizing, resizeStart, uniformScaling, updateElement]);

  const handleTouchEnd = useCallback(() => {
    setDragging(null);
    setResizing(null);
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    if (dragging) {
      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = CANVAS_HEIGHT / rect.height;

      const mouseX = (e.clientX - rect.left - dragOffset.x) * scaleX;
      const mouseY = (e.clientY - rect.top - dragOffset.y) * scaleY;

      const element = elements.find((el) => el.id === dragging);
      if (element) {
        const minX = MARGIN_X_PX;
        const minY = MARGIN_Y_PX;
        const maxX = CANVAS_WIDTH - MARGIN_X_PX - element.width;
        const maxY = CANVAS_HEIGHT - MARGIN_Y_PX - element.height;
        updateElement(dragging, {
          x: Math.max(minX, Math.min(maxX, mouseX)),
          y: Math.max(minY, Math.min(maxY, mouseY)),
        });
      }
    } else if (resizing) {
      const element = elements.find((el) => el.id === resizing);
      if (!element) return;

      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = CANVAS_HEIGHT / rect.height;
      const deltaX = (e.clientX - resizeStart.x) * scaleX;
      const deltaY = (e.clientY - resizeStart.y) * scaleY;

      const maxWidth = CANVAS_WIDTH - MARGIN_X_PX - element.x;
      const maxHeight = CANVAS_HEIGHT - MARGIN_Y_PX - element.y;

      if (uniformScaling) {
        const aspectRatio = resizeStart.aspectRatio || 1;
        let newWidth = Math.max(RESIZE_MIN_WIDTH, resizeStart.width + deltaX);
        let newHeight = newWidth / aspectRatio;

        if (newWidth > maxWidth || newHeight > maxHeight) {
          const widthScale = maxWidth / newWidth;
          const heightScale = maxHeight / newHeight;
          const scale = Math.min(widthScale, heightScale, 1);
          newWidth = Math.max(RESIZE_MIN_WIDTH, newWidth * scale);
          newHeight = Math.max(RESIZE_MIN_HEIGHT, newHeight * scale);
        }

        updateElement(resizing, { width: newWidth, height: newHeight });
      } else {
        const newWidth = Math.min(maxWidth, Math.max(RESIZE_MIN_WIDTH, resizeStart.width + deltaX));
        const newHeight = Math.min(maxHeight, Math.max(RESIZE_MIN_HEIGHT, resizeStart.height + deltaY));
        updateElement(resizing, { width: newWidth, height: newHeight });
      }
    }
  }, [dragging, dragOffset, elements, resizing, resizeStart, uniformScaling, updateElement]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    setResizing(null);
  }, []);

  React.useEffect(() => {
    if (dragging || resizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [dragging, resizing, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  React.useEffect(() => {
    if (!canvasRef.current) return;
    
    const updateScale = () => {
      if (canvasRef.current) {
        const { width } = canvasRef.current.getBoundingClientRect();
        setCanvasScale(width / CANVAS_WIDTH);
      }
    };

    // Initial calculation
    updateScale();

    const resizeObserver = new ResizeObserver(updateScale);
    resizeObserver.observe(canvasRef.current);
    
    return () => resizeObserver.disconnect();
  }, []);

  // Paste event listener for clipboard images
  React.useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.indexOf('image') !== -1) {
            const file = item.getAsFile();
            processImageFile(file);
            break; // Only process the first image
          }
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  const buildVisualizationPayload = useCallback((overrides = {}) => {
    const imageElements = elements.filter(el => el.type === 'image');
    const textElements = elements.filter(el => el.type === 'text');

    if (imageElements.length === 0 && textElements.length === 0) {
      return null;
    }

    const scaleX = SCALE_X;
    const scaleY = SCALE_Y;

    const positions = [];
    const imagePaths = [];
    const textData = [];

    imageElements.forEach(element => {
      const x = Math.round(element.x * scaleX);
      const y = Math.round(element.y * scaleY);
      const width = Math.round(element.width * scaleX);
      const height = Math.round(element.height * scaleY);

      positions.push(x, y, width, height);
      imagePaths.push(element.src);
    });

    textElements.forEach(element => {
      textData.push({
        text: element.text,
        x: Math.round(element.x * scaleX),
        y: Math.round(element.y * scaleY),
        width: Math.round(element.width * scaleX),
        height: Math.round(element.height * scaleY),
        fontSize: Math.round(element.fontSize * scaleY),
        fontFamily: element.fontFamily,
        isBold: element.isBold,
        isItalic: element.isItalic,
        color: element.color,
        textRenderingStyle: element.textRenderingStyle,
      });
    });

    return {
      images: imagePaths,
      positions,
      textElements: textData,
      boardWidth: BOARD_WIDTH_MM,
      boardHeight: BOARD_HEIGHT_MM,
      method: drawingMethod,
      spacing: hatchSpacing,
      ...overrides,
    };
  }, [elements, drawingMethod, hatchSpacing]);

  // Visualization function
  const runVisualization = async () => {
    if (elements.length === 0) {
      alert('Please add some elements to the whiteboard first.');
      return;
    }

    const payload = buildVisualizationPayload();
    if (!payload) {
      alert('Please add some elements to the whiteboard first.');
      return;
    }

    setIsVisualizing(true);
    setVisualizationResult(null);
    setAnimationResult(null);

    try {
      const response = await fetch(buildApiUrl('/api/visualize'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Visualization failed: ${response.statusText}`);
      }

      const result = await response.json();
      setVisualizationResult(result);
      if (result.pathJob) {
        applyJobStatusUpdate(result.pathJob);
      } else {
        applyJobStatusUpdate(null);
      }
      setPathSendError(null);

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
    if (isCreatingAnimation) return; // Prevent multiple simultaneous requests

    setIsCreatingAnimation(true);
    setAnimationResult(null);

    const controller = new AbortController();
    setAnimationController(controller);

    try {
      const payload = buildVisualizationPayload();
      if (!payload) {
        alert('Please add some elements to the whiteboard first.');
        return;
      }

      const response = await fetch(buildApiUrl('/api/animation'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Animation creation failed: ${response.statusText}`);
      }

      const result = await response.json();
      setAnimationResult(result);

      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Animation creation was cancelled');
      } else {
        console.error('Animation creation error:', error);
        alert('Failed to create animation. Please check the console for details.');
      }
    } finally {
      setIsCreatingAnimation(false);
      setAnimationController(null);
    }
  };

  const sendPathToController = async () => {
    if (isSendingPath) return;
    if (!controllerUrl.trim()) {
      alert('Enter the controller base URL first.');
      return;
    }

    const trimmedUrl = controllerUrl.trim().replace(/\s+$/, '');
    if (!trimmedUrl) {
      alert('Enter the controller base URL first.');
      return;
    }

    const normalizedUrl = trimmedUrl.replace(/\/+$/, '');
    const statusUrl = (() => {
      if (!normalizedUrl) {
        return '';
      }
      if (/\/status$/i.test(normalizedUrl)) {
        return normalizedUrl;
      }
      if (/\/path$/i.test(normalizedUrl)) {
        return normalizedUrl.replace(/\/path$/i, '/status');
      }
      if (/\/api$/i.test(normalizedUrl)) {
        return `${normalizedUrl}/status`;
      }
      return `${normalizedUrl}/api/status`;
    })();
    const cancelUrl = (() => {
      if (!normalizedUrl) {
        return '';
      }
      if (/\/cancel$/i.test(normalizedUrl)) {
        return normalizedUrl;
      }
      if (/\/path$/i.test(normalizedUrl)) {
        return normalizedUrl.replace(/\/path$/i, '/cancel');
      }
      if (/\/api$/i.test(normalizedUrl)) {
        return `${normalizedUrl}/cancel`;
      }
      return `${normalizedUrl}/api/cancel`;
    })();

    const payload = buildVisualizationPayload({
      sendToController: true,
      controllerUrl: trimmedUrl,
      controllerSpeed: Number(controllerSpeed) || 0,
      controllerReset: true,
      controllerStatusUrl: statusUrl || undefined,
      controllerCancelUrl: cancelUrl || undefined,
    });

    if (!payload) {
      alert('Please add some elements to the whiteboard first.');
      return;
    }

    setIsSendingPath(true);
    setPathStatusIssues('initial-load');
    setPathSendError(null);
    try {
      const response = await fetch(buildApiUrl('/api/visualize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to queue path transmission');
      }
      setVisualizationResult(data);
      if (data.pathJob) {
        applyJobStatusUpdate(data.pathJob);
      } else {
        applyJobStatusUpdate(null);
      }
    } catch (error) {
      console.error('Path transmission error:', error);
      setPathSendError(error.message);
    } finally {
      setIsSendingPath(false);
    }
  };

  const cancelPathTransmission = async () => {
    try {
      const response = await fetch(buildApiUrl('/api/send-path/cancel'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (response.ok) {
        applyJobStatusUpdate(data);
        setPathStatusIssues('initial-load');
      }
    } catch (error) {
      console.error('Cancel transmission error:', error);
      setPathSendError(error.message);
    }
  };

  const pausePathTransmission = async () => {
    try {
      const response = await fetch(buildApiUrl('/api/send-path/pause'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (response.ok) {
        applyJobStatusUpdate(data);
        setPathStatusIssues('initial-load');
      }
    } catch (error) {
      console.error('Pause transmission error:', error);
      setPathSendError(error.message);
    }
  };

  const resumePathTransmission = async () => {
    try {
      const response = await fetch(buildApiUrl('/api/send-path/resume'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (response.ok) {
        applyJobStatusUpdate(data);
        setPathStatusIssues('initial-load');
      }
    } catch (error) {
      console.error('Resume transmission error:', error);
      setPathSendError(error.message);
    }
  };

  // Cancel animation function
  const cancelAnimation = () => {
    if (animationController) {
      animationController.abort();
    }
  };

  useEffect(() => {
    const status = pathJobStatus?.status;
    if (status === 'pending' || status === 'running') {
      const interval = setInterval(async () => {
        try {
          const response = await fetch(buildApiUrl('/api/send-path/status'));
          if (response.ok) {
            const data = await response.json();
            applyJobStatusUpdate(data);
          }
        } catch (error) {
          console.error('Status poll error:', error);
        }
      }, 2000);
      statusPollRef.current = interval;
      return () => {
        clearInterval(interval);
        if (statusPollRef.current === interval) {
          statusPollRef.current = null;
        }
      };
    }

    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
  }, [pathJobStatus?.status, applyJobStatusUpdate]);

  const pathStatusOverlayMessage = useMemo(() => {
    switch (pathStatusIssues) {
      case 'initial-load':
        return 'Loading latest controller job status…';
      case 'polling-error':
        return 'Status unavailable — waiting for the next update…';
      case 'missing-controller-status':
        return 'Awaiting controller heartbeat…';
      default:
        return null;
    }
  }, [pathStatusIssues]);

  const pathLastUpdatedLabel = useMemo(() => {
    if (!lastPathStatusAt) {
      return null;
    }
    const date = new Date(lastPathStatusAt);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleString();
  }, [lastPathStatusAt]);

  const jobProgressPercent = useMemo(() => {
    if (!pathJobStatus || !ACTIVE_JOB_STATUSES.has(pathJobStatus.status)) {
      return 0;
    }
    if (!pathJobStatus.totalPoints || !Number.isFinite(pathJobStatus.totalPoints) || pathJobStatus.totalPoints <= 0) {
      return 0;
    }
    const sent = Number(pathJobStatus.sentPoints || 0);
    const total = Number(pathJobStatus.totalPoints);
    if (!Number.isFinite(sent) || !Number.isFinite(total) || total <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((sent / total) * 100));
  }, [pathJobStatus?.sentPoints, pathJobStatus?.totalPoints]);

  useEffect(() => () => {
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
  }, []);

  return (
    <div className={getThemeClasses('min-h-screen w-full transition-colors duration-300',
      { light: 'bg-gray-50 text-gray-900', dark: 'bg-gray-900 text-white' }, darkMode)}>

      {isPortraitMobile && <RotatePrompt />}

  <Navbar onOpenMotorControl={onOpenMotorControl} />

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
            <p className="text-xl max-w-2xl mx-auto opacity-90 pt-8">
              Create stunning whiteboard layouts with images and text. Drag, resize, and customize your designs with our intuitive interface.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Main Content Section - Controls + Canvas */}
      <section className={getThemeClasses('py-2 min-h-screen', { light: 'bg-gray-100', dark: 'bg-gray-800' }, darkMode)}>
        <div className="max-w-full px-4 safe-area-px">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
            {/* Left Side - Controls */}
            <div className="space-y-6 lg:pr-4">
              <motion.div
                {...theme.animations.fadeInUp}
                className="text-center mb-6"
              >
                <h2 className={theme.styles.text.heading.secondary}>Design Controls</h2>
                <p className="opacity-90">Add and customize elements for your whiteboard</p>
              </motion.div>

              <div className="space-y-4">
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
                      <p className="text-sm opacity-75">
                        Or drag & drop images onto the canvas, or paste images from your clipboard (Ctrl+V)
                      </p>
                    </div>

                    {/* Compute/Cancel button positioned on the right, centered vertically */}
                    <div className="absolute top-1/2 right-4 transform -translate-y-1/2">
                      {isCreatingAnimation ? (
                        <motion.button
                          onClick={cancelAnimation}
                          className={getThemeClasses(
                            'flex items-center gap-2 px-6 py-3 text-base font-medium rounded-lg border',
                            {
                              light: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100',
                              dark: 'bg-red-900 border-red-700 text-red-300 hover:bg-red-800'
                            }, darkMode
                          )}
                          {...theme.animations.hover}
                        >
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                          Cancel Animation
                        </motion.button>
                      ) : (
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
                      )}
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
                          <span className="ml-2 text-xs text-gray-500">Cross-hatch patterns</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="radio"
                            name="drawingMethod"
                            value="fill"
                            checked={drawingMethod === 'fill'}
                            onChange={(e) => setDrawingMethod(e.target.value)}
                            className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="ml-2 text-sm font-medium">Fill</span>
                          <span className="ml-2 text-xs text-gray-500">Fills dark areas (2mm sweep)</span>
                        </label>
                      </div>
                    </div>
                    {drawingMethod === 'hatch' && (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Hatch Spacing: {hatchSpacing}px
                          </label>
                          <input
                            type="range"
                            min="10"
                            max="30"
                            value={hatchSpacing}
                            onChange={(e) => setHatchSpacing(parseInt(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                          />
                          <div className="flex justify-between text-xs text-gray-500">
                            <span>Dense</span>
                            <span>Wide</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>


              </div>
            </div>

            {/* Right Side - Canvas */}
            <div className="flex flex-col">
              <motion.div
                {...theme.animations.fadeInUp}
                className="text-center mb-6"
              >
                <h2 className={theme.styles.text.heading.secondary}>Canvas</h2>
                <p className="opacity-90">Drag and resize your elements on the whiteboard, or drag & drop images here</p>
              </motion.div>

              <div className="flex-1 flex items-center justify-center min-h-[400px]">
                <motion.div
                  {...theme.animations.fadeInUp}
                  ref={canvasRef}
                  className={getThemeClasses(
                    'relative border-2 border-dashed rounded-xl overflow-hidden shadow-lg transition-colors duration-200',
                    { 
                      light: `bg-white ${isDragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`, 
                      dark: `bg-gray-800 ${isDragOver ? 'border-blue-400 bg-blue-900' : 'border-gray-600'}` 
                    }, darkMode
                  )}
                  style={{
                    width: '100%',
                    maxWidth: `${CANVAS_WIDTH}px`,
                    aspectRatio: `${CANVAS_WIDTH}/${CANVAS_HEIGHT}`,
                    cursor: dragging ? 'grabbing' : resizing ? 'se-resize' : 'default',
                    minHeight: '400px'
                  }}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!dragging && !resizing) {
                      setIsDragOver(true);
                    }
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    if (!dragging && !resizing) {
                      setIsDragOver(true);
                    }
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    if (!dragging && !resizing) {
                      setIsDragOver(false);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    if (dragging || resizing) return;
                    
                    const files = Array.from(e.dataTransfer.files);
                    files.forEach(file => processImageFile(file));
                  }}
                >
                {/* Safe Zone Indicator */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    borderWidth: `${MARGIN_Y_PX}px ${MARGIN_X_PX}px`,
                    borderColor: 'rgba(255, 0, 0, 0.1)',
                    borderStyle: 'solid',
                    zIndex: 0,
                  }}
                />
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
                      className="absolute group select-none"
                      style={{
                        left: `${(element.x / CANVAS_WIDTH) * 100}%`,
                        top: `${(element.y / CANVAS_HEIGHT) * 100}%`,
                        width: `${(element.width / CANVAS_WIDTH) * 100}%`,
                        height: `${(element.height / CANVAS_HEIGHT) * 100}%`,
                        touchAction: 'none',
                      }}
                      onMouseDown={(e) => handleMouseDown(e, element)}
                      onTouchStart={(e) => handleTouchStart(e, element)}
                    >
                      <div className={getThemeClasses(
                        'relative w-full h-full border rounded-lg overflow-hidden',
                        { light: element.type === 'text' ? 'border-gray-300' : 'border-gray-200', dark: element.type === 'text' ? 'border-gray-600' : 'border-gray-600' }, darkMode
                      )}>
                        {element.type === 'image' ? (
                          <img
                            src={element.src}
                            alt="Uploaded"
                            className="w-full h-full object-fill"
                            onDragStart={(e) => e.preventDefault()} // Prevent browser's default drag behavior
                            draggable={false} // Explicitly disable dragging
                          />
                        ) : (
                          <div
                            className="w-full h-full flex items-center justify-center p-4 select-none relative bg-black bg-opacity-10 dark:bg-white dark:bg-opacity-10 rounded-lg"
                            style={{
                              fontSize: element.fontSize * canvasScale,
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
                          className="resize-handle absolute bottom-0 right-0 w-6 h-6 bg-blue-500 hover:bg-blue-600 rounded-tl-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-se-resize flex items-end justify-end"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleResizeMouseDown(e, element);
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            handleResizeTouchStart(e, element);
                          }}
                          style={{ zIndex: 10, touchAction: 'none' }}
                        >
                          <div className="w-3 h-3 border-r-2 border-b-2 border-white mb-0.5 mr-0.5"></div>
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
              </div>

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
                  {isCreatingAnimation ? (
                    <div className="text-center">
                      <h4 className="text-sm font-medium mb-2">Drawing Animation</h4>
                      <div className="flex flex-col items-center justify-center space-y-4 p-8 rounded-lg border mx-auto" style={{ height: '350px', width: '100%', maxWidth: '350px' }}>
                        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
                        <div>
                          <p className="text-sm opacity-75 mb-2">Generating animation...</p>
                          <motion.button
                            onClick={cancelAnimation}
                            className={getThemeClasses('px-3 py-1 text-sm rounded border', {
                              light: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100',
                              dark: 'bg-red-900 border-red-700 text-red-300 hover:bg-red-800'
                            }, darkMode)}
                            {...theme.animations.hover}
                          >
                            Cancel
                          </motion.button>
                        </div>
                      </div>
                      <p className="text-xs opacity-75 mt-2">Animated sequence</p>
                    </div>
                  ) : animationResult?.animationGif ? (
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
                  ) : null}
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

                <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-base font-semibold">Send to Microcontroller</h4>
                      <p className="text-sm opacity-75">Queue the drawing on the ESP32 without blocking this page.</p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <input
                      type="text"
                      value={controllerUrl}
                      onChange={(event) => setControllerUrl(event.target.value)}
                      placeholder="http://192.168.x.x"
                      className={getThemeClasses(
                        'w-full px-3 py-2 border rounded-lg',
                        { light: 'bg-white border-gray-300 focus:border-blue-500', dark: 'bg-gray-800 border-gray-600 focus:border-blue-400' },
                        darkMode
                      )}
                    />
                    <select
                      value={controllerSpeed}
                      onChange={(event) => setControllerSpeed(parseInt(event.target.value, 10))}
                      className={getThemeClasses(
                        'w-full px-3 py-2 border rounded-lg',
                        { light: 'bg-white border-gray-300 focus:border-blue-500', dark: 'bg-gray-800 border-gray-600 focus:border-blue-400' },
                        darkMode
                      )}
                    >
                      {SPEED_OPTIONS.map((option) => (
                        <option key={option.label} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-wrap items-center gap-3">
                      <motion.button
                        onClick={sendPathToController}
                        disabled={
                          isSendingPath ||
                          elements.length === 0 ||
                          ACTIVE_JOB_STATUSES.has(pathJobStatus?.status)
                        }
                        className={getThemeClasses(
                          theme.styles.button.primary.base + ' flex items-center gap-2 px-4 py-2 text-sm font-medium',
                          theme.styles.button.primary,
                          darkMode
                        )}
                        {...theme.animations.hover}
                      >
                        {isSendingPath ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            Sending...
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4" />
                            Send Path
                          </>
                        )}
                      </motion.button>
                      {(pathJobStatus?.status === 'pending' || pathJobStatus?.status === 'running') && (
                        pathJobStatus?.paused ? (
                          <motion.button
                            onClick={resumePathTransmission}
                            disabled={isSendingPath}
                            className={getThemeClasses(
                              'px-4 py-2 text-sm font-medium rounded-lg border flex items-center gap-2',
                              { light: 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100', dark: 'bg-green-900 border-green-700 text-green-300 hover:bg-green-800' },
                              darkMode
                            )}
                            {...theme.animations.hover}
                          >
                            <Play className="w-4 h-4" />
                            Resume
                          </motion.button>
                        ) : (
                          <motion.button
                            onClick={pausePathTransmission}
                            disabled={isSendingPath}
                            className={getThemeClasses(
                              'px-4 py-2 text-sm font-medium rounded-lg border flex items-center gap-2',
                              { light: 'bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100', dark: 'bg-yellow-900 border-yellow-700 text-yellow-200 hover:bg-yellow-800' },
                              darkMode
                            )}
                            {...theme.animations.hover}
                          >
                            <Pause className="w-4 h-4" />
                            Pause
                          </motion.button>
                        )
                      )}
                      {(pathJobStatus?.status === 'pending' || pathJobStatus?.status === 'running') && (
                        <motion.button
                          onClick={cancelPathTransmission}
                          className={getThemeClasses(
                            'px-4 py-2 text-sm font-medium rounded-lg border',
                            { light: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100', dark: 'bg-red-900 border-red-700 text-red-300 hover:bg-red-800' },
                            darkMode
                          )}
                          {...theme.animations.hover}
                        >
                          Cancel
                        </motion.button>
                      )}
                    </div>
                  </div>

                  {pathSendError && (
                    <p className="text-sm text-red-500">{pathSendError}</p>
                  )}

                  <div
                    className={getThemeClasses(
                      'relative p-4 rounded-lg border text-sm',
                      { light: 'bg-gray-50 border-gray-200', dark: 'bg-gray-800 border-gray-700' },
                      darkMode
                    )}
                  >
                    {pathStatusOverlayMessage && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-gray-900/20 dark:bg-black/30 text-gray-900 dark:text-gray-100">
                        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                        <span className="mt-2 text-xs font-medium text-center px-4">{pathStatusOverlayMessage}</span>
                      </div>
                    )}

                    <div className={pathStatusOverlayMessage ? 'pointer-events-none opacity-60 transition-opacity duration-200' : ''}>
                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between">
                          <span className="font-medium">Status: {pathJobStatus?.status || 'idle'}{pathJobStatus?.paused ? ' (paused)' : ''}</span>
                          {pathJobStatus?.jobId && (
                            <span className="opacity-60">Job ID: {pathJobStatus.jobId}</span>
                          )}
                        </div>

                        {pathJobStatus?.totalPoints ? (
                          <>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                              <div
                                className="bg-blue-500 h-2 rounded-full"
                                style={{ width: `${jobProgressPercent}%` }}
                              />
                            </div>
                            <div className="flex justify-between text-xs opacity-75">
                              <span>{pathJobStatus?.sentPoints || 0} / {pathJobStatus?.totalPoints || 0} points</span>
                              <span>{pathJobStatus?.sentBatches || 0} / {pathJobStatus?.totalBatches || 0} batches</span>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs opacity-75">Awaiting transmission data…</p>
                        )}

                        {pathJobStatus?.error && (
                          <p className="text-xs text-red-500">Error: {pathJobStatus.error}</p>
                        )}
                        {pathJobStatus?.controllerStatus?.error && (
                          <p className="text-xs text-red-500">Status poller error: {pathJobStatus.controllerStatus.error}</p>
                        )}
                        {pathJobStatus?.controllerStatus?.stale && (
                          <p className="text-xs text-yellow-500 dark:text-yellow-300">Controller status is stale; awaiting refresh…</p>
                        )}
                        {pathJobStatus?.status === 'idle' && pathJobStatus?.lastState && (
                          <p className="text-xs opacity-75">Last job: {pathJobStatus.lastState}</p>
                        )}
                        {pathJobStatus?.paused && (
                          <p className="text-xs text-yellow-500 dark:text-yellow-300">Transmission is paused. Resume to continue sending remaining batches.</p>
                        )}

                        <p className="text-xs opacity-60">
                          {pathLastUpdatedLabel ? `Last update: ${pathLastUpdatedLabel}` : 'No updates received yet.'}
                        </p>
                        {!pathJobStatus && (
                          <p className="text-xs opacity-75">No active controller job yet. Send a path to see live progress.</p>
                        )}
                      </div>
                    </div>
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