/**
 * FSRS-4.5 Scheduler Implementation
 * Ported from fsrs4anki (TypeScript)
 * With FSRS-C chain propagation for mutashabihat
 */

import type { FSRSParameters, Rating, CardState, ScheduledCard, ReviewLog, GatekeeperConfig, GatekeeperState } from '@itqan/types';
import { FSRS_DEFAULTS, RATING_TO_FSRS, STATE_TRANSITIONS, MIN_INTERVALS, GATEKEEPER_DEFAULTS } from './constants';

/**
 * Core FSRS-4.5 algorithm
 * Calculates next card state based on current state and rating
 */
export function scheduleReview(
  card: CardState,
  rating: Rating,
  params: FSRSParameters = FSRS_DEFAULTS
): ScheduledCard {
  const r = RATING_TO_FSRS[rating];
  const now = new Date();
  
  // Clone card state
  const newState: CardState = { ...card };
  newState.lastReviewedAt = now;
  newState.reps += 1;
  
  if (rating === 'again') {
    newState.lapses += 1;
  }
  
  // Update state
  newState.state = STATE_TRANSITIONS[card.state][rating];
  
  // FSRS-4.5 calculations
  const { w } = params;
  
  // Calculate retrievability at review time
  const elapsedDays = card.lastReviewedAt 
    ? (now.getTime() - card.lastReviewedAt.getTime()) / (1000 * 60 * 60 * 24)
    : 0;
  
  let retrievability = Math.exp(-elapsedDays / Math.max(card.stability, 0.001));
  retrievability = Math.max(0, Math.min(1, retrievability));
  
  // Update difficulty
  let difficulty = card.difficulty;
  if (rating === 'again') {
    difficulty = difficulty + w[6] * (1 - retrievability);
  } else if (rating === 'hard') {
    difficulty = difficulty + w[7] * (1 - retrievability);
  } else if (rating === 'easy') {
    difficulty = difficulty - w[8] * retrievability;
  }
  
  // Clamp difficulty
  difficulty = Math.max(1, Math.min(10, difficulty));
  newState.difficulty = difficulty;
  
  // Calculate new stability
  let stability = card.stability;
  
  if (card.state === 'new' || newState.state === 'learning' || newState.state === 'relearning') {
    // First review and learning/relearning steps use the initial stability
    // for the rating (FSRS-4.5: S0(G) = w[G-1]).
    if (rating === 'again') {
      stability = w[0];
    } else if (rating === 'hard') {
      stability = w[1];
    } else if (rating === 'good') {
      stability = w[2];
    } else { // easy
      stability = w[3];
    }
  } else if (rating === 'again') {
    // Forgetting
    stability = w[11] * Math.pow(card.difficulty, -w[12]) * 
      Math.pow(stability + 1, w[13]) * Math.exp(w[14] * (1 - retrievability));
  } else {
    // Successful recall
    const difficultyFactor = Math.pow(difficulty, -w[9]);
    const stabilityFactor = Math.pow(stability, -w[10]);
    const retrievabilityFactor = Math.exp(w[14] * (1 - retrievability));
    
    let ratingFactor = 1;
    if (rating === 'hard') ratingFactor = w[15];
    else if (rating === 'good') ratingFactor = 1;
    else if (rating === 'easy') ratingFactor = w[16];
    
    stability = stability * (1 + difficultyFactor * stabilityFactor * retrievabilityFactor * ratingFactor);
  }
  
  // Clamp stability
  stability = Math.max(0.001, stability);
  newState.stability = stability;
  
  // Calculate next interval
  let interval = stability * Math.log(params.requestRetention) / Math.log(0.9);
  interval = Math.max(MIN_INTERVALS[rating], interval);
  interval = Math.min(params.maximumInterval, interval);
  
  // Apply fuzz
  if (params.enableFuzz && rating !== 'again') {
    const fuzz = Math.min(interval * 0.15, 2);
    interval += (Math.random() - 0.5) * 2 * fuzz;
  }
  
  interval = Math.round(interval);
  newState.dueAt = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);
  newState.retrievability = params.requestRetention;
  
  return {
    ...newState,
    interval,
    nextDueAt: newState.dueAt,
  };
}

/**
 * FSRS-C: Chain-Aware Spaced Repetition
 * When a mutashabihat pair is confused, propagate effects to related transitions
 */
export interface ChainPropagationInput {
  failedCard: CardState;
  failedRating: Rating;
  precedingTransitionId: string | null;
  followingTransitionId: string | null;
  wrongAlternateTransitionId: string | null;
}

export interface ChainPropagationResult {
  precedingUpdate: Partial<CardState> | null;
  followingUpdate: Partial<CardState> | null;
  wrongAlternateUpdate: Partial<CardState> | null;
}

export function propagateChainEffect(
  input: ChainPropagationInput,
  params: FSRSParameters = FSRS_DEFAULTS
): ChainPropagationResult {
  const { chainPropagation } = params;
  const failedRating = input.failedRating;
  
  // Only propagate on failure (again/hard)
  if (failedRating === 'good' || failedRating === 'easy') {
    return { precedingUpdate: null, followingUpdate: null, wrongAlternateUpdate: null };
  }
  
  const failureSeverity = failedRating === 'again' ? 1.0 : 0.5;
  
  return {
    precedingUpdate: input.precedingTransitionId ? {
      phoneticStability: Math.max(0, (input.failedCard.phoneticStability || 0) * chainPropagation.precedingPhoneticMultiplier ** failureSeverity),
    } : null,
    
    followingUpdate: input.followingTransitionId ? {
      phoneticStability: Math.max(0, (input.failedCard.phoneticStability || 0) * chainPropagation.followingAllMultiplier ** failureSeverity),
      semanticStability: Math.max(0, (input.failedCard.semanticStability || 0) * chainPropagation.followingAllMultiplier ** failureSeverity),
      positionalStability: Math.max(0, (input.failedCard.positionalStability || 0) * chainPropagation.followingAllMultiplier ** failureSeverity),
      recognitionStability: Math.max(0, (input.failedCard.recognitionStability || 0) * chainPropagation.followingAllMultiplier ** failureSeverity),
    } : null,
    
    wrongAlternateUpdate: input.wrongAlternateTransitionId ? {
      phoneticStability: (input.failedCard.phoneticStability || 0) * chainPropagation.wrongAlternateAllMultiplier ** failureSeverity,
      semanticStability: (input.failedCard.semanticStability || 0) * chainPropagation.wrongAlternateAllMultiplier ** failureSeverity,
      positionalStability: (input.failedCard.positionalStability || 0) * chainPropagation.wrongAlternateAllMultiplier ** failureSeverity,
      recognitionStability: (input.failedCard.recognitionStability || 0) * chainPropagation.wrongAlternateAllMultiplier ** failureSeverity,
    } : null,
  };
}

/**
 * Compute next review intervals for all four ratings (for UI preview)
 */
export function computeIntervals(card: CardState, params: FSRSParameters = FSRS_DEFAULTS): Record<Rating, number> {
  const intervals: Record<Rating, number> = {
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  };
  
  (['again', 'hard', 'good', 'easy'] as Rating[]).forEach(rating => {
    const scheduled = scheduleReview(card, rating, params);
    intervals[rating] = scheduled.interval;
  });
  
  return intervals;
}

/**
 * Create a review log entry
 */
export function createReviewLog(
  cardId: string,
  card: CardState,
  rating: Rating,
  scheduled: ScheduledCard,
  timeTakenMs: number
): ReviewLog {
  return {
    id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    cardId,
    rating,
    reviewedAt: new Date(),
    timeTakenMs,
    wasCorrect: rating !== 'again',
    stateBefore: { ...card },
    stateAfter: { ...scheduled },
  };
}

/**
 * Estimate retention for a card at a future date
 */
export function estimateRetention(card: CardState, futureDate: Date, params: FSRSParameters = FSRS_DEFAULTS): number {
  const daysUntil = (futureDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntil <= 0) return card.retrievability;
  
  return Math.exp(-daysUntil / Math.max(card.stability, 0.001));
}

/**
 * Gatekeeper Rule: evaluates whether new memorization should be locked
 * based on recent review mastery falling below threshold
 */
export function checkGatekeeper(
  recentCards: CardState[],
  config: GatekeeperConfig = GATEKEEPER_DEFAULTS
): GatekeeperState {
  if (!config.enabled) {
    return { locked: false, currentMastery: 1, threshold: config.threshold, deficitCards: 0, message: '' };
  }

  const now = new Date();
  const lookbackMs = config.lookbackDays * 24 * 60 * 60 * 1000;
  const eligible = recentCards.filter(c =>
    c.lastReviewedAt && (now.getTime() - c.lastReviewedAt.getTime()) <= lookbackMs &&
    c.state !== 'new'
  );

  if (eligible.length < config.minReviewCount) {
    return { locked: false, currentMastery: 1, threshold: config.threshold, deficitCards: 0, message: '' };
  }

  const avgMastery = eligible.reduce((sum, c) => sum + c.retrievability, 0) / eligible.length;
  const deficitCards = eligible.filter(c => c.retrievability < config.threshold).length;
  const locked = avgMastery < config.threshold;

  return {
    locked,
    currentMastery: Math.round(avgMastery * 1000) / 1000,
    threshold: config.threshold,
    deficitCards,
    message: locked
      ? `نسبة إتقانك في المراجعة الأخيرة ${Math.round(avgMastery * 100)}% أقل من ${Math.round(config.threshold * 100)}% المعتمدة. وفقاً للمنهجية الأصيلة: «لا يُؤخذ الجديد حتى يثبت القديم». يرجى التركيز على المراجعة اليوم لفك القفل.`
      : '',
  };
}

/**
 * Get optimal review order for a set of cards (FSRS-C aware)
 * Priority: overdue → due today → new → mutashabihat paired → recovery → upcoming assessment
 */
export function prioritizeQueue(cards: CardState[]): CardState[] {
  const now = new Date();
  
  return [...cards].sort((a, b) => {
    // Overdue first
    const aOverdue = a.dueAt < now;
    const bOverdue = b.dueAt < now;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    
    // Due today
    const aDueToday = a.dueAt <= new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const bDueToday = b.dueAt <= new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (aDueToday !== bDueToday) return aDueToday ? -1 : 1;
    
    // New cards before review
    if (a.state === 'new' && b.state !== 'new') return -1;
    if (b.state === 'new' && a.state !== 'new') return 1;
    
    // Lower stability first (harder cards)
    return a.stability - b.stability;
  });
}