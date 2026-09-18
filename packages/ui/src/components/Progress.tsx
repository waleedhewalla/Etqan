'use client';

import * as React from 'react';
import { ctv } from '../lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
}

export function Progress({ value = 0, max = 100, className, ...props }: ProgressProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={ctv('h-2 w-full overflow-hidden rounded-full bg-divider', className)}
      {...props}
    >
      <div
        className="h-full rounded-full bg-brand-primary transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
