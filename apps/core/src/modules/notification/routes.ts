import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { getDb } from '../../db';
import { notifications } from '../../db/schema';

const sendNotificationSchema = z.object({
  userId: z.string().uuid(),
  channel: z.enum(['in_app', 'whatsapp', 'email', 'push']).default('in_app'),
  titleAr: z.string(),
  bodyAr: z.string(),
  data: z.record(z.unknown()).optional(),
});

export async function notificationRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /v1/notifications — Get user's notifications
  app.get('/notifications', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { unread } = request.query as { unread?: string };

    if (unread === 'true') {
      return db.select()
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
        .orderBy(desc(notifications.sentAt))
        .limit(50);
    }

    return db.select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.sentAt))
      .limit(50);
  });

  // POST /v1/notifications/read/:id — Mark as read
  app.post('/notifications/read/:id', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };

    await db.update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));

    return { success: true };
  });

  // POST /v1/notifications/read-all — Mark all as read
  app.post('/notifications/read-all', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;

    await db.update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

    return { success: true };
  });

  // POST /v1/notifications — Send notification (admin/system)
  app.post('/notifications', {
    schema: { body: sendNotificationSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const body = request.body as z.infer<typeof sendNotificationSchema>;

    const [notification] = await db.insert(notifications).values({
      userId: body.userId,
      channel: body.channel,
      titleAr: body.titleAr,
      bodyAr: body.bodyAr,
      data: body.data,
    }).returning();

    return notification;
  });
}
