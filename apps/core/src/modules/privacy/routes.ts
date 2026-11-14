/**
 * Data requests. A person can download her data and ask for it to be deleted; a dean can do the same on her behalf (a request that
 * came by email) and decides each request: anonymize (the default, which keeps the grades the institution must keep, without a name)
 * or erase. An approved request waits out a grace period, during which the account is stopped, so a mistake can be undone; then a job
 * removes the data (lib/data-deletion.ts).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../../db';
import { dataRequests, users } from '../../db/schema';
import { config } from '../../config';
import { forgetStopped } from '../../lib/active-users';
import { activeHalaqatLed, buildExport, isErasable } from '../../lib/data-deletion';
import type { TokenPayload } from '../../lib/jwt';
import { auditLog } from '../audit/service';

const MANAGER_ROLES: readonly string[] = ['dean', 'operator', 'superadmin'];
const PLATFORM_ROLES = ['operator', 'superadmin'];
const idParam = z.object({ id: z.string().uuid() });
const onBehalf = z.object({ userId: z.string().uuid(), note: z.string().trim().max(300).optional() });
const approve = z.object({ mode: z.enum(['anonymize', 'erase']).default('anonymize'), note: z.string().trim().max(300).optional() });
const reject = z.object({ reason: z.string().trim().min(3).max(300) });
const listQuery = z.object({ status: z.enum(['open', 'done', 'all']).default('open') });

type Request = typeof dataRequests.$inferSelect;
/** What a person sees of her own request, and a dean of any: never the grace-period bookkeeping. */
const serialize = (r: Request) => ({
  id: r.id, userId: r.userId, subjectName: r.subjectName, subjectRole: r.subjectRole, status: r.status, mode: r.mode, source: r.source,
  requestedAt: r.requestedAt, decidedAt: r.decidedAt, decisionNote: r.decisionNote, scheduledFor: r.scheduledFor, completedAt: r.completedAt,
  error: (r.summary as { error?: string } | null)?.error ?? null,
});

export async function privacyRoutes(app: FastifyInstance) {
  const db = getDb();

  const tenantOf = (user: TokenPayload) => (MANAGER_ROLES.includes(user.role) && user.facultyId ? user.facultyId : null);
  const forbidden = (request: { server: FastifyInstance }) => request.server.httpErrors.forbidden('Institution managers only');
  const canDecide = (actor: TokenPayload, subjectRole: string) => !['dean'].includes(subjectRole) || PLATFORM_ROLES.includes(actor.role);

  const openRequest = async (userId: string) =>
    (await db.select().from(dataRequests).where(and(eq(dataRequests.userId, userId), inArray(dataRequests.status, ['pending', 'scheduled']))).limit(1))[0];

  /** Opens a request for `subject`, or says why it cannot be. */
  const open = async (
    request: { server: FastifyInstance }, subject: typeof users.$inferSelect, source: 'self' | 'admin', by: TokenPayload, note?: string,
  ) => {
    if (PLATFORM_ROLES.includes(subject.role)) return { error: request.server.httpErrors.badRequest('This account belongs to the platform') };
    if (await openRequest(subject.id)) return { error: request.server.httpErrors.conflict('There is already an open request for this account') };
    const [row] = await db.insert(dataRequests).values({
      tenantId: subject.tenantId, userId: subject.id, subjectName: subject.displayNameAr, subjectRole: subject.role, source, requestedBy: by.sub, decisionNote: note ?? null,
    }).returning();
    await auditLog({
      actorId: by.sub, actorRole: by.role, tenantId: subject.tenantId, action: 'data.deletion.requested', targetType: 'data_request', targetId: row.id,
      metadata: { source, role: subject.role },
    });
    return { row };
  };

  // ---- Her own data ----

  // GET /v1/me/export — everything the app keeps about her, as a file
  app.get('/me/export', { preHandler: [app.authenticate] }, async (request, reply) => {
    const data = await buildExport(db, request.user.sub);
    if (!data) return request.server.httpErrors.notFound('Account not found');
    await auditLog({ actorId: request.user.sub, actorRole: request.user.role, action: 'data.exported', targetType: 'user', targetId: request.user.sub, metadata: { by: 'self' } });
    return reply.header('Content-Disposition', 'attachment; filename="itqan-my-data.json"').type('application/json').send(data);
  });

  // GET /v1/me/data-request — her open request, if she has one
  app.get('/me/data-request', { preHandler: [app.authenticate] }, async (request) => {
    const [latest] = await db.select().from(dataRequests).where(eq(dataRequests.userId, request.user.sub)).orderBy(desc(dataRequests.requestedAt)).limit(1);
    return { request: latest && ['pending', 'scheduled', 'rejected'].includes(latest.status) ? serialize(latest) : null, graceDays: config.DATA_DELETION_GRACE_DAYS };
  });

  // POST /v1/me/data-request — she asks for her data to be deleted
  app.post('/me/data-request', { preHandler: [app.authenticate] }, async (request, reply) => {
    const [me] = await db.select().from(users).where(eq(users.id, request.user.sub)).limit(1);
    if (!me) return request.server.httpErrors.notFound('Account not found');
    const made = await open(request, me, 'self', request.user);
    if ('error' in made) return made.error;
    return reply.code(201).send({ request: serialize(made.row), graceDays: config.DATA_DELETION_GRACE_DAYS });
  });

  // DELETE /v1/me/data-request — she withdraws it, while it has not been approved
  app.delete('/me/data-request', { preHandler: [app.authenticate] }, async (request) => {
    const open = await openRequest(request.user.sub);
    if (!open) return request.server.httpErrors.notFound('No open request');
    if (open.status !== 'pending') return request.server.httpErrors.conflict('The request was approved: ask your dean to cancel it');
    await db.update(dataRequests).set({ status: 'cancelled', decidedAt: new Date(), decidedBy: request.user.sub }).where(eq(dataRequests.id, open.id));
    await auditLog({ actorId: request.user.sub, actorRole: request.user.role, tenantId: open.tenantId, action: 'data.deletion.cancelled', targetType: 'data_request', targetId: open.id, metadata: { by: 'self' } });
    return { ok: true };
  });

  // ---- The institution's side ----

  // GET /v1/admin/data-requests
  app.get('/admin/data-requests', { schema: { querystring: listQuery }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const { status } = request.query as z.infer<typeof listQuery>;
    const rows = await db.select().from(dataRequests)
      .where(and(eq(dataRequests.tenantId, tenantId), status === 'open' ? inArray(dataRequests.status, ['pending', 'scheduled']) : status === 'done' ? inArray(dataRequests.status, ['done', 'rejected', 'cancelled']) : undefined))
      .orderBy(desc(dataRequests.requestedAt)).limit(100);
    // A stopped account that leads halaqat cannot be approved yet: say so beside the request.
    const leads = new Map<string, number>();
    for (const r of rows.filter((x) => x.status === 'pending' && !isErasable(x.subjectRole))) leads.set(r.userId, await activeHalaqatLed(db, r.userId));
    return { requests: rows.map((r) => ({ ...serialize(r), leadsHalaqat: leads.get(r.userId) ?? 0, erasable: isErasable(r.subjectRole) })), graceDays: config.DATA_DELETION_GRACE_DAYS };
  });

  // POST /v1/admin/data-requests — a dean enters a request on someone's behalf (one that came by email)
  app.post('/admin/data-requests', { schema: { body: onBehalf }, preHandler: [app.authenticate] }, async (request, reply) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const body = request.body as z.infer<typeof onBehalf>;
    const [subject] = await db.select().from(users).where(and(eq(users.id, body.userId), eq(users.tenantId, tenantId))).limit(1);
    if (!subject || PLATFORM_ROLES.includes(subject.role)) return request.server.httpErrors.notFound('User not found');
    if (!canDecide(request.user, subject.role)) return request.server.httpErrors.forbidden('Only the platform operator handles a dean\'s data');
    const made = await open(request, subject, 'admin', request.user, body.note);
    if ('error' in made) return made.error;
    return reply.code(201).send(serialize(made.row));
  });

  const load = async (request: { server: FastifyInstance; user: TokenPayload; params: unknown }) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return { error: forbidden(request) };
    const { id } = request.params as z.infer<typeof idParam>;
    const [row] = await db.select().from(dataRequests).where(and(eq(dataRequests.id, id), eq(dataRequests.tenantId, tenantId))).limit(1);
    if (!row) return { error: request.server.httpErrors.notFound('Request not found') };
    if (!canDecide(request.user, row.subjectRole)) return { error: request.server.httpErrors.forbidden('Only the platform operator handles a dean\'s data') };
    return { row };
  };

  // POST /v1/admin/data-requests/:id/approve — chooses what is removed; the account is stopped and the data goes after the grace period
  app.post('/admin/data-requests/:id/approve', { schema: { params: idParam, body: approve }, preHandler: [app.authenticate] }, async (request) => {
    const found = await load(request);
    if ('error' in found) return found.error;
    const { row } = found;
    const body = request.body as z.infer<typeof approve>;
    const errors = request.server.httpErrors;
    if (row.status !== 'pending') return errors.conflict('This request has already been decided');
    if (body.mode === 'erase' && !isErasable(row.subjectRole)) return errors.badRequest('A member of staff can only be anonymized: what she wrote and graded belongs to the institution');
    const led = await activeHalaqatLed(db, row.userId);
    if (led > 0) return errors.conflict(`She leads ${led} halaqa: hand them to another teacher first`);

    const [subject] = await db.select({ active: users.active }).from(users).where(eq(users.id, row.userId)).limit(1);
    const stop = Boolean(subject?.active);
    if (stop) await db.update(users).set({ active: false, updatedAt: new Date() }).where(eq(users.id, row.userId));
    forgetStopped(row.userId);
    const scheduledFor = new Date(Date.now() + config.DATA_DELETION_GRACE_DAYS * 86_400_000);
    await db.update(dataRequests).set({
      status: 'scheduled', mode: body.mode, decidedBy: request.user.sub, decidedAt: new Date(), decisionNote: body.note ?? row.decisionNote, scheduledFor, stoppedByRequest: stop,
    }).where(eq(dataRequests.id, row.id));
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, tenantId: row.tenantId, action: 'data.deletion.approved', targetType: 'data_request', targetId: row.id,
      metadata: { mode: body.mode, scheduledFor: scheduledFor.toISOString(), role: row.subjectRole },
    });
    return serialize((await db.select().from(dataRequests).where(eq(dataRequests.id, row.id)).limit(1))[0]);
  });

  // POST /v1/admin/data-requests/:id/reject
  app.post('/admin/data-requests/:id/reject', { schema: { params: idParam, body: reject }, preHandler: [app.authenticate] }, async (request) => {
    const found = await load(request);
    if ('error' in found) return found.error;
    if (found.row.status !== 'pending') return request.server.httpErrors.conflict('This request has already been decided');
    const { reason } = request.body as z.infer<typeof reject>;
    const [row] = await db.update(dataRequests).set({ status: 'rejected', decidedBy: request.user.sub, decidedAt: new Date(), decisionNote: reason }).where(eq(dataRequests.id, found.row.id)).returning();
    await auditLog({ actorId: request.user.sub, actorRole: request.user.role, tenantId: row.tenantId, action: 'data.deletion.rejected', targetType: 'data_request', targetId: row.id });
    return serialize(row);
  });

  // POST /v1/admin/data-requests/:id/cancel — withdraws a request, even an approved one that has not run yet; an account the approval stopped is restored
  app.post('/admin/data-requests/:id/cancel', { schema: { params: idParam }, preHandler: [app.authenticate] }, async (request) => {
    const found = await load(request);
    if ('error' in found) return found.error;
    const { row } = found;
    if (row.status !== 'pending' && row.status !== 'scheduled') return request.server.httpErrors.conflict('This request is no longer open');
    const [updated] = await db.update(dataRequests).set({ status: 'cancelled', decidedBy: request.user.sub, decidedAt: new Date() })
      .where(and(eq(dataRequests.id, row.id), inArray(dataRequests.status, ['pending', 'scheduled']))).returning();
    if (!updated) return request.server.httpErrors.conflict('This request is no longer open');
    if (row.stoppedByRequest) { await db.update(users).set({ active: true, updatedAt: new Date() }).where(eq(users.id, row.userId)); forgetStopped(row.userId); }
    await auditLog({ actorId: request.user.sub, actorRole: request.user.role, tenantId: row.tenantId, action: 'data.deletion.cancelled', targetType: 'data_request', targetId: row.id, metadata: { by: 'admin', restored: row.stoppedByRequest } });
    return serialize(updated);
  });

  // GET /v1/admin/users/:id/export — a dean gives a person her data (when she asks for it by email)
  app.get('/admin/users/:id/export', { schema: { params: idParam }, preHandler: [app.authenticate] }, async (request, reply) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const { id } = request.params as z.infer<typeof idParam>;
    const [subject] = await db.select({ id: users.id, role: users.role }).from(users).where(and(eq(users.id, id), eq(users.tenantId, tenantId))).limit(1);
    if (!subject || PLATFORM_ROLES.includes(subject.role)) return request.server.httpErrors.notFound('User not found');
    if (!canDecide(request.user, subject.role)) return request.server.httpErrors.forbidden('Only the platform operator handles a dean\'s data');
    const data = await buildExport(db, id);
    await auditLog({ actorId: request.user.sub, actorRole: request.user.role, tenantId, action: 'data.exported', targetType: 'user', targetId: id, metadata: { by: 'admin' } });
    return reply.header('Content-Disposition', 'attachment; filename="itqan-user-data.json"').type('application/json').send(data);
  });
}

