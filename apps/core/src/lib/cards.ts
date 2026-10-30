import { eq } from 'drizzle-orm';
import { createReviewLog, scheduleReview } from '@itqan/fsrs';
import type { CardState, Rating } from '@itqan/types';
import type { Database } from '../db';
import { reviewLogs, streakFreezes, streaks, studentCards } from '../db/schema';
import { localDate } from './dates';
import { recordActivity } from './streak';

export function cardRowToState(row: typeof studentCards.$inferSelect): CardState {
  return {
    difficulty: row.difficulty,
    stability: row.stability,
    retrievability: row.retrievability,
    // Cards with no due date yet are due immediately.
    dueAt: row.dueAt ? new Date(row.dueAt) : new Date(),
    lastReviewedAt: row.lastReviewedAt ? new Date(row.lastReviewedAt) : null,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as CardState['state'],
    phoneticStability: row.phoneticStability,
    semanticStability: row.semanticStability,
    positionalStability: row.positionalStability,
    recognitionStability: row.recognitionStability,
    transitionId: row.transitionId ?? null,
    firstSeenAt: new Date(row.createdAt),
  };
}

/** Applies today's activity to the student's streak and returns the new state. */
export async function recordStudentActivity(db: Database, studentId: string, at: Date = new Date()) {
  const today = localDate(at);
  const [row] = await db.select().from(streaks).where(eq(streaks.studentId, studentId)).limit(1);
  const { state, frozenDates } = recordActivity(row ?? {
    currentStreak: 0, longestStreak: 0, freezesRemaining: 2, lastActiveDate: null,
  }, today);
  if (row && row.lastActiveDate === today) return row;

  const values = { ...state, updatedAt: new Date() };
  const [saved] = await db.insert(streaks)
    .values({ studentId, ...values })
    .onConflictDoUpdate({ target: streaks.studentId, set: values })
    .returning();
  if (frozenDates.length) {
    await db.insert(streakFreezes).values(frozenDates.map((frozenDate) => ({ studentId, frozenDate })));
  }
  return saved;
}

/** Reschedules a card for a rating and writes the review log. The streak is the caller's concern. */
export async function applyRating(
  db: Database, card: typeof studentCards.$inferSelect, rating: Rating, timeTakenMs = 0,
  /** When the review happened (offline reviews are applied later) and a client id that makes the write idempotent. */
  options: { at?: Date; clientId?: string } = {},
) {
  const at = options.at ?? new Date();
  const cardState = cardRowToState(card);
  const scheduled = scheduleReview(cardState, rating, undefined, at);
  const log = createReviewLog(card.id, cardState, rating, scheduled, timeTakenMs, at);

  await db.update(studentCards)
    .set({
      state: scheduled.state,
      difficulty: scheduled.difficulty,
      stability: scheduled.stability,
      retrievability: scheduled.retrievability,
      phoneticStability: scheduled.phoneticStability ?? card.phoneticStability,
      semanticStability: scheduled.semanticStability ?? card.semanticStability,
      positionalStability: scheduled.positionalStability ?? card.positionalStability,
      recognitionStability: scheduled.recognitionStability ?? card.recognitionStability,
      dueAt: scheduled.dueAt ? new Date(scheduled.dueAt as unknown as string) : null,
      lastReviewedAt: at,
      reps: scheduled.reps,
      lapses: scheduled.lapses,
      updatedAt: new Date(),
    })
    .where(eq(studentCards.id, card.id));

  await db.insert(reviewLogs).values({
    cardId: card.id,
    rating: rating as typeof reviewLogs.$inferInsert.rating,
    reviewedAt: at,
    clientId: options.clientId ?? null,
    timeTakenMs,
    wasCorrect: rating !== 'again',
    stateBefore: cardState as unknown as Record<string, unknown>,
    stateAfter: scheduled as unknown as Record<string, unknown>,
  });

  return { scheduled, log };
}
