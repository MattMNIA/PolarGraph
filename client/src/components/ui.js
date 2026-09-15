// src/components/ui.js
//
// Shared primitives for the Whiteboard Designer UI.
// Every screen builds from these so spacing, radii, borders and motion stay
// identical across the app. See ../theme.js for the tokens behind them.

import React from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn, theme } from '../theme';

/* ------------------------------------------------------------------ layout */

export const Container = ({ className, children }) => (
  <div className={cn(theme.layout.container, className)}>{children}</div>
);

export const Section = ({ band = 'a', tight = false, id, className, children }) => (
  <section
    id={id}
    className={cn(
      theme.layout.band[band],
      tight ? theme.layout.sectionTight : theme.layout.section,
      'scroll-mt-16 transition-colors duration-300',
      className
    )}
  >
    {children}
  </section>
);

export const SectionHeader = ({ title, description, className }) => (
  <motion.div {...theme.animations.fadeInUp} className={cn('mb-12 text-center md:mb-16', className)}>
    <h2 className="text-3xl font-bold md:text-4xl">{title}</h2>
    <div className="mx-auto mt-4 h-1 w-20 rounded-full bg-blue-600 dark:bg-blue-500" />
    {description && <p className="mx-auto mt-6 max-w-2xl text-lg opacity-90">{description}</p>}
  </motion.div>
);

/* ------------------------------------------------------------------- cards */

export const Card = ({ className, animate = true, children, ...rest }) => {
  const Component = animate ? motion.div : 'div';
  const animation = animate ? theme.animations.fadeInUp : {};
  return (
    <Component className={cn(theme.surface.card, className)} {...animation} {...rest}>
      {children}
    </Component>
  );
};

export const CardHeader = ({ icon: Icon, title, description, actions, className }) => (
  <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
    <div className="flex min-w-0 items-start gap-3">
      {Icon && (
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400">
          <Icon size={18} />
        </span>
      )}
      <div className="min-w-0">
        <h3 className="text-lg font-bold leading-tight">{title}</h3>
        {description && <p className="mt-1 text-sm opacity-80">{description}</p>}
      </div>
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>
);

/* ----------------------------------------------------------------- buttons */

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const BUTTON_SIZES = {
  lg: 'px-6 py-3 text-base font-semibold',
  md: 'px-5 py-2.5 text-sm font-semibold',
  sm: 'px-3 py-2 text-sm font-medium',
  icon: 'p-2',
};

const BUTTON_VARIANTS = {
  primary:
    'text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 shadow-sm',
  secondary:
    'border-2 bg-white text-gray-800 border-gray-300 hover:border-gray-400 hover:bg-gray-50 shadow-sm ' +
    'dark:bg-transparent dark:text-gray-200 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-800',
  // Reserved for the destructive machine controls (stop / cancel / delete).
  danger:
    'border-2 border-red-300 text-red-700 hover:bg-red-50 ' +
    'dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10',
  ghost:
    'text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300',
  icon:
    'rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 ' +
    'dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
};

export const Button = ({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconSize = 16,
  className,
  children,
  disabled,
  ...rest
}) => (
  <motion.button
    type="button"
    disabled={disabled}
    className={cn(BUTTON_BASE, BUTTON_SIZES[size], BUTTON_VARIANTS[variant], className)}
    {...(disabled ? {} : theme.animations.hover)}
    {...rest}
  >
    {Icon && <Icon size={iconSize} className="shrink-0" />}
    {children}
  </motion.button>
);

export const Spinner = ({ size = 16, className }) => (
  <span
    className={cn('inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
    style={{ width: size, height: size }}
    aria-hidden="true"
  />
);

/* ------------------------------------------------------------------ inputs */

const CONTROL_BASE =
  'w-full rounded-lg border px-3 py-2.5 text-sm transition-colors ' +
  'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 ' +
  'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 ' +
  'dark:bg-gray-800 dark:border-gray-700 dark:text-white dark:placeholder:text-gray-500 ' +
  'dark:focus:border-blue-400 dark:focus:ring-blue-400/30';

export const Label = ({ htmlFor, className, children }) => (
  <label htmlFor={htmlFor} className={cn('block text-sm font-medium', className)}>
    {children}
  </label>
);

export const Field = ({ label, hint, htmlFor, className, children }) => (
  <div className={cn('space-y-2', className)}>
    {label && <Label htmlFor={htmlFor}>{label}</Label>}
    {children}
    {hint && <p className="text-xs opacity-60">{hint}</p>}
  </div>
);

export const TextInput = React.forwardRef(({ className, ...rest }, ref) => (
  <input ref={ref} className={cn(CONTROL_BASE, className)} {...rest} />
));
TextInput.displayName = 'TextInput';

export const Select = ({ className, children, ...rest }) => (
  <div className="relative">
    <select className={cn(CONTROL_BASE, 'appearance-none pr-10', className)} {...rest}>
      {children}
    </select>
    <ChevronDown
      size={16}
      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-60"
    />
  </div>
);

export const RangeInput = ({ className, ...rest }) => (
  <input type="range" className={cn('ui-range w-full', className)} {...rest} />
);

/* --------------------------------------------------------------- selectors */

export const SegmentedControl = ({ value, onChange, options, ariaLabel, className }) => (
  <div role="radiogroup" aria-label={ariaLabel} className={cn('flex flex-wrap gap-2', className)}>
    {options.map((option) => {
      const selected = option.value === value;
      return (
        <motion.button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={selected}
          onClick={() => onChange(option.value)}
          {...theme.animations.hoverSubtle}
          className={cn(
            'rounded-lg border-2 px-3 py-2 text-left text-sm font-semibold transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
            selected
              ? 'border-blue-600 bg-blue-600 text-white shadow-lg dark:border-blue-500 dark:bg-blue-500'
              : 'border-gray-300 bg-white text-gray-800 shadow-sm hover:border-gray-400 ' +
                  'dark:border-gray-700 dark:bg-transparent dark:text-gray-200 dark:hover:border-gray-600'
          )}
        >
          <span className="block">{option.label}</span>
          {option.hint && (
            <span className={cn('mt-0.5 block text-xs font-normal', selected ? 'text-white/80' : 'opacity-60')}>
              {option.hint}
            </span>
          )}
        </motion.button>
      );
    })}
  </div>
);

export const ToggleButton = ({ pressed, onClick, className, children, ...rest }) => (
  <motion.button
    type="button"
    aria-pressed={pressed}
    onClick={onClick}
    {...theme.animations.hoverSubtle}
    className={cn(
      'h-10 w-10 rounded-lg border-2 text-base transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
      pressed
        ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500'
        : 'border-gray-300 bg-white text-gray-800 hover:border-gray-400 ' +
            'dark:border-gray-700 dark:bg-transparent dark:text-gray-200 dark:hover:border-gray-600',
      className
    )}
    {...rest}
  >
    {children}
  </motion.button>
);

export const Switch = ({ checked, onChange, label, description, className }) => (
  <div className={cn('flex items-start justify-between gap-4', className)}>
    <div className="min-w-0">
      <p className="text-sm font-medium">{label}</p>
      {description && <p className="mt-0.5 text-xs opacity-70">{description}</p>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
        'focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900',
        checked ? 'bg-blue-600 dark:bg-blue-500' : 'bg-gray-300 dark:bg-gray-700'
      )}
    >
      <span
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
          checked && 'translate-x-5'
        )}
      />
    </button>
  </div>
);

/* -------------------------------------------------------------- indicators */

const PILL_TONES = {
  accent: 'bg-gray-200 text-blue-700 dark:bg-gray-700 dark:text-blue-300',
  neutral: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  danger: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

export const Pill = ({ tone = 'accent', icon: Icon, className, children }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
      PILL_TONES[tone],
      className
    )}
  >
    {Icon && <Icon size={12} />}
    {children}
  </span>
);

export const ProgressBar = ({ value = 0, className }) => (
  <div className={cn('h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700', className)}>
    <div
      className="h-full rounded-full bg-blue-600 transition-[width] duration-500 ease-out dark:bg-blue-500"
      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
    />
  </div>
);

export const StatGrid = ({ items, className }) => (
  <dl className={cn('grid grid-cols-2 gap-4 sm:grid-cols-4', className)}>
    {items.map((item) => (
      <div key={item.label} className="min-w-0">
        <dt className="text-xs uppercase tracking-wide opacity-60">{item.label}</dt>
        <dd className="mt-1 truncate font-medium text-blue-600 dark:text-blue-400">{item.value}</dd>
      </div>
    ))}
  </dl>
);

export const EmptyState = ({ icon: Icon, title, description, action, className }) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center',
      'border-gray-300 dark:border-gray-700',
      className
    )}
  >
    {Icon && <Icon className="mb-4 h-12 w-12 opacity-40" strokeWidth={1.5} />}
    <h3 className="text-lg font-bold">{title}</h3>
    {description && <p className="mt-2 max-w-md text-sm opacity-80">{description}</p>}
    {action && <div className="mt-6">{action}</div>}
  </div>
);
