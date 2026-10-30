import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, lte, isNull, asc, desc, sql, count } from 'drizzle-orm';
import { getDb } from '../../db';
import { studentCards, reviewLogs, streaks, assignments } from '../../db/schema';
import { localDate, startOfLocalDay } from '../../lib/dates';
import { applyRating, cardRowToState, recordStudentActivity } from '../../lib/cards';
import { awardBadges } from '../../lib/badges';
import {
  computeIntervals,
  checkGatekeeper,
  prioritizeQueue,
  GATEKEEPER_DEFAULTS,
  INITIAL_CARD_STATE,
} from '@itqan/fsrs';
import type { Rating, QueueItem } from '@itqan/types';

const rateSchema = z.object({
  cardId: z.string().uuid(),
  rating: z.enum(['again', 'hard', 'good', 'easy']),
  timeTakenMs: z.number().int().min(0).optional(),
});

const rateBatchSchema = z.object({
  reviews: z.array(z.object({
    /** Made up on the device when the review was done; makes sending it twice harmless. */
    clientId: z.string().min(8).max(64),
    cardId: z.string().uuid(),
    rating: z.enum(['again', 'hard', 'good', 'easy']),
    timeTakenMs: z.number().int().min(0).max(3_600_000).optional(),
    reviewedAt: z.string().datetime(),
  })).min(1).max(200),
});

/** Reviews done offline are accepted for this long after they happened. */
const OFFLINE_MAX_AGE_MS = 14 * 86_400_000;
/** A device clock may run a little fast. */
const CLOCK_SKEW_MS = 5 * 60_000;

const queueQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

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
    const todayStart = startOfLocalDay(localDate(targetDate));

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
      date: localDate(targetDate),
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

    const { scheduled, log } = await applyRating(db, card, rating as Rating, timeTakenMs ?? 0);

    // Update streak (one missed day is covered by a freeze when one is left)
    const streak = await recordStudentActivity(db, userId);

    const newBadges = await awardBadges(db, userId);

    // Preview next intervals
    const intervals = computeIntervals(scheduled);

    return {
      card: { id: cardId, ...scheduled },
      log,
      intervals,
      streak,
      newBadges,
    };
  });

  // POST /v1/scheduler/rate-batch — reviews done offline, sent when the device is back online.
  // Each is applied as of when it happened. Sending the same one twice is harmless (clientId).
  app.post('/scheduler/rate-batch', {
    schema: { body: rateBatchSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { reviews } = request.body as z.infer<typeof rateBatchSchema>;
    const now = Date.now();
    const results: { clientId: string; status: 'applied' | 'duplicate' | 'stale' | 'too_old' | 'invalid_time' | 'not_found' }[] = [];

    // Oldest first, so the card's history is built in the order it happened.
    const ordered = [...reviews].sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt));
    for (const r of ordered) {
      const at = new Date(r.reviewedAt);
      if (at.getTime() > now + CLOCK_SKEW_MS) { results.push({ clientId: r.clientId, status: 'invalid_time' }); continue; }
      if (at.getTime() < now - OFFLINE_MAX_AGE_MS) { results.push({ clientId: r.clientId, status: 'too_old' }); continue; }

      const [card] = await db.select().from(studentCards)
        .where(and(eq(studentCards.id, r.cardId), eq(studentCards.studentId, userId))).limit(1);
      if (!card) { results.push({ clientId: r.clientId, status: 'not_found' }); continue; }

      const [already] = await db.select({ id: reviewLogs.id }).from(reviewLogs)
        .where(and(eq(reviewLogs.cardId, card.id), eq(reviewLogs.clientId, r.clientId))).limit(1);
      if (already) { results.push({ clientId: r.clientId, status: 'duplicate' }); continue; }

      // The card was reviewed after this one happened (on another device, or sooner online): that review is newer, keep it.
      if (card.lastReviewedAt && card.lastReviewedAt.getTime() >= at.getTime()) {
        results.push({ clientId: r.clientId, status: 'stale' });
        continue;
      }

      try {
        await db.transaction(async (tx) => {
          await applyRating(tx as unknown as typeof db, card, r.rating as Rating, r.timeTakenMs ?? 0, { at, clientId: r.clientId });
          await recordStudentActivity(tx as unknown as typeof db, userId, at);
        });
        results.push({ clientId: r.clientId, status: 'applied' });
      } catch (err) {
        // Two requests racing with the same clientId: the unique index lets only one through.
        if ((err as { code?: string }).code === '23505') results.push({ clientId: r.clientId, status: 'duplicate' });
        else throw err;
      }
    }

    const applied = results.filter((x) => x.status === 'applied').length;
    const [streak] = await db.select().from(streaks).where(eq(streaks.studentId, userId)).limit(1);
    return { results, applied, streak: streak ?? null, newBadges: applied ? await awardBadges(db, userId) : [] };
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
