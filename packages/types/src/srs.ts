/**
 * FSRS-C (Chain-Aware Spaced Repetition) types
 * Based on FSRS-4.5 algorithm with mutashabihat chain propagation
 */

import type { Ref } from './ayah';

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface FSRSParameters {
  w: readonly number[];
  requestRetention: number;
  maximumInterval: number;
  enableFuzz: boolean;
  // FSRS-C specific
  chainPropagation: {
    precedingPhoneticMultiplier: number;    // 0.85
    followingAllMultiplier: number;         // 0.90
    wrongAlternateAllMultiplier: number;    // 1.20
  };
}

export interface CardState {
  // Core FSRS state
  difficulty: number;
  stability: number;
  retrievability: number;
  
  // Scheduling
  dueAt: Date;
  lastReviewedAt: Date | null;
  reps: number;
  lapses: number;
  
  // State
  state: 'new' | 'learning' | 'review' | 'relearning' | 'mastered';
  
  // FSRS-C: 4-dimensional mastery
  phoneticStability: number;
  semanticStability: number;
  positionalStability: number;
  recognitionStability: number;
  
  // Metadata
  firstSeenAt: Date;
  transitionId: string | null;  // For transition-level tracking
}

export interface ScheduledCard extends CardState {
  interval: number;  // days until next review
  nextDueAt: Date;
}

export interface StudentCard {
  id: string;
  studentId: string;
  ayahRef: Ref;
  transitionId: string | null;
  difficulty: number;
  stability: number;
  retrievability: number;
  dueAt: Date;
  lastReviewedAt: Date | null;
  reps: number;
  lapses: number;
  state: 'new' | 'learning' | 'review' | 'relearning' | 'mastered';
  phoneticStability: number;
  semanticStability: number;
  positionalStability: number;
  recognitionStability: number;
  firstSeenAt: Date;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  rating: Rating;
  reviewedAt: Date;
  timeTakenMs: number;
  wasCorrect: boolean;
  stateBefore: CardState;
  stateAfter: CardState;
}

export interface QueueItem {
  card: StudentCard;
  priority: number;
  reason: 'new' | 'overdue' | 'due-today' | 'mutashabihat-paired' | 'recovery' | 'upcoming-assessment' | 'sabaq' | 'sabqi' | 'manzil';
  estimatedMinutes: number;
  rationale: string;
}

export interface DailyQueue {
  studentId: string;
  date: Date;
  items: QueueItem[];
  totalEstimatedMinutes: number;
  newCount: number;
  reviewCount: number;
  mutashabihatCount: number;
}

// Gatekeeper Rule: blocks new memorization until recent review mastery >= threshold
export interface GatekeeperConfig {
  enabled: boolean;
  threshold: number; // default 0.85 (85%)
  lookbackDays: number; // how many days of recent reviews to consider
  minReviewCount: number; // minimum reviews needed to evaluate
}

export interface GatekeeperState {
  locked: boolean;
  currentMastery: number;
  threshold: number;
  deficitCards: number; // cards below threshold
  message: string;
}