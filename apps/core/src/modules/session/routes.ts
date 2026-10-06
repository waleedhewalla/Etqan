import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, count, sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { sessions, sessionItems, studentCards, reviewLogs } from '../../db/schema';

const startSessionSchema = z.object({
  mode: z.enum(['read', 'first-letter', 'blanks', 'hidden', 'type-it', 'verse-between', 'order-scramble']).default('hidden'),
  cardIds: z.array(z.string().uuid()).min(1).max(100),
});

const rateItemSchema = z.object({
  sessionItemId: z.string().uuid(),
  selfRating: z.enum(['again', 'hard', 'good', 'easy']),
  timeTakenMs: z.number().int().min(0).optional(),
});

export async function sessionRoutes(app: FastifyInstance) {
  const db = getDb();

  // POST /v1/sessions — Start a new memorization session
  app.post('/sessions', {
    schema: { body: startSessionSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { mode, cardIds } = request.body as z.infer<typeof startSessionSchema>;

    const [session] = await db.insert(sessions).values({
      studentId: userId,
      mode,
      status: 'active',
    }).returning();

    const items = cardIds.map((cardId, i) => ({
      sessionId: session.id,
      ayahRef: '', // will be filled from card lookup
      mode,
      status: 'pending' as const,
      sortOrder: i,
    }));

    // Look up ayah refs from cards
    for (let i = 0; i < cardIds.length; i++) {
      const [card] = await db.select({ ayahRef: studentCards.ayahRef })
        .from(studentCards)
        .where(and(
          eq(studentCards.id, cardIds[i]),
          eq(studentCards.studentId, userId),
        ))
        .limit(1);

      if (card) {
        items[i].ayahRef = card.ayahRef;
        if (cardIds[i]) {
          (items[i] as any).transitionId = undefined;
        }
      }
    }

    const validItems = items.filter(it => it.ayahRef !== '');
    if (validItems.length > 0) {
      await db.insert(sessionItems).values(validItems);
    }

    await db.update(sessions)
      .set({ totalItems: validItems.length })
      .where(eq(sessions.id, session.id));

    const insertedItems = await db.select()
      .from(sessionItems)
      .where(eq(sessionItems.sessionId, session.id));

    return { session: { ...session, totalItems: validItems.length }, items: insertedItems };
  });

  // GET /v1/sessions/:id — Get session with items
  app.get('/sessions/:id', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };

    const [session] = await db.select()
      .from(sessions)
      .where(and(
        eq(sessions.id, id),
        eq(sessions.studentId, userId),
      ))
      .limit(1);

    if (!session) {
      return request.server.httpErrors.notFound('Session not found');
    }

    const items = await db.select()
      .from(sessionItems)
      .where(eq(sessionItems.sessionId, id));

    return { session, items };
  });

  // POST /v1/sessions/:id/rate — Rate a single item within a session
  app.post('/sessions/:id/rate', {
    schema: { body: rateItemSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { id: sessionId } = request.params as { id: string };
    const { sessionItemId, selfRating, timeTakenMs } = request.body as z.infer<typeof rateItemSchema>;

    // Verify session ownership
    const [session] = await db.select()
      .from(sessions)
      .where(and(
        eq(sessions.id, sessionId),
        eq(sessions.studentId, userId),
        eq(sessions.status, 'active'),
      ))
      .limit(1);

    if (!session) {
      return request.server.httpErrors.notFound('Active session not found');
    }

    // Update session item
    await db.update(sessionItems)
      .set({
        status: 'answered',
        selfRating,
        timeTakenMs: timeTakenMs ?? null,
      })
      .where(and(
        eq(sessionItems.id, sessionItemId),
        eq(sessionItems.sessionId, sessionId),
      ));

    // Update correct count
    if (selfRating !== 'again') {
      await db.update(sessions)
        .set({ correctItems: sql`${sessions.correctItems} + 1` })
        .where(eq(sessions.id, sessionId));
    }

    return { success: true };
  });

  // POST /v1/sessions/:id/complete — Complete a session
  app.post('/sessions/:id/complete', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };

    const [session] = await db.select()
      .from(sessions)
      .where(and(
        eq(sessions.id, id),
        eq(sessions.studentId, userId),
        eq(sessions.status, 'active'),
      ))
      .limit(1);

    if (!session) {
      return request.server.httpErrors.notFound('Active session not found');
    }

    const now = new Date();
    const durationMs = now.getTime() - new Date(session.startedAt).getTime();

    // Count answered and skipped
    const [answeredResult] = await db.select({ count: count() })
      .from(sessionItems)
      .where(and(
        eq(sessionItems.sessionId, id),
        eq(sessionItems.status, 'answered'),
      ));

    const [skippedResult] = await db.select({ count: count() })
      .from(sessionItems)
      .where(and(
        eq(sessionItems.sessionId, id),
        eq(sessionItems.status, 'skipped'),
      ));

    await db.update(sessions)
      .set({
        status: 'completed',
        completedAt: now,
        totalDurationMs: durationMs,
        skippedItems: skippedResult?.count ?? 0,
      })
      .where(eq(sessions.id, id));

    return {
      sessionId: id,
      status: 'completed',
      durationMs,
      totalItems: session.totalItems,
      correctItems: answeredResult?.count ?? 0,
      skippedItems: skippedResult?.count ?? 0,
    };
  });

  // POST /v1/sessions/:id/pause — Pause a session
  app.post('/sessions/:id/pause', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };

    await db.update(sessions)
      .set({ status: 'paused', pausedAt: new Date() })
      .where(and(
        eq(sessions.id, id),
        eq(sessions.studentId, userId),
        eq(sessions.status, 'active'),
      ));

    return { success: true };
  });

  // POST /v1/sessions/:id/resume — Resume a paused session
  app.post('/sessions/:id/resume', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };

    await db.update(sessions)
      .set({ status: 'active', pausedAt: null })
      .where(and(
        eq(sessions.id, id),
        eq(sessions.studentId, userId),
        eq(sessions.status, 'paused'),
      ));

    return { success: true };
  });
}
