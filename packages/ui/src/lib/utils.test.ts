import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('lets a later class override a conflicting earlier one', () => {
    // Regression: the header join button rendered white text on white
    // because caller overrides lost to the variant's text-white.
    expect(cn('bg-brand-primary text-white', 'bg-white text-brand-primary')).toBe('bg-white text-brand-primary');
  });

  it('drops falsy values', () => {
    expect(cn('p-4', false, undefined, 'm-2')).toBe('p-4 m-2');
  });
});
