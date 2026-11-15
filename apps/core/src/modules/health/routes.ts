import { FastifyInstance } from 'fastify';
import { getDb } from '../../db';
import { migrationStatus } from '../../lib/migrations';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    const migrations = await migrationStatus(getDb());
    return reply.send({
      // Still answers 200 (the process is up), but says "degraded" when the database lacks migrations the code needs.
      status: migrations.pending ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      migrations,
    });
  });
}
