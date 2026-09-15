# Theme and UI system

The design language here is shared with my portfolio site: one blue accent, one gray ramp,
class-based dark mode, system font stack. This file covers how that is wired up in this app.

## Files

| File | Role |
|---|---|
| `src/theme.js` | Tokens: colour ramps, page backgrounds, layout/band/surface class fragments, the shared animations. |
| `src/components/ui.js` | The primitives everything is built from — `Section`, `SectionHeader`, `Card`, `Button`, `Field`, `TextInput`, `Select`, `SegmentedControl`, `Switch`, `Pill`, `ProgressBar`, `EmptyState`, … |
| `src/components/ThemeProvider.js` | Dark-mode context. Owns the `dark` class on `<html>`, the `<body>` background and the `theme-color` meta tag. |
| `src/index.css` | CSS custom properties (mirroring the spec) plus the few things Tailwind can't reach: range thumbs, the canvas grid, touch-visible element chrome. |
| `tailwind.config.js` | Stock `blue` + `gray` only, class-based dark mode, system font stack. |

## Rules that keep this consistent

1. **Build from `ui.js`.** If a screen needs a control that isn't there, add it to
   `ui.js` rather than hand-rolling classes at the call site — that drift is what
   this refactor undid.
2. **One blue, one gray.** Accent is Tailwind `blue`; everything else is `gray`.
   Red is reserved for destructive machine controls (stop/cancel/delete) and error
   text. No other hues.
3. **Accent steps by mode.** `blue-600` in light; `blue-400` for text and
   `blue-500` for fills in dark. The `dark:` variants in `ui.js` already do this.
4. **Dim with opacity, not colour** — `opacity-90` body, `opacity-80` meta,
   `opacity-60` fine print, over the single root foreground.
5. **Sections alternate bands** (`Section band="a" | "b"`) with no rules between
   them, and each opens with a `SectionHeader` (title, `h-1 w-20` divider, one
   sentence).
6. **Cards step away from their band:** white on gray-100 in light, gray-900 on
   gray-800 in dark. Never make a dark card lighter than its band.
7. **Motion is one gesture:** `opacity 0→1, y 20→0` over 0.6s, once, on scroll-in
   (`theme.animations.fadeInUp`); hover `scale 1.05`, tap `0.95`.

## Note

`website_styling_guide.txt` in this folder is an outdated copy of the portfolio's
old guide (it describes routes and components this app never had). It is superseded
by `DESIGN_SYSTEM.md` and can be deleted.
