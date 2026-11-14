import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, isNull, desc, count, lt } from 'drizzle-orm';
import { getDb } from '../../db';
import { notifications, users } from '../../db/schema';
import { isStaff } from '../../lib/access';

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  unread: z.enum(['true', 'false']).optional(),
  /** Older than this time (the `sentAt` of the last one already shown). */
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

const sendNotificationSchema = z.object({
  userId: z.string().uuid(),
  channel: z.enum(['in_app', 'whatsapp', 'email', 'push']).default('in_app'),
  titleAr: z.string(),
  bodyAr: z.string(),
  data: z.record(z.unknown()).optional(),
});

export async function notificationRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /v1/notifications — the user's notifications, newest first; `before` pages back through older ones
  app.get('/notifications', {
    schema: { querystring: listQuery },
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { unread, before, limit } = request.query as z.infer<typeof listQuery>;
    return db.select()
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        unread === 'true' ? isNull(notifications.readAt) : undefined,
        before ? lt(notifications.sentAt, new Date(before)) : undefined,
      ))
      .orderBy(desc(notifications.sentAt))
      .limit(limit);
  });

  // GET /v1/notifications/count — how many are unread: cheap enough to ask every minute for the bell
  app.get('/notifications/count', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const [row] = await db.select({ n: count() }).from(notifications)
      .where(and(eq(notifications.userId, request.user.sub), isNull(notifications.readAt)));
    return { unread: row?.n ?? 0 };
  });

  // POST /v1/notifications/read/:id — Mark as read
  app.post('/notifications/read/:id', {
    schema: { params: idParam },
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as z.infer<typeof idParam>;

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

    // Staff may notify people in their own institution only.
    const [target] = await db.select({ tenantId: users.tenantId }).from(users)
      .where(eq(users.id, body.userId)).limit(1);
    if (!isStaff(request.user) || !target || target.tenantId !== request.user.facultyId) {
      return request.server.httpErrors.forbidden('Not allowed to notify this user');
    }

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
