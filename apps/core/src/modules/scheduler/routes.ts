import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, lte, isNull, asc, desc, sql, count } from 'drizzle-orm';
import { getDb } from '../../db';
import { studentCards, reviewLogs, streaks, assignments } from '../../db/schema';
import {
  scheduleReview,
  computeIntervals,
  createReviewLog,
  checkGatekeeper,
  prioritizeQueue,
  GATEKEEPER_DEFAULTS,
  INITIAL_CARD_STATE,
} from '@itqan/fsrs';
import type { CardState, Rating, QueueItem } from '@itqan/types';

const rateSchema = z.object({
  cardId: z.string().uuid(),
  rating: z.enum(['again', 'hard', 'good', 'easy']),
  timeTakenMs: z.number().int().min(0).optional(),
});

const queueQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function cardRowToState(row: typeof studentCards.$inferSelect): CardState {
  return {
    difficulty: row.difficulty,
    stability: row.stability,
    retrievability: row.retrievability,
    dueAt: row.dueAt ? new Date(row.dueAt) : undefined,
    lastReviewedAt: row.lastReviewedAt ? new Date(row.lastReviewedAt) : undefined,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as CardState['state'],
    phoneticStability: row.phoneticStability,
    semanticStability: row.semanticStability,
    positionalStability: row.positionalStability,
    recognitionStability: row.recognitionStability,
    transitionId: row.transitionId ?? undefined,
  };
}

export async function schedulerRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /v1/scheduler/queue — Daily review queue with Sabaq/Sabqi/Manzil structure
  app.get('/scheduler/queue', {
    schema: { querystring: queueQuerySchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { date: dateStr, limit } = request.query as z.infer<typeof queueQuerySchema>;
    const targetDate = dateStr ? new Date(dateStr) : new Date();

    // 1. Get all cards due today or overdue
    const dueCards = await db.select()
      .from(studentCards)
      .where(and(
        eq(studentCards.studentId, userId),
        lte(studentCards.dueAt, targetDate),
      ))
      .orderBy(asc(studentCards.dueAt))
      .limit(limit);

    // 2. Get new cards (never reviewed)
    const newCards = await db.select()
      .from(studentCards)
      .where(and(
        eq(studentCards.studentId, userId),
        eq(studentCards.state, 'new'),
        isNull(studentCards.dueAt),
      ))
      .orderBy(asc(studentCards.createdAt))
      .limit(Math.max(0, limit - dueCards.length));

    // 3. Check gatekeeper
    const recentReviewCards = await db.select()
      .from(studentCards)
      .where(and(
        eq(studentCards.studentId, userId),
        eq(studentCards.state, 'review'),
      ))
      .limit(100);

    const gatekeeperState = checkGatekeeper(
      recentReviewCards.map(cardRowToState),
      GATEKEEPER_DEFAULTS,
    );

    // 4. Build structured queue: manzil (overdue) → sabqi (due today) → sabaq (new)
    const now = new Date();
    const todayStart = new Date(targetDate);
    todayStart.setHours(0, 0, 0, 0);

    const manzilItems: QueueItem[] = [];
    const sabqiItems: QueueItem[] = [];
    const sabaqItems: QueueItem[] = [];

    for (const row of dueCards) {
      const card = cardRowToState(row);
      const dueDate = row.dueAt ? new Date(row.dueAt) : now;
      const isOverdue = dueDate < todayStart;

      const item: QueueItem = {
        card: { ...card, id: row.id, studentId: row.studentId, ayahRef: row.ayahRef } as any,
        priority: isOverdue ? 1 : 2,
        reason: isOverdue ? 'manzil' : 'sabqi',
        estimatedMinutes: 0.5,
        rationale: isOverdue
          ? `مراجعة متأخرة — مستحقة منذ ${Math.ceil((now.getTime() - dueDate.getTime()) / 86400000)} أيام`
          : 'مراجعة مجدولة لليوم',
      };

      if (isOverdue) manzilItems.push(item);
      else sabqiItems.push(item);
    }

    if (!gatekeeperState.locked) {
      for (const row of newCards) {
        const card = cardRowToState(row);
        sabaqItems.push({
          card: { ...card, id: row.id, studentId: row.studentId, ayahRef: row.ayahRef } as any,
          priority: 3,
          reason: 'sabaq',
          estimatedMinutes: 1.5,
          rationale: 'حفظ جديد',
        });
      }
    }

    const items = [...manzilItems, ...sabqiItems, ...sabaqItems];

    // 5. Get today's assignments from teacher
    const todayAssignments = await db.select()
      .from(assignments)
      .where(and(
        eq(assignments.studentId, userId),
        isNull(assignments.completedAt),
      ))
      .orderBy(asc(assignments.dueDate))
      .limit(10);

    // 6. Get streak
    const [streakRow] = await db.select()
      .from(streaks)
      .where(eq(streaks.studentId, userId))
      .limit(1);

    return {
      studentId: userId,
      date: targetDate.toISOString().slice(0, 10),
      gatekeeper: gatekeeperState,
      queue: {
        manzil: { count: manzilItems.length, items: manzilItems },
        sabqi: { count: sabqiItems.length, items: sabqiItems },
        sabaq: { count: sabaqItems.length, items: sabaqItems, locked: gatekeeperState.locked },
      },
      totalItems: items.length,
      estimatedMinutes: items.reduce((sum, i) => sum + i.estimatedMinutes, 0),
      streak: streakRow ?? { currentStreak: 0, longestStreak: 0, freezesRemaining: 2 },
      assignments: todayAssignments,
    };
  });

  // POST /v1/scheduler/rate — Rate a card and apply FSRS scheduling
  app.post('/scheduler/rate', {
    schema: { body: rateSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { cardId, rating, timeTakenMs } = request.body as z.infer<typeof rateSchema>;

    const [card] = await db.select()
      .from(studentCards)
      .where(and(
        eq(studentCards.id, cardId),
        eq(studentCards.studentId, userId),
      ))
      .limit(1);

    if (!card) {
      return request.server.httpErrors.notFound('Card not found');
    }

    const cardState = cardRowToState(card);
    const scheduled = scheduleReview(cardState, rating as Rating);
    const log = createReviewLog(cardId, cardState, rating as Rating, scheduled, timeTakenMs ?? 0);

    // Update card
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
        lastReviewedAt: new Date(),
        reps: scheduled.reps,
        lapses: scheduled.lapses,
        updatedAt: new Date(),
      })
      .where(eq(studentCards.id, cardId));

    // Insert review log
    await db.insert(reviewLogs).values({
      cardId,
      rating: rating as typeof reviewLogs.$inferInsert.rating,
      reviewedAt: new Date(),
      timeTakenMs: timeTakenMs ?? 0,
      wasCorrect: rating !== 'again',
      stateBefore: cardState as unknown as Record<string, unknown>,
      stateAfter: scheduled as unknown as Record<string, unknown>,
    });

    // Update streak
    const today = new Date().toISOString().slice(0, 10);
    const [existingStreak] = await db.select()
      .from(streaks)
      .where(eq(streaks.studentId, userId))
      .limit(1);

    if (existingStreak) {
      const lastActive = existingStreak.lastActiveDate;
      if (lastActive !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const isConsecutive = lastActive === yesterday.toISOString().slice(0, 10);

        const newStreak = isConsecutive ? existingStreak.currentStreak + 1 : 1;
        await db.update(streaks)
          .set({
            currentStreak: newStreak,
            longestStreak: Math.max(newStreak, existingStreak.longestStreak),
            lastActiveDate: today,
            updatedAt: new Date(),
          })
          .where(eq(streaks.studentId, userId));
      }
    } else {
      await db.insert(streaks).values({
        studentId: userId,
        currentStreak: 1,
        longestStreak: 1,
        lastActiveDate: today,
      });
    }

    // Preview next intervals
    const intervals = computeIntervals(scheduled);

    return {
      card: { id: cardId, ...scheduled },
      log,
      intervals,
    };
  });

  // GET /v1/scheduler/intervals/:cardId — Preview intervals for all ratings
  app.get('/scheduler/intervals/:cardId', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { cardId } = request.params as { cardId: string };

    const [card] = await db.select()
      .from(studentCards)
      .where(and(
        eq(studentCards.id, cardId),
        eq(studentCards.studentId, userId),
      ))
      .limit(1);

    if (!card) {
      return request.server.httpErrors.notFound('Card not found');
    }

    return computeIntervals(cardRowToState(card));
  });

  // GET /v1/scheduler/gatekeeper — Check gatekeeper status
  app.get('/scheduler/gatekeeper', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;

    const reviewCards = await db.select()
      .from(studentCards)
      .where(and(
        eq(studentCards.studentId, userId),
        eq(studentCards.state, 'review'),
      ))
      .limit(200);

    return checkGatekeeper(
      reviewCards.map(cardRowToState),
      GATEKEEPER_DEFAULTS,
    );
  });

  // GET /v1/scheduler/stats — Student progress stats
  app.get('/scheduler/stats', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;

    const [totalResult] = await db.select({ count: count() })
      .from(studentCards)
      .where(eq(studentCards.studentId, userId));

    const [masteredResult] = await db.select({ count: count() })
      .from(studentCards)
      .where(and(
        eq(studentCards.studentId, userId),
        eq(studentCards.state, 'mastered'),
      ));

    const [reviewResult] = await db.select({ count: count() })
      .from(studentCards)
      .where(and(
        eq(studentCards.studentId, userId),
        eq(studentCards.state, 'review'),
      ));

    const [newResult] = await db.select({ count: count() })
      .from(studentCards)
      .where(and(
        eq(studentCards.studentId, userId),
        eq(studentCards.state, 'new'),
      ));

    const [dueResult] = await db.select({ count: count() })
      .from(studentCards)
      .where(and(
        eq(studentCards.studentId, userId),
        lte(studentCards.dueAt, new Date()),
      ));

    const [streakRow] = await db.select()
      .from(streaks)
      .where(eq(streaks.studentId, userId))
      .limit(1);

    const [todayReviewsResult] = await db.select({ count: count() })
      .from(reviewLogs)
      .innerJoin(studentCards, eq(reviewLogs.cardId, studentCards.id))
      .where(and(
        eq(studentCards.studentId, userId),
        sql`${reviewLogs.reviewedAt}::date = CURRENT_DATE`,
      ));

    return {
      total: totalResult?.count ?? 0,
      mastered: masteredResult?.count ?? 0,
      review: reviewResult?.count ?? 0,
      new: newResult?.count ?? 0,
      dueNow: dueResult?.count ?? 0,
      todayReviews: todayReviewsResult?.count ?? 0,
      streak: streakRow ?? { currentStreak: 0, longestStreak: 0 },
    };
  });
}
