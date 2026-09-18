'use client';

import * as React from 'react';
import { ctv, formatRelativeTime } from '../lib/utils';

/**
 * Card Component
 * States: default, hover, selected, loading, disabled, empty
 * Variants: content, metric, action, student, case, evidence
 */

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'content' | 'metric' | 'action' | 'student' | 'case' | 'evidence';
  hoverable?: boolean;
  selected?: boolean;
  loading?: boolean;
  empty?: boolean;
}

const cardVariants = ctv(
  'rounded-2xl bg-surface-elevated border border-divider shadow-sm transition-colors duration-200',
  {
    variants: {
      variant: {
        content: 'p-4',
        metric: 'p-4',
        action: 'p-4 cursor-pointer',
        student: 'p-4',
        case: 'p-4 border-l-4 border-brand-primary',
        evidence: 'p-4',
      },
      state: {
        default: '',
        hover: 'hover:shadow-elevated hover:border-brand-primary/30',
        selected: 'ring-2 ring-brand-primary border-brand-primary shadow-elevated',
        loading: 'opacity-60 pointer-events-none',
        disabled: 'opacity-40 pointer-events-none',
        empty: 'border-dashed border-text-muted',
      },
    },
    defaultVariants: {
      variant: 'content',
      state: 'default',
    },
    compoundVariants: [
      { variant: 'action', hoverable: true, state: 'hover', className: 'shadow-elevated -translate-y-0.5' },
      { variant: 'student', hoverable: true, state: 'hover', className: 'shadow-elevated' },
      { variant: 'case', hoverable: true, state: 'hover', className: 'shadow-elevated' },
    ],
  }
);

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, hoverable, selected, loading, empty, children, ...props }, ref) => {
    const state = loading ? 'loading' : empty ? 'empty' : selected ? 'selected' : hoverable ? 'hover' : 'default';
    
    return (
      <div
        ref={ref}
        className={cardVariants({ variant, state, className })}
        {...props}
      >
        {loading && (
          <div className="absolute inset-0 bg-surface-elevated/80 flex items-center justify-center z-10">
            <svg className="animate-spin h-6 w-6 text-brand-primary" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
        {empty && (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="w-16 h-16 rounded-full bg-neutral-100 flex items-center justify-center mb-3">
              <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <p className="text-text-secondary">لا توجد بيانات</p>
          </div>
        )}
        {!loading && !empty && children}
      </div>
    );
  }
);

Card.displayName = 'Card';

/**
 * Card Header
 */
export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={ctv('mb-3', className)} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

/**
 * Card Title
 */
export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={ctv('text-lg font-semibold text-text-primary', className)} {...props} />
  )
);
CardTitle.displayName = 'CardTitle';

/**
 * Card Description
 */
export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={ctv('text-sm text-text-secondary mt-1', className)} {...props} />
  )
);
CardDescription.displayName = 'CardDescription';

/**
 * Card Content
 */
export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={ctv('', className)} {...props} />
  )
);
CardContent.displayName = 'CardContent';

/**
 * Card Footer
 */
export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={ctv('mt-3 pt-3 border-t border-divider flex items-center gap-3', className)} {...props} />
  )
);
CardFooter.displayName = 'CardFooter';

/**
 * Metric Card - for dashboards
 */
export interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: { value: number; label: string };
  icon?: React.ReactNode;
  variant?: 'positive' | 'negative' | 'neutral';
  loading?: boolean;
}

export function MetricCard({ label, value, trend, icon, variant = 'neutral', loading }: MetricCardProps) {
  return (
    <Card variant="metric" loading={loading}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-text-secondary">{label}</p>
          <p className="mt-1 text-3xl font-bold text-text-primary numeric-lg">{value}</p>
          {trend && (
            <div className="mt-2 flex items-center gap-1.5 text-sm">
              <span className={ctv('font-medium', variant === 'positive' ? 'text-state-positive' : variant === 'negative' ? 'text-state-danger' : 'text-text-secondary')}>
                {trend.value >= 0 ? '+' : ''}{trend.value}%
              </span>
              <span className="text-text-muted">{trend.label}</span>
            </div>
          )}
        </div>
        {icon && <div className="text-text-muted">{icon}</div>}
      </div>
    </Card>
  );
}

/**
 * Student Card - for section roster
 */
export interface StudentCardProps {
  id: string;
  name: string;
  avatar?: string;
  status: 'active' | 'at-risk' | 'inactive' | 'excused';
  mastery: number;
  streak: number;
  lastActive: Date | string;
  onClick?: () => void;
}

export function StudentCard({ id, name, avatar, status, mastery, streak, lastActive, onClick }: StudentCardProps) {
  const statusColors = {
    active: 'bg-state-positive',
    'at-risk': 'bg-state-attention',
    inactive: 'bg-text-muted',
    excused: 'bg-state-info',
  };
  
  const statusLabels = {
    active: 'نشطة',
    'at-risk': 'تحتاج متابعة',
    inactive: 'غير نشطة',
    excused: 'معذورة',
  };

  return (
    <Card variant="student" hoverable onClick={onClick} className="group">
      <div className="flex items-start gap-4">
        <div className="relative flex-shrink-0">
          <div className="w-14 h-14 rounded-full bg-neutral-100 flex items-center justify-center overflow-hidden">
            {avatar ? (
              <img src={avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-brand-primary font-bold text-xl">{name.slice(0, 2)}</span>
            )}
          </div>
          <span className={ctv('absolute bottom-0 left-0 w-3.5 h-3.5 rounded-full border-2 border-white', statusColors[status])} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-text-primary truncate">{name}</h4>
          <div className="mt-1.5 flex items-center gap-3 text-sm text-text-secondary">
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" /></svg>
              {formatRelativeTime(lastActive)}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          <div className="flex items-center gap-1.5">
            <span className="text-2xl font-bold text-brand-primary">{mastery}%</span>
            <svg className="w-5 h-5 text-brand-primary" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
          </div>
          <span className={ctv('px-2 py-1 rounded-full text-xs font-medium', statusColors[status])}>
            {statusLabels[status]}
          </span>
        </div>
      </div>
    </Card>
  );
}