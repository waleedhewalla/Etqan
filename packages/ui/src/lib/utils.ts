import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Merge Tailwind classes with proper precedence
 * Handles RTL logical properties automatically
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Class merger used by UI primitives (alias of cn)
 */
export function ctv(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type { VariantProps };
export { cva };

/**
 * Format date for Arabic locale with Hijri/Gregorian support
 */
export function formatDate(
  date: Date | string,
  options: {
    calendar?: 'gregory' | 'islamic';
    locale?: string;
    format?: 'short' | 'medium' | 'long' | 'full';
  } = {}
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const locale = options.locale || 'ar-EG';
  
  const formatOptions: Intl.DateTimeFormatOptions = {
    calendar: options.calendar || 'gregory',
    dateStyle: options.format || 'medium',
  };
  
  return new Intl.DateTimeFormat(locale, formatOptions).format(d);
}

/**
 * Format relative time (e.g., "منذ ساعتين", "قبل 3 أيام")
 */
export function formatRelativeTime(date: Date | string, locale = 'ar-EG'): string {
  if (typeof date === 'string' && Number.isNaN(Date.parse(date))) {
    return date;
  }
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (diffMins < 1) return rtf.format(-diffMins, 'second');
  if (diffMins < 60) return rtf.format(-diffMins, 'minute');
  if (diffHours < 24) return rtf.format(-diffHours, 'hour');
  if (diffDays < 30) return rtf.format(-diffDays, 'day');
  if (diffDays < 365) return rtf.format(-Math.floor(diffDays / 30), 'month');
  return rtf.format(-Math.floor(diffDays / 365), 'year');
}

/**
 * Convert Latin numerals to Arabic-Indic
 */
export function toArabicNumerals(str: string): string {
  return str.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[parseInt(d, 10)]);
}

/**
 * Convert Arabic-Indic numerals to Latin
 */
export function toLatinNumerals(str: string): string {
  return str.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString());
}

/**
 * Normalize Arabic text for search/comparison
 * Removes tashkeel, tatweel, normalizes alif variants
 */
export function normalizeArabic(text: string): string {
  return text
    // Remove tashkeel (diacritics)
    .replace(/[\u064B-\u065F]/g, '')
    // Remove tatweel (kashida)
    .replace(/\u0640/g, '')
    // Normalize alif variants
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    // Normalize ya variants
    .replace(/[\u0649\u064A]/g, '\u064A')
    // Normalize ta marbuta
    .replace(/\u0629/g, '\u0647')
    // Trim
    .trim();
}

/**
 * Truncate Arabic text at word boundary (never mid-diacritic)
 */
export function truncateArabic(text: string, maxLength: number, suffix = '…'): string {
  if (text.length <= maxLength) return text;
  
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  
  if (lastSpace > maxLength * 0.7) {
    return truncated.slice(0, lastSpace) + suffix;
  }
  
  return truncated + suffix;
}

/**
 * Get direction for mixed content
 */
export function getDirection(text: string): 'rtl' | 'ltr' {
  const rtlChars = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g);
  const ltrChars = text.match(/[A-Za-z0-9]/g);
  
  const rtlCount = rtlChars?.length || 0;
  const ltrCount = ltrChars?.length || 0;
  
  return rtlCount >= ltrCount ? 'rtl' : 'ltr';
}

/**
 * Format duration in Arabic (e.g., "12 دقيقة", "ساعة و 30 دقيقة")
 */
export function formatDuration(minutes: number, locale = 'ar-EG'): string {
  if (minutes < 60) {
    return new Intl.NumberFormat(locale).format(minutes) + ' ' + 
      new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(minutes, 'minute').replace(/\d+\s*/, '');
  }
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (mins === 0) {
    return new Intl.NumberFormat(locale).format(hours) + ' ' + 
      new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(hours, 'hour').replace(/\d+\s*/, '');
  }
  
  return `${new Intl.NumberFormat(locale).format(hours)} ساعة و ${new Intl.NumberFormat(locale).format(mins)} دقيقة`;
}

/**
 * Generate accessible ID
 */
export function generateId(prefix = 'itqan'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Deep merge objects
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, sourceValue as Record<string, unknown>);
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue;
    }
  }
  return result as T;
}