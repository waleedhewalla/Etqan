/**
 * Itqan Design Tokens
 * Calm Precision design system - Arabic-first, RTL-native
 * Colors from Gemini iterations, spacing from Manus 4-8pt scale
 */

// ============================================
// COLOR TOKENS
// ============================================

export const colors = {
  // Brand colors (Gemini iterations 3, 5)
  brand: {
    primary: '#1B4332',      // Deep Quranic green - primary CTAs, completed states
    secondary: '#1D2A44',    // Academic navy - faculty/admin interfaces, trust cues
    accent: '#C5A059',       // Muted gold - achievements, badges, milestones (sparingly)
  },

  // Surface colors — beige/sand system from the visual redesign
  surface: {
    canvas: '#F3EEE4',       // Warm sand beige - page background
    elevated: '#FFFCF7',     // Warm paper cards (not stark white)
    brand: '#1B4332',        // Dark forest green brand surface
    icon: '#F3EEE4',         // Beige cutout icons on green tiles
  },

  // Text colors
  text: {
    primary: '#1A1A1A',      // Body text on light surfaces
    secondary: '#555555',    // Meta text, labels, captions
    inverse: '#FDFBF7',      // Text on brand-primary/secondary
    muted: '#999999',        // Disabled, placeholder
  },

  // State colors (Manus UX review)
  state: {
    positive: '#2D7A4E',     // Completed, mastery achieved - distinct from brand-primary
    attention: '#D89E3A',    // Yellow-band ARI, needs-review, late warnings
    danger: '#B94A48',       // Red/critical-band ARI only, integrity flags, system errors
    info: '#4A6FA5',         // Informational callouts, feature discovery
  },

  // UI utility
  divider: '#E4D9C8',        // Borders, dividers - warm sand matching beige canvas
  focus: '#1B4332',          // Focus rings

  // Special scopes
  scope: {
    mahram: '#B58484',       // Soft rose - Mother's View only
  },

  // Legacy/semantic aliases
  success: '#2D7A4E',
  warning: '#D89E3A',
  error: '#B94A48',
} as const;

// ============================================
// TYPOGRAPHY TOKENS
// ============================================

export const fonts = {
  // Arabic fonts (Gemini iterations 1-8)
  arabic: {
    quran: '"Uthmanic Hafs", "KFGQPC Uthmanic Script Hafs", serif',      // Mushaf only
    heading: '"Amiri", "Noto Naskh Arabic", "Traditional Arabic", serif', // Headings
    body: '"Noto Naskh Arabic", "Amiri", "Traditional Arabic", sans-serif', // Body text
    admin: '"GE SS Two", "Alexandria", system-ui, sans-serif',           // Dashboards, tables
    dyslexia: '"Sakkal Majalla", "Taha", "GE SS Two", sans-serif',       // Dyslexia mode
  },
  // Latin fonts
  latin: {
    ui: '"Inter", system-ui, sans-serif',
    mono: '"JetBrains Mono", "Consolas", monospace',
  },
  // CSS variable names for Tailwind
  cssVars: {
    quran: 'font-quran',
    heading: 'font-heading',
    body: 'font-body',
    admin: 'font-admin',
    dyslexia: 'font-dyslexia',
    mono: 'font-mono',
  },
} as const;

// Type scale (Manus UX review section 6)
// Base: 16px, converted to rem in Tailwind
export const typeScale = {
  display: { size: '3rem', lineHeight: '3.5rem', weight: '700' },        // 48px - Landing hero
  h1: { size: '2rem', lineHeight: '2.5rem', weight: '700' },             // 32px - Page titles
  h2: { size: '1.5rem', lineHeight: '2rem', weight: '600' },             // 24px - Section titles
  h3: { size: '1.25rem', lineHeight: '1.75rem', weight: '600' },         // 20px - Subsection
  h4: { size: '1rem', lineHeight: '1.5rem', weight: '600' },             // 16px - Group labels
  'body-lg': { size: '1.125rem', lineHeight: '1.75rem', weight: '400' }, // 18px - Emphasized
  body: { size: '1rem', lineHeight: '1.5rem', weight: '400' },           // 16px - Standard
  'body-sm': { size: '0.875rem', lineHeight: '1.375rem', weight: '400' }, // 14px - Secondary
  caption: { size: '0.75rem', lineHeight: '1.125rem', weight: '400' },   // 12px - Labels, meta
  button: { size: '1rem', lineHeight: '1.25rem', weight: '500' },        // 16px - CTA labels
  'numeric-lg': { size: '2rem', lineHeight: '2.375rem', weight: '600' }, // 32px - KPI values
  mushaf: { size: '1.75rem', lineHeight: '3rem', weight: '400' },        // 28px - Quran text
  'mushaf-large': { size: '2.25rem', lineHeight: '3.625rem', weight: '400' }, // 36px - Accessibility
} as const;

// ============================================
// SPACING TOKENS
// ============================================

// Manus deep-competitive 7: 4-8 point scale
// Base unit: 4px
export const spacing = {
  xs: '0.25rem',   // 4px
  sm: '0.5rem',    // 8px
  md: '1rem',      // 16px
  lg: '1.5rem',    // 24px
  xl: '2rem',      // 32px
  '2xl': '3rem',   // 48px
  '3xl': '4rem',   // 64px
  '4xl': '5rem',   // 80px
  '5xl': '6rem',   // 96px
  '6xl': '8rem',   // 128px
} as const;

// Named semantic spacing
export const space = {
  inline: spacing.xs,      // 4px - inline elements
  tight: spacing.sm,       // 8px - tight groups
  base: spacing.md,        // 16px - base unit
  comfortable: spacing.lg, // 24px - comfortable reading
  section: spacing.xl,     // 32px - section separation (py-8)
  major: spacing['2xl'],   // 48px - major sections (py-12)
  page: spacing['3xl'],    // 64px - page-level (py-16)
} as const;

// ============================================
// ELEVATION TOKENS
// ============================================

export const elevation = {
  flat: 'none',
  raised: '0 1px 3px rgba(0,0,0,0.06)',
  elevated: '0 4px 12px rgba(0,0,0,0.08)',
  floating: '0 8px 24px rgba(0,0,0,0.12)',
  overlay: '0 16px 40px rgba(0,0,0,0.18)',
} as const;

// ============================================
// MOTION TOKENS
// ============================================

export const motion = {
  easing: {
    entrance: 'cubic-bezier(0.4, 0, 0.2, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
  },
  duration: {
    micro: '150ms',      // Button hover, chip state
    standard: '250ms',   // Page transition, modal
    deliberate: '400ms', // Progress completion, milestone
  },
  // Respect prefers-reduced-motion
} as const;

// ============================================
// BORDER RADIUS
// ============================================

export const radius = {
  none: '0',
  sm: '0.25rem',    // 4px
  md: '0.5rem',     // 8px - default
  lg: '1rem',       // 16px - cards
  xl: '1.25rem',    // 20px - icon tiles
  '2xl': '1.5rem',  // 24px
  '3xl': '1.75rem',
  full: '9999px',   // Pills, badges
} as const;

// ============================================
// BREAKPOINTS
// ============================================

export const breakpoints = {
  mobile: '360px',   // Worst-case Android
  tablet: '768px',
  desktop: '1024px',
  wide: '1280px',
  maxWidth: '640px',  // Mobile content max
  maxWidthDesktop: '1200px', // Desktop content max
} as const;

// ============================================
// Z-INDEX
// ============================================

export const zIndex = {
  base: 0,
  dropdown: 100,
  sticky: 200,
  modal: 300,
  popover: 400,
  toast: 500,
  tooltip: 600,
} as const;

// ============================================
// SHADOWS (Tailwind-compatible)
// ============================================

export const shadows = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
} as const;

// ============================================
// TRANSITIONS
// ============================================

export const transitions = {
  fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
  normal: '250ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow: '400ms cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

// ============================================
// UTILITY: CSS Variables for Tailwind
// ============================================

export const cssVariables = {
  // Colors
  '--color-brand-primary': colors.brand.primary,
  '--color-brand-secondary': colors.brand.secondary,
  '--color-brand-accent': colors.brand.accent,
  '--color-surface-canvas': colors.surface.canvas,
  '--color-surface-elevated': colors.surface.elevated,
  '--color-surface-brand': colors.surface.brand,
  '--color-surface-icon': colors.surface.icon,
  '--color-text-primary': colors.text.primary,
  '--color-text-secondary': colors.text.secondary,
  '--color-text-inverse': colors.text.inverse,
  '--color-state-positive': colors.state.positive,
  '--color-state-attention': colors.state.attention,
  '--color-state-danger': colors.state.danger,
  '--color-state-info': colors.state.info,
  '--color-divider': colors.divider,
  '--color-scope-mahram': colors.scope.mahram,

  // Spacing (already handled by Tailwind)
  // Typography (already handled by Tailwind)
  // Motion (already handled by Tailwind)
} as const;

export type ColorToken = keyof typeof colors;
export type FontToken = keyof typeof fonts.cssVars;
export type SpacingToken = keyof typeof spacing;
export type TypeScaleToken = keyof typeof typeScale;