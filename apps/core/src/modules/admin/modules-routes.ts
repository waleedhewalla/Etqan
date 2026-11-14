/**
 * The product's modules, configured by the institution's admin: each module can be switched off (the core ones
 * cannot), and some have settings. See lib/modules.ts for what each does and how it is stored.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db';
import { tenants } from '../../db/schema';
import { getAsrProvider } from '../../lib/asr';
import { ItqanError } from '../../lib/errors';
import type { TokenPayload } from '../../lib/jwt';
import { isLiveConfigured } from '../../lib/live';
import { MODULES, checkConfig, forgetModules, moduleDef, resolveModules, type ModuleDef } from '../../lib/modules';
import { planIncludes } from '../../lib/plan';
import { auditLog } from '../audit/service';

const MANAGER_ROLES: readonly string[] = ['dean', 'operator', 'superadmin'];
const keyParam = z.object({ key: z.string().min(1).max(40) });
const changeSchema = z.object({
  enabled: z.boolean().optional(),
  /** New values for some of the module's settings. */
  config: z.record(z.union([z.number(), z.boolean()])).optional(),
  /** Settings to put back to the default. */
  reset: z.array(z.string().max(40)).max(20).optional(),
}).refine((b) => b.enabled !== undefined || (b.config && Object.keys(b.config).length > 0) || (b.reset && b.reset.length > 0), 'Nothing to change');

type Tenant = typeof tenants.$inferSelect;
type Stored = { modules?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>; aiChecking?: boolean } & Record<string, unknown>;

export async function adminModulesRoutes(app: FastifyInstance) {
  const db = getDb();

  const tenantOf = (user: TokenPayload) => (MANAGER_ROLES.includes(user.role) && user.facultyId ? user.facultyId : null);
  const load = async (tenantId: string) => (await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];

  /** Whether what a module needs from the deployment and the plan is there; null when it needs nothing. */
  const availability = (def: ModuleDef, tenant: Tenant): { ok: boolean; messageAr: string } | null => {
    if (def.key === 'live' && !isLiveConfigured()) return { ok: false, messageAr: 'خادم الصوت والصورة غير مُعدّ على هذا الخادم بعد (انظري دليل النشر). لن تعمل الدروس المباشرة حتى يُعدّه مسؤول النظام.' };
    if (def.key === 'ai_checking') {
      if (!planIncludes(tenant, 'ai_checking')) return { ok: false, messageAr: 'الفحص الآلي غير مشمول في ترخيص مؤسستكم.' };
      if (!getAsrProvider()) return { ok: false, messageAr: 'خدمة التفريغ الصوتي غير مُعدّة على هذا الخادم بعد.' };
    }
    return null;
  };

  const view = (tenant: Tenant) => {
    const state = resolveModules(tenant.settings);
    const stored = ((tenant.settings ?? {}) as Stored).modules ?? {};
    return MODULES.map((def) => {
      const s = state[def.key];
      const mine = stored[def.key]?.config ?? {};
      return {
        key: def.key, labelAr: def.labelAr, descriptionAr: def.descriptionAr, core: Boolean(def.core), dependsOn: def.dependsOn ?? [],
        enabled: s.enabled, requested: s.requested, blockedBy: s.blockedBy,
        availability: availability(def, tenant),
        settings: def.settings.map((d) => ({
          key: d.key, labelAr: d.labelAr, helpAr: d.helpAr ?? null, kind: d.kind, min: d.min ?? null, max: d.max ?? null, unitAr: d.unitAr ?? null,
          value: s.config[d.key], default: d.fallback(), custom: s.config[d.key] !== d.fallback() && mine[d.key] !== undefined,
        })),
      };
    });
  };

  // GET /v1/admin/modules — every module, whether it is on, and its settings
  app.get('/admin/modules', { preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return request.server.httpErrors.forbidden('Institution managers only');
    const tenant = await load(tenantId);
    if (!tenant) return request.server.httpErrors.notFound('Institution not found');
    return { modules: view(tenant) };
  });

  // PUT /v1/admin/modules/:key — switch a module on or off, change its settings, or put settings back to the defaults
  app.put('/admin/modules/:key', { schema: { params: keyParam, body: changeSchema }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return request.server.httpErrors.forbidden('Institution managers only');
    const { key } = request.params as z.infer<typeof keyParam>;
    const body = request.body as z.infer<typeof changeSchema>;
    const def = moduleDef(key);
    if (!def) return request.server.httpErrors.notFound('Module not found');
    if (def.core && body.enabled === false) return request.server.httpErrors.badRequest('This module is part of the product and cannot be turned off');
    const tenant = await load(tenantId);
    if (!tenant) return request.server.httpErrors.notFound('Institution not found');

    const settings: Stored = { ...(tenant.settings ?? {}) };
    const modules = { ...(settings.modules ?? {}) };
    const mine = { ...(modules[key] ?? {}) };

    if (body.enabled !== undefined) {
      if (def.key === 'ai_checking') {
        if (body.enabled && !planIncludes(tenant, 'ai_checking')) {
          throw new ItqanError('AI checking is not included in this institution\'s plan', 'PLAN_FEATURE_NOT_INCLUDED', 403, { feature: 'ai_checking' });
        }
        settings.aiChecking = body.enabled;
      } else if (!def.core) {
        mine.enabled = body.enabled;
      }
    }
    const config = { ...(mine.config ?? {}) };
    if (body.config) {
      const checked = checkConfig(def, body.config);
      if (!checked.ok) return request.server.httpErrors.badRequest(checked.error);
      Object.assign(config, checked.config);
    }
    for (const reset of body.reset ?? []) {
      if (!def.settings.some((d) => d.key === reset)) return request.server.httpErrors.badRequest(`Unknown setting: ${reset}`);
      delete config[reset];
    }
    modules[key] = { ...mine, ...(Object.keys(config).length ? { config } : { config: undefined }) };
    if (modules[key].config === undefined) delete modules[key].config;
    settings.modules = modules;

    await db.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
    forgetModules(tenantId);
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, tenantId, action: 'module.updated', targetType: 'tenant', targetId: tenantId,
      metadata: { module: key, enabled: body.enabled, settings: Object.keys(body.config ?? {}), reset: body.reset },
    });
    return { modules: view({ ...tenant, settings }) };
  });
}
