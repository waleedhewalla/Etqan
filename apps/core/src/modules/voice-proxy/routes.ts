import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db';
import { tenants } from '../../db/schema';
import { ADMIN_ROLES } from '../../lib/access';
import { getAsrProvider } from '../../lib/asr';
import { ItqanError } from '../../lib/errors';
import { planIncludes } from '../../lib/plan';
import { auditLog } from '../audit/service';

export async function voiceProxyRoutes(app: FastifyInstance) {
  const db = getDb();

  async function institution(tenantId?: string) {
    if (!tenantId) return null;
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return tenant ?? null;
  }

  // GET /v1/voice/status — is AI recitation checking available, and switched on for this institution?
  app.get('/voice/status', { preHandler: [app.authenticate] }, async (request) => {
    const provider = getAsrProvider();
    const tenant = await institution(request.user.facultyId);
    const included = tenant ? planIncludes(tenant, 'ai_checking') : false;
    return {
      available: Boolean(provider),
      provider: provider?.name ?? null,
      /** Whether the institution's plan includes AI checking. */
      included,
      enabled: Boolean(provider) && included && tenant?.settings?.aiChecking === true,
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

    const tenant = await institution(user.facultyId);
    if (!tenant) return request.server.httpErrors.notFound('Institution not found');
    if (enabled && !planIncludes(tenant, 'ai_checking')) {
      throw new ItqanError('AI checking is not included in this institution\'s plan', 'PLAN_FEATURE_NOT_INCLUDED', 403, { feature: 'ai_checking' });
    }
    await db.update(tenants).set({ settings: { ...tenant.settings, aiChecking: enabled } }).where(eq(tenants.id, user.facultyId));

    await auditLog({
      actorId: user.sub, actorRole: user.role, tenantId: user.facultyId, action: enabled ? 'ai_checking.enable' : 'ai_checking.disable',
      targetType: 'tenant', targetId: user.facultyId, ip: request.ip,
    });
    return { enabled };
  });
}
