# Portfolio Theme System

This project includes a comprehensive theme system that makes it easy to recreate the styling and feel in other projects.

## Theme Architecture

### Core Files

- **`src/theme.js`** - Centralized theme configuration with colors, styles, and animations
- **`src/components/ThemeProvider.js`** - React context provider for global theme state management
- **`tailwind.config.js`** - Extended Tailwind configuration with custom colors

### Theme Structure

```javascript
// Colors
theme.colors = {
  primary: { 50: '#...', 500: '#3b82f6', ... },
  gray: { 50: '#...', 900: '#111827', ... },
  // etc.
}

// Common styles
theme.styles = {
  section: { base: 'py-24', light: 'bg-gray-100', dark: 'bg-gray-800' },
  card: { base: 'rounded-xl shadow-lg', light: 'bg-white', dark: 'bg-gray-900' },
  button: { primary: { base: '...', light: '...', dark: '...' } },
  // etc.
}

// Animations
theme.animations = {
  fadeInUp: { initial: {...}, whileInView: {...}, ... },
  staggerContainer: {...},
  // etc.
}
```

## How to Use in a New Project

### 1. Copy the Theme Files

Copy these files to your new project:
- `src/theme.js`
- `src/components/ThemeProvider.js`
- `tailwind.config.js` (merge with your existing config)

### 2. Install Dependencies

```bash
npm install framer-motion lucide-react react-icons
```

### 3. Set Up Theme Provider

Wrap your app with the ThemeProvider:

```javascript
import { ThemeProvider } from './components/ThemeProvider';

function App() {
  return (
    <ThemeProvider>
      {/* Your app content */}
    </ThemeProvider>
  );
}
```

### 4. Use Theme in Components

```javascript
import { useTheme } from '../components/ThemeProvider';
import { theme, getThemeClasses } from '../theme';

function MyComponent() {
  const { darkMode } = useTheme();

  return (
    <section className={getThemeClasses(
      theme.styles.section.base,
      theme.styles.section,
      darkMode
    )}>
      <motion.div {...theme.animations.fadeInUp}>
        <h2 className={theme.styles.text.heading.primary}>Title</h2>
        <div className={getThemeClasses(
          theme.styles.divider.base,
          theme.styles.divider,
          darkMode
        )}></div>
      </motion.div>
    </section>
  );
}
```

## Customization

### Changing Colors

Edit `src/theme.js` colors object. The colors are designed to work with both light and dark modes.

### Adding New Styles

Add new style patterns to `theme.styles` for consistent reuse across components.

### Custom Animations

Add new animation variants to `theme.animations` for consistent motion design.

## Benefits

- **Consistency**: All components use the same design tokens
- **Maintainability**: Change theme in one place, updates everywhere
- **Reusability**: Easy to copy theme system to new projects
- **Type Safety**: Centralized configuration reduces errors
- **Performance**: Optimized with Tailwind's purging and context-based state management

## Component Patterns

### Section Layout
```javascript
<section className={getThemeClasses(theme.styles.section.base, theme.styles.section, darkMode)}>
  <div className={theme.styles.container}>
    {/* Content */}
  </div>
</section>
```

### Cards
```javascript
<div className={getThemeClasses(theme.styles.card.base, theme.styles.card, darkMode)}>
  {/* Card content */}
</div>
```

### Buttons
```javascript
<button className={getThemeClasses(
  theme.styles.button.primary.base,
  theme.styles.button.primary,
  darkMode
)}>
  Click me
</button>
```

### Animations
```javascript
<motion.div {...theme.animations.fadeInUp}>
  {/* Animated content */}
</motion.div>
```

## Dark Mode Support

The theme system includes automatic dark mode support:
- Theme provider manages global dark mode state
- `getThemeClasses()` automatically applies light/dark variants
- LocalStorage persistence for user preference
- Smooth transitions between themes

## Extending the Theme

To add new theme properties:

1. Add to `theme.js`
2. Update component usage
3. Test in both light and dark modes
4. Update this documentation

This system provides a solid foundation for scalable, maintainable UI development across multiple projects.