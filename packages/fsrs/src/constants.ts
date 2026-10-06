/**
 * FSRS-4.5 Constants
 * Based on https://github.com/open-spaced-repetition/fsrs4anki
 * FSRS-C extensions for chain-aware spaced repetition
 */

export const FSRS_DEFAULTS: FSRSParameters = {
  // Core FSRS parameters (from fsrs4anki defaults)
  requestRetention: 0.9,
  maximumInterval: 36500, // 100 years
  enableFuzz: true,
  
  // 17 FSRS parameters (w)
  w: [
    0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14,
    0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61
  ],
  
  // FSRS-C chain propagation multipliers
  chainPropagation: {
    precedingPhoneticMultiplier: 0.85,    // When mutashabihat fails, preceding transition phonetic × 0.85
    followingAllMultiplier: 0.90,         // Following transition all dimensions × 0.90
    wrongAlternateAllMultiplier: 1.20,    // Wrong alternate all dimensions × 1.20 (reinforces wrong pattern)
  },
} as const;

export type FSRSParameters = {
  requestRetention: number;
  maximumInterval: number;
  enableFuzz: boolean;
  w: readonly number[];
  chainPropagation: {
    precedingPhoneticMultiplier: number;
    followingAllMultiplier: number;
    wrongAlternateAllMultiplier: number;
  };
};

// Rating to FSRS internal mapping
export const RATING_TO_FSRS = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
} as const;

export type Rating = keyof typeof RATING_TO_FSRS;

// Initial card state for new cards
export const INITIAL_CARD_STATE = {
  difficulty: 5.0,
  stability: 0.0,
  retrievability: 1.0,
  reps: 0,
  lapses: 0,
  state: 'new' as const,
  phoneticStability: 0,
  semanticStability: 0,
  positionalStability: 0,
  recognitionStability: 0,
};

// State transitions
export const STATE_TRANSITIONS = {
  new: { again: 'learning', hard: 'learning', good: 'review', easy: 'review' },
  learning: { again: 'learning', hard: 'learning', good: 'review', easy: 'review' },
  review: { again: 'relearning', hard: 'review', good: 'review', easy: 'review' },
  relearning: { again: 'relearning', hard: 'relearning', good: 'review', easy: 'review' },
  mastered: { again: 'relearning', hard: 'review', good: 'review', easy: 'review' },
} as const;

// Minimum intervals (in days)
export const MIN_INTERVALS = {
  again: 1 / 1440, // 1 minute
  hard: 1 / 24,    // 1 hour
  good: 1,         // 1 day
  easy: 4,         // 4 days
} as const;

// Gatekeeper defaults
export const GATEKEEPER_DEFAULTS = {
  enabled: true,
  threshold: 0.85,
  lookbackDays: 7,
  minReviewCount: 3,
} as const;