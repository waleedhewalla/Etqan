'use client';

import * as React from 'react';
import { ctv, cva } from '../lib/utils';

/**
 * Input Component
 * States: default, focus, disabled, error, success, read-only
 * Variants: single-line, textarea, OTP, password, masked
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  success?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  variant?: 'default' | 'otp' | 'password' | 'masked';
}

const inputVariants = cva(
  'w-full rounded-lg border bg-white text-text-primary placeholder:text-muted ' +
  'transition-colors duration-150 ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent ' +
  'disabled:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'read-only:bg-neutral-50',
  {
    variants: {
      variant: {
        default: 'py-2.5 px-4 text-base',
        otp: 'py-2.5 px-4 text-base text-center tracking-widest font-mono',
        password: 'py-2.5 px-4 text-base pr-12',
        masked: 'py-2.5 px-4 text-base',
      },
      state: {
        default: 'border-divider hover:border-text-secondary',
        error: 'border-state-danger focus:ring-state-danger',
        success: 'border-state-positive focus:ring-state-positive',
      },
    },
    defaultVariants: {
      variant: 'default',
      state: 'default',
    },
  }
);

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, success, leftIcon, rightIcon, variant = 'default', id, ...props }, ref) => {
    const reactId = React.useId();
    const inputId = id || `input-${reactId.replace(/:/g, '')}`;
    const state = error ? 'error' : success ? 'success' : 'default';
    const describedBy = [hint, error].filter(Boolean).join(' ') || undefined;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-text-primary mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute inset-y-0 right-3 flex items-center text-text-secondary pointer-events-none" dir="ltr">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={inputVariants({ variant, state, className })}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={describedBy}
            dir={variant === 'otp' ? 'ltr' : undefined}
            {...props}
          />
          {rightIcon && (
            <div className="absolute inset-y-0 left-3 flex items-center text-text-secondary pointer-events-none" dir="ltr">
              {rightIcon}
            </div>
          )}
          {props.type === 'password' && (
            <button
              type="button"
              className="absolute inset-y-0 left-3 flex items-center text-text-secondary hover:text-text-primary"
              onClick={(e) => {
                e.preventDefault();
                const input = e.currentTarget.parentElement?.querySelector('input');
                if (input) input.type = input.type === 'password' ? 'text' : 'password';
              }}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
        </div>
        {(hint || error) && (
          <p id={`${inputId}-hint`} className="mt-1.5 text-sm" role="alert">
            {error ? (
              <span className="text-state-danger">{error}</span>
            ) : (
              <span className="text-text-secondary">{hint}</span>
            )}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

/**
 * Textarea Component
 */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  success?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, hint, error, success, id, ...props }, ref) => {
    const reactId = React.useId();
    const textareaId = id || `textarea-${reactId.replace(/:/g, '')}`;
    const state = error ? 'error' : success ? 'success' : 'default';
    const describedBy = [hint, error].filter(Boolean).join(' ') || undefined;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className="block text-sm font-medium text-text-primary mb-1.5">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={ctv(
            'w-full rounded-lg border bg-white text-text-primary placeholder:text-muted resize-y min-h-[100px] py-2.5 px-4 text-base',
            'transition-colors duration-150',
            'focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent',
            'disabled:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60',
            state === 'error' && 'border-state-danger focus:ring-state-danger',
            state === 'success' && 'border-state-positive focus:ring-state-positive',
            state === 'default' && 'border-divider hover:border-text-secondary',
            className
          )}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={describedBy}
          {...props}
        />
        {(hint || error) && (
          <p id={`${textareaId}-hint`} className="mt-1.5 text-sm" role="alert">
            {error ? (
              <span className="text-state-danger">{error}</span>
            ) : (
              <span className="text-text-secondary">{hint}</span>
            )}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

/**
 * OTP Input - 4/6 digit code with auto-focus
 */
export interface OTPInputProps {
  length?: 4 | 6;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function OTPInput({ length = 4, value, onChange, disabled, autoFocus }: OTPInputProps) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  
  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.replace(/\D/g, '');
    const newArray = value.split('');
    newArray[index] = newValue;
    const joined = newArray.join('');
    onChange(joined);
    
    if (newValue && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  };
  
  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };
  
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    const newArray = pasted.split('').concat(new Array(length - pasted.length).fill(''));
    onChange(newArray.join(''));
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  };

  return (
    <div className="flex gap-2" dir="ltr" role="group" aria-label="رمز التحقق">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={value[i] || ''}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          className="w-12 h-12 text-center text-2xl font-mono rounded-lg border border-divider focus:ring-2 focus:ring-brand-primary focus:border-transparent disabled:bg-neutral-100"
          aria-label={`رقم ${i + 1}`}
        />
      ))}
    </div>
  );
}