/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#1B4332',
          secondary: '#1D2A44',
          accent: '#C5A059',
        },
        surface: {
          canvas: '#F3EEE4',
          elevated: '#FFFCF7',
          brand: '#1B4332',
          icon: '#F3EEE4',
        },
        text: {
          primary: '#1A1A1A',
          secondary: '#555555',
          inverse: '#FDFBF7',
          muted: '#999999',
        },
        state: {
          positive: '#2D7A4E',
          attention: '#D89E3A',
          danger: '#B94A48',
          info: '#4A6FA5',
        },
        divider: '#E4D9C8',
        scope: {
          mahram: '#B58484',
        },
      },
      fontFamily: {
        quran: ['Uthmanic Hafs', 'KFGQPC Uthmanic Script Hafs', 'serif'],
        heading: ['var(--font-amiri)', 'Amiri', 'Noto Naskh Arabic', 'Traditional Arabic', 'serif'],
        body: ['var(--font-noto-naskh)', 'Noto Naskh Arabic', 'Amiri', 'Traditional Arabic', 'sans-serif'],
        admin: ['GE SS Two', 'Alexandria', 'system-ui', 'sans-serif'],
        dyslexia: ['Sakkal Majalla', 'Taha', 'GE SS Two', 'sans-serif'],
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        display: ['3rem', { lineHeight: '3.5rem', fontWeight: '700' }],
        mushaf: ['1.75rem', { lineHeight: '3rem', fontWeight: '400' }],
        'mushaf-large': ['2.25rem', { lineHeight: '3.625rem', fontWeight: '400' }],
      },
      borderRadius: {
        none: '0',
        sm: '0.25rem',
        md: '0.5rem',
        lg: '1rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.75rem',
        full: '9999px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
        raised: '0 1px 3px rgba(0,0,0,0.06)',
        elevated: '0 4px 12px rgba(0,0,0,0.08)',
        floating: '0 8px 24px rgba(0,0,0,0.12)',
        overlay: '0 16px 40px rgba(0,0,0,0.18)',
      },
      transitionDuration: {
        micro: '150ms',
        standard: '250ms',
        deliberate: '400ms',
      },
      transitionTimingFunction: {
        entrance: 'cubic-bezier(0.4, 0, 0.2, 1)',
        exit: 'cubic-bezier(0.4, 0, 1, 1)',
      },
      screens: {
        mobile: '360px',
        tablet: '768px',
        desktop: '1024px',
        wide: '1280px',
      },
      maxWidth: {
        'content-mobile': '640px',
        'content-desktop': '1200px',
      },
      zIndex: {
        base: 0,
        dropdown: 100,
        sticky: 200,
        modal: 300,
        popover: 400,
        toast: 500,
        tooltip: 600,
      },
    },
  },
  plugins: [],
};
