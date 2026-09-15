// src/components/Whiteboard.js
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from './ThemeProvider';
import { theme, cn } from '../theme';
import {
  Play,
  Pause,
  Download,
  Upload,
  Type,
  Trash2,
  ChevronUp,
  Sun,
  Moon,
  Loader2,
  Sparkles,
  SlidersHorizontal,
  Image as ImageIcon,
  Cpu,
  Square,
  Settings,
} from 'lucide-react';
import { buildApiUrl, fetchPathStatus } from '../utils/api';
import {
  Button,
  Card,
  CardHeader,
  Container,
  EmptyState,
  Field,
  Label,
  Pill,
  ProgressBar,
  RangeInput,
  Section,
  SectionHeader,
  SegmentedControl,
  Select,
  Spinner,
  StatGrid,
  Switch,
  TextInput,
  ToggleButton,
} from './ui';

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 550;
const BOARD_WIDTH_MM = 1150;
const BOARD_HEIGHT_MM = 730;
const MARGIN_MM = 125;

const SCALE_X = BOARD_WIDTH_MM / CANVAS_WIDTH;
const SCALE_Y = BOARD_HEIGHT_MM / CANVAS_HEIGHT;

const MARGIN_X_PX = MARGIN_MM / SCALE_X;
const MARGIN_Y_PX = MARGIN_MM / SCALE_Y;

const MARGIN_X_PCT = (MARGIN_X_PX / CANVAS_WIDTH) * 100;
const MARGIN_Y_PCT = (MARGIN_Y_PX / CANVAS_HEIGHT) * 100;

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

const FONT_OPTIONS = ['Inter', 'Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];

const DRAWING_METHODS = [
  { value: 'contour', label: 'Contour', hint: 'Traces edges' },
  { value: 'hatch', label: 'Hatch', hint: 'Cross-hatching' },
  { value: 'fill', label: 'Fill', hint: '2mm sweep' },
];

const TEXT_STYLES = [
  { value: 'filled', label: 'Filled' },
  { value: 'outline', label: 'Outline' },
];

const NAV_LINKS = [
  { href: '#design', label: 'Design' },
  { href: '#preview', label: 'Preview' },
  { href: '#controller', label: 'Controller' },
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

const statusTone = (status) => {
  if (status === 'failed') return 'danger';
  if (status && ACTIVE_JOB_STATUSES.has(status)) return 'accent';
  return 'neutral';
};

// Navigation ----------------------------------------------------------------

const Navbar = ({ onOpenMotorControl }) => {
  const { darkMode, toggleTheme } = useTheme();
  const handleOpenMotorControl = typeof onOpenMotorControl === 'function' ? onOpenMotorControl : null;

  return (
    <motion.nav
      initial={{ y: -64 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.4 }}
      className="fixed inset-x-0 top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur-lg dark:border-gray-800 dark:bg-gray-900/80"
    >
      <Container className="flex h-16 items-center justify-between gap-4">
        <a href="#top" className="text-xl font-bold text-blue-600 dark:text-blue-400">
          Whiteboard<span className="hidden sm:inline"> Designer</span>
        </a>

        <div className="flex items-center gap-2 md:gap-6">
          <div className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-medium opacity-80 transition-colors hover:text-blue-600 hover:opacity-100 dark:hover:text-blue-400"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {handleOpenMotorControl && (
              <Button variant="secondary" size="sm" icon={Settings} onClick={handleOpenMotorControl}>
                <span className="hidden sm:inline">Motor Control</span>
              </Button>
            )}
            <Button
              variant="icon"
              size="icon"
              onClick={toggleTheme}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </Button>
          </div>
        </div>
      </Container>
    </motion.nav>
  );
};

const ScrollToTopButton = () => {
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <AnimatePresence>
      {showScrollTop && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          className="fixed bottom-6 right-6 z-50 rounded-full bg-white p-3 shadow-lg transition-colors hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <ChevronUp size={24} />
        </motion.button>
      )}
    </AnimatePresence>
  );
};

const Footer = () => (
  <footer className="border-t border-gray-200 bg-white py-10 transition-colors duration-300 dark:border-gray-800 dark:bg-gray-900">
    <Container>
      <div className="flex flex-col items-center gap-4 text-center md:flex-row md:justify-between md:text-left">
        <div>
          <p className="text-xl font-bold text-blue-600 dark:text-blue-400">Whiteboard Designer</p>
          <p className="mt-2 text-sm opacity-80">Polargraph control interface</p>
        </div>
        <p className="text-sm opacity-60">
          © {new Date().getFullYear()} Matthew Morgan. Built with React and Tailwind CSS.
        </p>
      </div>
    </Container>
  </footer>
);

// Main ----------------------------------------------------------------------

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
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);

  // New text defaults to the ink colour that reads on the current theme.
  // (The page background itself is owned by ThemeProvider.)
  useEffect(() => {
    setSelectedColor(darkMode ? '#ffffff' : '#000000');
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
          setElements((prev) => [...prev, newElement]);
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
      setElements((prev) => [...prev, newElement]);
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
    setElements((prev) => prev.filter((el) => el.id !== id));
  };

  const clearElements = () => setElements([]);

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

  // Fetch job details if we have a running job but no visualization (e.g. after page reload)
  useEffect(() => {
    const jobId = pathJobStatus?.jobId;
    const currentVizJobId = visualizationResult?.pathJob?.jobId;

    if (jobId && (!visualizationResult || currentVizJobId !== jobId)) {
      const fetchDetails = async () => {
        try {
          const response = await fetch(buildApiUrl(`/api/send-path/details/${jobId}`));
          if (response.ok) {
            const details = await response.json();
            // Only update if we have the essential data
            if (details.previewImage) {
              setVisualizationResult({
                previewImage: details.previewImage,
                pathPoints: details.points,
                pathLength: details.points ? details.points.length : 0,
                pathJob: details,
                // We don't have the original elements, but that's okay for viewing
                boardWidth: BOARD_WIDTH_MM,
                boardHeight: BOARD_HEIGHT_MM,
              });
            }
          }
        } catch (error) {
          console.error('Failed to fetch job details:', error);
        }
      };
      fetchDetails();
    }
  }, [pathJobStatus?.jobId, visualizationResult]);

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

  useEffect(() => {
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

  useEffect(() => {
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
  useEffect(() => {
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
    const imageElements = elements.filter((el) => el.type === 'image');
    const textElements = elements.filter((el) => el.type === 'text');

    if (imageElements.length === 0 && textElements.length === 0) {
      return null;
    }

    const scaleX = SCALE_X;
    const scaleY = SCALE_Y;

    const positions = [];
    const imagePaths = [];
    const textData = [];

    imageElements.forEach((element) => {
      const x = Math.round(element.x * scaleX);
      const y = Math.round(element.y * scaleY);
      const width = Math.round(element.width * scaleX);
      const height = Math.round(element.height * scaleY);

      positions.push(x, y, width, height);
      imagePaths.push(element.src);
    });

    textElements.forEach((element) => {
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
    return date.toLocaleTimeString();
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
  }, [pathJobStatus]);

  useEffect(() => () => {
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
  }, []);

  const hasResults = Boolean(visualizationResult || animationResult || isCreatingAnimation);
  const jobIsActive = ACTIVE_JOB_STATUSES.has(pathJobStatus?.status);
  const sortedElements = useMemo(
    () => [...elements].sort((a, b) => {
      // Sort so text elements appear above image elements
      if (a.type === 'text' && b.type === 'image') return 1;
      if (a.type === 'image' && b.type === 'text') return -1;
      return 0;
    }),
    [elements]
  );

  const resultStats = useMemo(() => {
    const items = [
      {
        label: 'Board',
        value: `${visualizationResult?.boardWidth || BOARD_WIDTH_MM} × ${visualizationResult?.boardHeight || BOARD_HEIGHT_MM} mm`,
      },
      { label: 'Images', value: visualizationResult?.imageCount ?? '—' },
      { label: 'Path points', value: visualizationResult?.pathLength?.toLocaleString?.() ?? '—' },
      {
        label: 'Animation',
        value: animationResult ? `${animationResult.frameCount ?? '—'} frames` : '—',
      },
    ];
    return items;
  }, [visualizationResult, animationResult]);

  return (
    <div
      id="top"
      className="min-h-screen bg-gray-50 text-gray-900 transition-colors duration-300 dark:bg-gray-900 dark:text-white"
    >
      <Navbar onOpenMotorControl={onOpenMotorControl} />

      <main className="pt-16">
        {/* Hero --------------------------------------------------------- */}
        <Section band="a" tight>
          <Container>
            <motion.div {...theme.animations.fadeInUp} className="text-center">
              <h1 className="text-3xl font-bold md:text-4xl">
                Whiteboard <span className="text-blue-600 dark:text-blue-400">Designer</span>
              </h1>
              <div className="mx-auto mt-4 h-1 w-20 rounded-full bg-blue-600 dark:bg-blue-500" />
              <p className="mx-auto mt-6 max-w-2xl text-lg opacity-90">
                Lay out images and text on the board, preview the path the polargraph will take, then
                send the job to the machine.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                <Pill>{BOARD_WIDTH_MM} × {BOARD_HEIGHT_MM} mm board</Pill>
                <Pill>{MARGIN_MM} mm safe margin</Pill>
                <Pill>ESP32 over Wi-Fi</Pill>
              </div>
            </motion.div>
          </Container>
        </Section>

        {/* Design ------------------------------------------------------- */}
        <Section band="b" id="design">
          <Container>
            <SectionHeader
              title="Design"
              description="Drop in images, add text, then drag and resize everything until the layout looks right."
            />

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
              {/* Canvas */}
              <Card className="order-1 p-4 sm:p-6 lg:sticky lg:top-24">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold">Canvas</h3>
                    <Pill tone="neutral">
                      {elements.length} element{elements.length !== 1 ? 's' : ''}
                    </Pill>
                  </div>
                  {elements.length > 0 && (
                    <Button variant="ghost" size="sm" icon={Trash2} onClick={clearElements}>
                      Clear all
                    </Button>
                  )}
                </div>

                <motion.div
                  ref={canvasRef}
                  {...theme.animations.fadeIn}
                  className={cn(
                    'board-surface relative mx-auto w-full overflow-hidden rounded-lg border-2 transition-colors duration-200',
                    isDragOver
                      ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-500/10'
                      : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
                  )}
                  style={{
                    maxWidth: `${CANVAS_WIDTH}px`,
                    aspectRatio: `${CANVAS_WIDTH}/${CANVAS_HEIGHT}`,
                    cursor: dragging ? 'grabbing' : resizing ? 'se-resize' : 'default',
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
                    files.forEach((file) => processImageFile(file));
                  }}
                >
                  {/* Reachable-area guide */}
                  <div
                    className="pointer-events-none absolute z-0 rounded-sm border border-dashed border-blue-600/30 dark:border-blue-400/30"
                    style={{
                      top: `${MARGIN_Y_PCT}%`,
                      bottom: `${MARGIN_Y_PCT}%`,
                      left: `${MARGIN_X_PCT}%`,
                      right: `${MARGIN_X_PCT}%`,
                    }}
                  />

                  <AnimatePresence>
                    {sortedElements.map((element) => (
                      <motion.div
                        key={element.id}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        className="group absolute select-none"
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
                        <div
                          className={cn(
                            'relative h-full w-full overflow-hidden rounded-md border transition-colors',
                            'border-gray-300 group-hover:border-blue-500 dark:border-gray-600 dark:group-hover:border-blue-400',
                            (dragging === element.id || resizing === element.id) &&
                              'border-blue-600 dark:border-blue-400'
                          )}
                        >
                          {element.type === 'image' ? (
                            <img
                              src={element.src}
                              alt="Uploaded"
                              className="h-full w-full object-fill"
                              onDragStart={(e) => e.preventDefault()}
                              draggable={false}
                            />
                          ) : (
                            <div
                              className="relative flex h-full w-full select-none items-center justify-center rounded-md bg-gray-900/5 p-2 dark:bg-white/10"
                              style={{
                                fontSize: element.fontSize * canvasScale,
                                fontFamily: element.fontFamily,
                                fontWeight: element.isBold ? 'bold' : 'normal',
                                fontStyle: element.isItalic ? 'italic' : 'normal',
                                color: element.color,
                              }}
                              onDragStart={(e) => e.preventDefault()}
                              draggable={false}
                            >
                              {/* Centering indicator */}
                              <div className="el-chrome absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500" />
                              {element.text}
                            </div>
                          )}

                          {/* Delete */}
                          <button
                            type="button"
                            onClick={() => deleteElement(element.id)}
                            aria-label="Delete element"
                            className="delete-btn el-chrome el-delete absolute -right-2 -top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition-colors hover:bg-red-600"
                          >
                            <Trash2 size={14} />
                          </button>

                          {/* Resize */}
                          <div
                            className="resize-handle el-chrome el-handle absolute bottom-0 right-0 z-10 flex h-6 w-6 cursor-se-resize items-end justify-end rounded-tl-md bg-blue-600 transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleResizeMouseDown(e, element);
                            }}
                            onTouchStart={(e) => {
                              e.stopPropagation();
                              handleResizeTouchStart(e, element);
                            }}
                            style={{ touchAction: 'none' }}
                          >
                            <div className="mb-1 mr-1 h-2 w-2 border-b-2 border-r-2 border-white" />
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  {elements.length === 0 && (
                    <motion.div
                      {...theme.animations.fadeIn}
                      className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"
                    >
                      <div className="text-center opacity-60">
                        <ImageIcon className="mx-auto mb-3 h-10 w-10" strokeWidth={1.5} />
                        <p className="text-sm font-medium sm:text-base">
                          Drop an image here, paste from the clipboard, or add text
                        </p>
                      </div>
                    </motion.div>
                  )}
                </motion.div>

                <p className="mt-3 text-xs opacity-60">
                  The dashed guide marks the {MARGIN_MM} mm margin the pen can reach. Elements stay inside it.
                </p>

                <div className="mt-4 flex flex-col gap-3 border-t border-gray-200 pt-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm opacity-70">
                    {hasResults ? 'Recompute after changing the layout.' : 'Generate a preview when the layout is ready.'}
                  </p>
                  {isCreatingAnimation ? (
                    <Button variant="danger" size="md" onClick={cancelAnimation} className="w-full sm:w-auto">
                      <Spinner />
                      Cancel render
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="md"
                      icon={isVisualizing ? undefined : Sparkles}
                      onClick={runVisualization}
                      disabled={isVisualizing || elements.length === 0}
                      className="w-full sm:w-auto"
                    >
                      {isVisualizing ? (
                        <>
                          <Spinner />
                          Computing…
                        </>
                      ) : (
                        'Generate preview'
                      )}
                    </Button>
                  )}
                </div>
              </Card>

              {/* Control rail */}
              <div className="order-2 space-y-6">
                {/* Images */}
                <Card className="space-y-4 p-6">
                  <CardHeader
                    icon={Upload}
                    title="Images"
                    description="Upload, drag onto the canvas, or paste with Ctrl+V."
                  />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    ref={fileInputRef}
                    className="hidden"
                  />
                  <Button
                    variant="primary"
                    size="md"
                    icon={Upload}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full"
                  >
                    Upload image
                  </Button>
                </Card>

                {/* Text */}
                <Card className="space-y-5 p-6">
                  <CardHeader icon={Type} title="Text" description="Add a line of text to the board." />

                  <Field label="Content" htmlFor="text-content">
                    <TextInput
                      id="text-content"
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addTextElement();
                      }}
                      placeholder="Enter your text…"
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Font" htmlFor="text-font">
                      <Select
                        id="text-font"
                        value={fontFamily}
                        onChange={(e) => setFontFamily(e.target.value)}
                      >
                        {FONT_OPTIONS.map((font) => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <Field label="Size" htmlFor="text-size" hint="36–72 px">
                      <TextInput
                        id="text-size"
                        type="number"
                        value={fontSize}
                        onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                        min="36"
                        max="72"
                      />
                    </Field>
                  </div>

                  <div className="flex flex-wrap items-end gap-6">
                    <div className="space-y-2">
                      <Label>Weight</Label>
                      <div className="flex gap-2">
                        <ToggleButton
                          pressed={isBold}
                          onClick={() => setIsBold(!isBold)}
                          aria-label="Bold"
                          className="font-bold"
                        >
                          B
                        </ToggleButton>
                        <ToggleButton
                          pressed={isItalic}
                          onClick={() => setIsItalic(!isItalic)}
                          aria-label="Italic"
                          className="font-serif italic"
                        >
                          I
                        </ToggleButton>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Rendering</Label>
                      <SegmentedControl
                        ariaLabel="Text rendering style"
                        value={textRenderingStyle}
                        onChange={setTextRenderingStyle}
                        options={TEXT_STYLES}
                      />
                    </div>
                  </div>

                  <Button
                    variant="primary"
                    size="md"
                    icon={Type}
                    onClick={addTextElement}
                    disabled={!textInput.trim()}
                    className="w-full"
                  >
                    Add text element
                  </Button>
                </Card>

                {/* Path settings */}
                <Card className="space-y-5 p-6">
                  <CardHeader
                    icon={SlidersHorizontal}
                    title="Path settings"
                    description="How images become pen strokes."
                  />

                  <Field label="Drawing method">
                    <SegmentedControl
                      ariaLabel="Drawing method"
                      value={drawingMethod}
                      onChange={setDrawingMethod}
                      options={DRAWING_METHODS}
                      className="grid grid-cols-3 gap-2"
                    />
                  </Field>

                  <AnimatePresence initial={false}>
                    {drawingMethod === 'hatch' && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <Field label={`Hatch spacing — ${hatchSpacing} px`} htmlFor="hatch-spacing">
                          <RangeInput
                            id="hatch-spacing"
                            min="10"
                            max="30"
                            value={hatchSpacing}
                            onChange={(e) => setHatchSpacing(parseInt(e.target.value, 10))}
                          />
                          <div className="flex justify-between text-xs opacity-60">
                            <span>Dense</span>
                            <span>Wide</span>
                          </div>
                        </Field>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="border-t border-gray-200 pt-5 dark:border-gray-800">
                    <Switch
                      checked={uniformScaling}
                      onChange={setUniformScaling}
                      label="Uniform scaling"
                      description="Keep the aspect ratio while resizing."
                    />
                  </div>
                </Card>
              </div>
            </div>
          </Container>
        </Section>

        {/* Preview ------------------------------------------------------ */}
        <Section band="a" id="preview">
          <Container>
            <SectionHeader
              title="Preview"
              description="What the polargraph will draw, rendered from the simplified path."
            />

            {!hasResults ? (
              <motion.div {...theme.animations.fadeInUp}>
                <EmptyState
                  icon={Sparkles}
                  title="No preview yet"
                  description="Add elements to the canvas and select Generate preview to render the drawing path and its animation."
                />
              </motion.div>
            ) : (
              <div className="space-y-8">
                <Card className="p-6">
                  <StatGrid items={resultStats} />
                </Card>

                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {visualizationResult?.previewImage && (
                    <Card className="overflow-hidden">
                      <div className="flex aspect-[4/3] items-center justify-center bg-gray-50 p-3 dark:bg-gray-800">
                        <img
                          src={visualizationResult.previewImage}
                          alt="Combined layout"
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div className="p-5">
                        <h3 className="font-bold">Combined layout</h3>
                        <p className="mt-1 text-sm opacity-80">Your elements with the path overlaid.</p>
                      </div>
                    </Card>
                  )}

                  {visualizationResult?.pathImage && (
                    <Card className="overflow-hidden">
                      <div className="flex aspect-[4/3] items-center justify-center bg-gray-50 p-3 dark:bg-gray-800">
                        <img
                          src={visualizationResult.pathImage}
                          alt="Drawing path"
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div className="p-5">
                        <h3 className="font-bold">Drawing path</h3>
                        <p className="mt-1 text-sm opacity-80">Pen strokes only, in drawing order.</p>
                      </div>
                    </Card>
                  )}

                  {(isCreatingAnimation || animationResult?.animationGif) && (
                    <Card className="overflow-hidden">
                      <div className="flex aspect-[4/3] items-center justify-center bg-gray-50 p-3 dark:bg-gray-800">
                        {isCreatingAnimation ? (
                          <div className="flex flex-col items-center gap-4 text-center">
                            <Loader2 className="h-10 w-10 animate-spin text-blue-600 dark:text-blue-400" />
                            <p className="text-sm opacity-80">Rendering animation…</p>
                            <Button variant="danger" size="sm" onClick={cancelAnimation}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <img
                            src={animationResult.animationGif}
                            alt="Drawing animation"
                            className="max-h-full max-w-full object-contain"
                          />
                        )}
                      </div>
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-bold">Animation</h3>
                            <p className="mt-1 text-sm opacity-80">
                              {animationResult?.duration
                                ? `Sequence, ${animationResult.duration}.`
                                : 'The stroke sequence, played back.'}
                            </p>
                          </div>
                          {animationResult?.animationGif && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={Download}
                              onClick={() => {
                                const link = document.createElement('a');
                                link.href = animationResult.animationGif;
                                link.download = 'drawing_animation.gif';
                                link.click();
                              }}
                            >
                              GIF
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  )}
                </div>
              </div>
            )}
          </Container>
        </Section>

        {/* Controller --------------------------------------------------- */}
        <Section band="b" id="controller">
          <Container>
            <SectionHeader
              title="Controller"
              description="Queue the drawing on the ESP32 and follow its progress without blocking this page."
            />

            <Card className="space-y-6 p-6 md:p-8">
              <CardHeader
                icon={Cpu}
                title="Send to plotter"
                description="The job runs on the controller; you can leave this page once it starts."
                actions={
                  <Pill tone={statusTone(pathJobStatus?.status)}>
                    {pathJobStatus?.status || 'idle'}
                    {pathJobStatus?.paused ? ' · paused' : ''}
                  </Pill>
                }
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Controller URL" htmlFor="controller-url">
                  <TextInput
                    id="controller-url"
                    value={controllerUrl}
                    onChange={(event) => setControllerUrl(event.target.value)}
                    placeholder="http://192.168.x.x"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck="false"
                  />
                </Field>

                <Field label="Speed" htmlFor="controller-speed">
                  <Select
                    id="controller-speed"
                    value={controllerSpeed}
                    onChange={(event) => setControllerSpeed(parseInt(event.target.value, 10))}
                  >
                    {SPEED_OPTIONS.map((option) => (
                      <option key={option.label} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  size="md"
                  icon={isSendingPath ? undefined : Play}
                  onClick={sendPathToController}
                  disabled={isSendingPath || elements.length === 0 || jobIsActive}
                >
                  {isSendingPath ? (
                    <>
                      <Spinner />
                      Sending…
                    </>
                  ) : (
                    'Send path'
                  )}
                </Button>

                {(pathJobStatus?.status === 'pending' || pathJobStatus?.status === 'running') && (
                  <>
                    {pathJobStatus?.paused ? (
                      <Button
                        variant="secondary"
                        size="md"
                        icon={Play}
                        onClick={resumePathTransmission}
                        disabled={isSendingPath}
                      >
                        Resume
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="md"
                        icon={Pause}
                        onClick={pausePathTransmission}
                        disabled={isSendingPath}
                      >
                        Pause
                      </Button>
                    )}
                    <Button variant="danger" size="md" icon={Square} onClick={cancelPathTransmission}>
                      Stop
                    </Button>
                  </>
                )}
              </div>

              {elements.length === 0 && (
                <p className="text-sm opacity-70">Add elements to the canvas before sending a job.</p>
              )}

              {pathSendError && (
                <p className="text-sm text-red-600 dark:text-red-400">{pathSendError}</p>
              )}

              {/* Live status */}
              <div className={cn('relative p-5', theme.surface.well)}>
                {pathStatusOverlayMessage && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-gray-100/70 dark:bg-gray-900/60">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600 dark:text-blue-400" />
                    <span className="mt-2 px-4 text-center text-xs font-medium">
                      {pathStatusOverlayMessage}
                    </span>
                  </div>
                )}

                <div
                  className={cn(
                    'space-y-4',
                    pathStatusOverlayMessage && 'pointer-events-none opacity-50 transition-opacity duration-200'
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">Transmission</span>
                    {pathJobStatus?.jobId && (
                      <span className="font-mono text-xs opacity-60">{pathJobStatus.jobId}</span>
                    )}
                  </div>

                  {pathJobStatus?.totalPoints ? (
                    <div className="space-y-2">
                      <ProgressBar value={jobProgressPercent} />
                      <div className="flex flex-wrap justify-between gap-2 text-xs opacity-70">
                        <span>
                          {(pathJobStatus?.sentPoints || 0).toLocaleString()} / {(pathJobStatus?.totalPoints || 0).toLocaleString()} points
                        </span>
                        <span>
                          {pathJobStatus?.sentBatches || 0} / {pathJobStatus?.totalBatches || 0} batches
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs opacity-70">
                      {pathJobStatus
                        ? 'Awaiting transmission data…'
                        : 'No active controller job yet. Send a path to see live progress.'}
                    </p>
                  )}

                  {pathJobStatus?.error && (
                    <p className="text-xs text-red-600 dark:text-red-400">Error: {pathJobStatus.error}</p>
                  )}
                  {pathJobStatus?.controllerStatus?.error && (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      Status poller error: {pathJobStatus.controllerStatus.error}
                    </p>
                  )}
                  {pathJobStatus?.controllerStatus?.stale && (
                    <p className="text-xs opacity-70">Controller status is stale; awaiting refresh…</p>
                  )}
                  {pathJobStatus?.paused && (
                    <p className="text-xs opacity-70">
                      Transmission is paused. Resume to continue sending the remaining batches.
                    </p>
                  )}
                  {pathJobStatus?.status === 'idle' && pathJobStatus?.lastState && (
                    <p className="text-xs opacity-70">Last job: {pathJobStatus.lastState}</p>
                  )}

                  <p className="text-xs opacity-60">
                    {pathLastUpdatedLabel ? `Last update ${pathLastUpdatedLabel}` : 'No updates received yet.'}
                  </p>
                </div>
              </div>
            </Card>
          </Container>
        </Section>
      </main>

      <Footer />
      <ScrollToTopButton />
    </div>
  );
};

export default Whiteboard;
