'use client';

import * as React from 'react';
import { ctv } from '../lib/utils';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { X } from 'lucide-react';

/**
 * Toast/Alert Component
 * Variants: info, success, warning, error, mahram-notification
 * Types: inline, toast, banner, modal
 */

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'success' | 'warning' | 'error' | 'mahram-notification';
  title?: string;
  description?: string;
  action?: React.ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
}

const toastVariants = ctv(
  'relative rounded-lg border p-4 shadow-lg transition-all duration-200 ' +
  'flex items-start gap-3 min-w-[300px] max-w-md',
  {
    variants: {
      variant: {
        info: 'bg-blue-50 border-blue-200 text-blue-900',
        success: 'bg-green-50 border-green-200 text-green-900',
        warning: 'bg-amber-50 border-amber-200 text-amber-900',
        error: 'bg-red-50 border-red-200 text-red-900',
        'mahram-notification': 'bg-scope-mahram/10 border-scope-mahram text-scope-mahram/90',
      },
    },
    defaultVariants: { variant: 'info' },
  }
);

const iconMap = {
  info: (
    <svg className="w-5 h-5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
    </svg>
  ),
  success: (
    <svg className="w-5 h-5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  ),
  warning: (
    <svg className="w-5 h-5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  ),
  error: (
    <svg className="w-5 h-5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
  ),
  'mahram-notification': (
    <svg className="w-5 h-5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
      <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
    </svg>
  ),
};

export function Toast({ variant = 'info', title, description, action, dismissible = true, onDismiss, className, ...props }: ToastProps) {
  return (
    <ToastPrimitives.Root className={toastVariants({ variant, className })} {...props}>
      <div className="flex-1">
        {title && <div className="font-semibold text-base">{title}</div>}
        {description && <div className="mt-1 text-sm opacity-90">{description}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
      {dismissible && (
        <ToastPrimitives.Close asChild>
          <button onClick={onDismiss} className="text-current opacity-50 hover:opacity-100 p-1 -m-1 rounded">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </ToastPrimitives.Close>
      )}
      {iconMap[variant]}
    </ToastPrimitives.Root>
  );
}

/**
 * Toast Provider for app-wide notifications
 */
export interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  return (
    <ToastPrimitives.Provider>
      {children}
      <ToastPrimitives.Viewport className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[320px] sm:w-[380px]" />
    </ToastPrimitives.Provider>
  );
}

/**
 * Inline Alert - for form errors, inline messages
 */
export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'success' | 'warning' | 'error' | 'mahram-notification';
  title?: string;
  children: React.ReactNode;
}

export function Alert({ variant = 'info', title, children, className, ...props }: AlertProps) {
  return (
    <div className={ctv(toastVariants({ variant }), 'p-4', className)} role="alert" {...props}>
      <div className="flex gap-3">
        <div className="shrink-0 mt-0.5">{iconMap[variant]}</div>
        <div className="flex-1">
          {title && <h4 className="font-medium text-base">{title}</h4>}
          <div className="mt-1 text-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Banner - full-width alert at top of page
 */
export interface BannerProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: React.ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
}

export function Banner({ variant = 'info', title, children, dismissible, onDismiss, className, ...props }: BannerProps) {
  return (
    <div className={ctv(
      'w-full border-b px-4 py-3 shadow-sm',
      variant === 'info' && 'bg-blue-50 border-blue-200 text-blue-900',
      variant === 'success' && 'bg-green-50 border-green-200 text-green-900',
      variant === 'warning' && 'bg-amber-50 border-amber-200 text-amber-900',
      variant === 'error' && 'bg-red-50 border-red-200 text-red-900',
      className
    )} role="banner" {...props}>
      <div className="max-w-7xl mx-auto flex items-start gap-3">
        <div className="shrink-0 mt-0.5">{iconMap[variant]}</div>
        <div className="flex-1">
          {title && <h4 className="font-medium text-base">{title}</h4>}
          <div className="mt-1 text-sm">{children}</div>
        </div>
        {dismissible && (
          <button onClick={onDismiss} className="text-current opacity-50 hover:opacity-100 p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Status Badge
 */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'green' | 'amber' | 'red' | 'gold' | 'info' | 'mahram-scope';
  size?: 'sm' | 'md' | 'lg';
  dot?: boolean;
}

const badgeVariants = ctv(
  'inline-flex items-center gap-1.5 font-medium rounded-full border',
  {
    variants: {
      variant: {
        green: 'bg-green-50 text-green-800 border-green-200',
        amber: 'bg-amber-50 text-amber-800 border-amber-200',
        red: 'bg-red-50 text-red-800 border-red-200',
        gold: 'bg-yellow-50 text-yellow-800 border-yellow-200',
        info: 'bg-blue-50 text-blue-800 border-blue-200',
        'mahram-scope': 'bg-scope-mahram/10 text-scope-mahram border-scope-mahram/20',
      },
      size: {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-1 text-sm',
        lg: 'px-3 py-1.5 text-base',
      },
    },
    defaultVariants: { variant: 'info', size: 'md' },
  }
);

export function Badge({ variant = 'info', size = 'md', dot, children, className, ...props }: BadgeProps) {
  return (
    <span className={badgeVariants({ variant, size, className })} {...props}>
      {dot && <span className={ctv('w-1.5 h-1.5 rounded-full', variant === 'green' && 'bg-green-500', variant === 'amber' && 'bg-amber-500', variant === 'red' && 'bg-red-500', variant === 'gold' && 'bg-yellow-500', variant === 'info' && 'bg-blue-500', variant === 'mahram-scope' && 'bg-scope-mahram')} />}
      {children}
    </span>
  );
}