import { describe, expect, it } from 'vitest';
import type { CardState } from '@itqan/types';
import { computeIntervals, scheduleReview } from './scheduler';
import { FSRS_DEFAULTS, INITIAL_CARD_STATE } from './constants';

function newCard(): CardState {
  return {
    ...INITIAL_CARD_STATE,
    dueAt: new Date(),
    lastReviewedAt: null,
    firstSeenAt: new Date(),
  } as CardState;
}

describe('scheduleReview', () => {
  it('counts the review and records when it happened', () => {
    const card = newCard();
    const next = scheduleReview(card, 'good');
    expect(next.reps).toBe(1);
    expect(next.lastReviewedAt).toBeInstanceOf(Date);
    expect(card.reps).toBe(0);
  });

  it('counts a lapse only on "again"', () => {
    expect(scheduleReview(newCard(), 'again').lapses).toBe(1);
    expect(scheduleReview(newCard(), 'good').lapses).toBe(0);
  });

  it('moves a new card to learning or review according to the rating', () => {
    expect(scheduleReview(newCard(), 'again').state).toBe('learning');
    expect(scheduleReview(newCard(), 'good').state).toBe('review');
  });

  it('schedules the next review in the future', () => {
    const next = scheduleReview(newCard(), 'good');
    expect(next.interval).toBeGreaterThan(0);
    expect(next.nextDueAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('computeIntervals', () => {
  it('never gives an easier rating a shorter interval', () => {
    const i = computeIntervals(newCard(), { ...FSRS_DEFAULTS, enableFuzz: false });
    expect(i.again).toBeLessThanOrEqual(i.hard);
    expect(i.hard).toBeLessThanOrEqual(i.good);
    expect(i.good).toBeLessThanOrEqual(i.easy);
  });
});
