import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db';
import { tenants } from '../../db/schema';
import { ADMIN_ROLES } from '../../lib/access';
import { getAsrProvider } from '../../lib/asr';
import { auditLog } from '../audit/service';

export async function voiceProxyRoutes(app: FastifyInstance) {
  const db = getDb();

  async function institutionEnabled(tenantId?: string) {
    if (!tenantId) return false;
    const [tenant] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return tenant?.settings?.aiChecking === true;
  }

  // GET /v1/voice/status — is AI recitation checking available, and switched on for this institution?
  app.get('/voice/status', { preHandler: [app.authenticate] }, async (request) => {
    const provider = getAsrProvider();
    return {
      available: Boolean(provider),
      provider: provider?.name ?? null,
      enabled: Boolean(provider) && await institutionEnabled(request.user.facultyId),
    };
  });

  // PUT /v1/voice/institution — an administrator switches AI checking on or off for the institution
  const switchSchema = z.object({ enabled: z.boolean() });
  app.put('/voice/institution', {
    schema: { body: switchSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const user = request.user;
    if (!(ADMIN_ROLES as readonly string[]).includes(user.role) || !user.facultyId) {
      return request.server.httpErrors.forbidden('Administrators only');
    }
    const { enabled } = request.body as z.infer<typeof switchSchema>;

    const [tenant] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, user.facultyId)).limit(1);
    if (!tenant) return request.server.httpErrors.notFound('Institution not found');
    await db.update(tenants).set({ settings: { ...tenant.settings, aiChecking: enabled } }).where(eq(tenants.id, user.facultyId));

    await auditLog({
      actorId: user.sub, actorRole: user.role, tenantId: user.facultyId, action: enabled ? 'ai_checking.enable' : 'ai_checking.disable',
      targetType: 'tenant', targetId: user.facultyId, ip: request.ip,
    });
    return { enabled };
  });
}
