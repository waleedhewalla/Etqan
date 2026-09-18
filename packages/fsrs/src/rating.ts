/**
 * Rating utilities for FSRS
 */

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export const RATING_LABELS_AR: Record<Rating, string> = {
  again: 'أعد',
  hard: 'صعب',
  good: 'جيد',
  easy: 'سهل',
};

export const RATING_LABELS_EN: Record<Rating, string> = {
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};

export const RATING_COLORS: Record<Rating, string> = {
  again: '#EF4444',  // red-500
  hard: '#F59E0B',   // amber-500
  good: '#2D7A4E',   // state-positive
  easy: '#10B981',   // emerald-500
};

export const RATING_SHORTCUTS: Record<Rating, string> = {
  again: '1',
  hard: '2',
  good: '3',
  easy: '4',
};

export const RATING_DESCRIPTIONS_AR: Record<Rating, string> = {
  again: 'لم أتذكره إطلاقاً',
  hard: 'تذكرته بصعوبة',
  good: 'تذكرته جيداً',
  easy: 'تذكرته بسهولة تامة',
};

export function getRatingLabel(rating: Rating, locale = 'ar'): string {
  return locale === 'ar' ? RATING_LABELS_AR[rating] : RATING_LABELS_EN[rating];
}

export function getRatingColor(rating: Rating): string {
  return RATING_COLORS[rating];
}

export function getRatingShortcut(rating: Rating): string {
  return RATING_SHORTCUTS[rating];
}

export function getRatingDescription(rating: Rating, locale = 'ar'): string {
  return locale === 'ar' ? RATING_DESCRIPTIONS_AR[rating] : '';
}

export const ALL_RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];

/**
 * Keyboard handler for rating buttons
 * 1 = Again, 2 = Hard, 3 = Good, 4 = Easy
 */
export function handleRatingKeydown(
  e: React.KeyboardEvent,
  onRating: (rating: Rating) => void
): void {
  switch (e.key) {
    case '1':
      onRating('again');
      break;
    case '2':
      onRating('hard');
      break;
    case '3':
      onRating('good');
      break;
    case '4':
      onRating('easy');
      break;
  }
}