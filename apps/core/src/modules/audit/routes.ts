import { FastifyInstance } from 'fastify';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { getDb } from '../../db';
import { auditLogs } from '../../db/schema';

export async function auditRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /v1/audit — Query audit logs (admin only)
  app.get('/audit', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const role = request.user.role;
    if (!['operator', 'superadmin', 'dean'].includes(role)) {
      return request.server.httpErrors.forbidden('Admin access required');
    }

    const { userId, action, from, to, limit: limitStr } = request.query as {
      userId?: string; action?: string; from?: string; to?: string; limit?: string;
    };
    const limit = Math.min(parseInt(limitStr || '100', 10), 500);

    const conditions = [];
    if (userId) conditions.push(eq(auditLogs.userId, userId));
    if (action) conditions.push(eq(auditLogs.action, action));
    if (from) conditions.push(gte(auditLogs.createdAt, new Date(from)));
    if (to) conditions.push(lte(auditLogs.createdAt, new Date(to)));

    const query = conditions.length > 0
      ? db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.createdAt)).limit(limit)
      : db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);

    return query;
  });
}
