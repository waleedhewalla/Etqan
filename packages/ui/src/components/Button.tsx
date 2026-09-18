'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { ctv } from '../lib/utils';

/**
 * Button Component
 * States: default, hover, focus, active, disabled, loading
 * Variants: primary, secondary, ghost, danger, link
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'link';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  loading?: boolean;
  asChild?: boolean;
}

const buttonVariants = ctv(
  'inline-flex items-center justify-center font-medium transition-colors duration-200 rounded-xl cursor-pointer ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary: 'bg-brand-primary text-white hover:bg-brand-primary/90 focus-visible:ring-brand-primary',
        secondary: 'bg-brand-secondary text-white hover:bg-brand-secondary/90 focus-visible:ring-brand-secondary',
        outline: 'bg-transparent border-2 border-brand-primary text-brand-primary hover:bg-brand-primary/5 focus-visible:ring-brand-primary',
        ghost: 'bg-transparent text-text-primary hover:bg-surface-canvas focus-visible:ring-brand-primary',
        danger: 'bg-state-danger text-white hover:bg-state-danger/90 focus-visible:ring-state-danger',
        link: 'bg-transparent text-brand-primary underline-offset-4 hover:underline focus-visible:ring-brand-primary',
      },
      size: {
        sm: 'h-8 px-3 text-sm gap-1.5',
        md: 'h-10 px-4 text-base gap-2',
        lg: 'h-12 px-6 text-lg gap-2.5',
        xl: 'h-14 px-8 text-xl gap-3',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, asChild = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    
    return (
      <Comp
        ref={ref}
        className={buttonVariants({ variant, size, className })}
        disabled={disabled || loading}
        aria-busy={loading}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {children}
      </Comp>
    );
  }
);

Button.displayName = 'Button';