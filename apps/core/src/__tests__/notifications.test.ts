/** The notification list behind the bell: own notifications only, unread counts, reading them, paging, and the module switch. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { notifications, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';

describe.skipIf(!process.env.DATABASE_URL)('notifications', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const call = (who: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    app.inject({ method, url: `/v1${url}`, headers: { authorization: `Bearer ${tokens[who]}` }, payload });
  const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `ntf-${tag}`, nameAr: 'معهد' }).returning();
    const mk = async (role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId: tenant.id, role, displayNameAr: name }).returning())[0];
    const student = await mk('student', 'أسماء');
    const other = await mk('student', 'بسمة');
    const teacher = await mk('lecturer', 'المعلمة');
    const dean = await mk('dean', 'العميدة');
    Object.assign(ids, { student: student.id, other: other.id, tenant: tenant.id });
    Object.assign(tokens, { student: tok(student), other: tok(other), teacher: tok(teacher), dean: tok(dean) });
    const row = (userId: string, title: string, ago: number, read = false) => ({
      userId, titleAr: title, bodyAr: `نص ${title}`, sentAt: minutesAgo(ago), readAt: read ? new Date() : null, data: { type: 'live_reminder', sessionId: randomUUID() },
    });
    await db.insert(notifications).values([
      row(student.id, 'الأحدث', 1), row(student.id, 'الأوسط', 5), row(student.id, 'قديم مقروء', 30, true), row(student.id, 'الأقدم', 60),
      row(other.id, 'لبسمة', 2),
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await closeDb();
  });

  it('lists only the user’s own notifications, newest first', async () => {
    const list = (await call('student', 'GET', '/notifications')).json();
    expect(list.map((n: { titleAr: string }) => n.titleAr)).toEqual(['الأحدث', 'الأوسط', 'قديم مقروء', 'الأقدم']);
    expect(list[0]).toMatchObject({ readAt: null, data: { type: 'live_reminder' } });
    expect((await call('other', 'GET', '/notifications')).json().map((n: { titleAr: string }) => n.titleAr)).toEqual(['لبسمة']);
    expect((await call('teacher', 'GET', '/notifications')).json()).toEqual([]);
  });

  it('counts the unread ones, and lists only those on request', async () => {
    expect((await call('student', 'GET', '/notifications/count')).json()).toEqual({ unread: 3 });
    expect((await call('other', 'GET', '/notifications/count')).json()).toEqual({ unread: 1 });
    expect((await call('teacher', 'GET', '/notifications/count')).json()).toEqual({ unread: 0 });
    const unread = (await call('student', 'GET', '/notifications?unread=true')).json();
    expect(unread.map((n: { titleAr: string }) => n.titleAr)).toEqual(['الأحدث', 'الأوسط', 'الأقدم']);
    expect((await call('student', 'GET', '/notifications?unread=maybe')).statusCode).toBe(400);
  });

  it('pages back through older ones', async () => {
    const first = (await call('student', 'GET', '/notifications?limit=2')).json();
    expect(first.map((n: { titleAr: string }) => n.titleAr)).toEqual(['الأحدث', 'الأوسط']);
    const next = (await call('student', 'GET', `/notifications?limit=2&before=${encodeURIComponent(first[1].sentAt)}`)).json();
    expect(next.map((n: { titleAr: string }) => n.titleAr)).toEqual(['قديم مقروء', 'الأقدم']);
    expect((await call('student', 'GET', '/notifications?limit=500')).statusCode).toBe(400);
    expect((await call('student', 'GET', '/notifications?before=yesterday')).statusCode).toBe(400);
  });

  it('marks one as read, only for its owner', async () => {
    const [first] = (await call('student', 'GET', '/notifications')).json();
    // Someone else cannot mark it.
    expect((await call('other', 'POST', `/notifications/read/${first.id}`)).statusCode).toBe(200);
    expect((await call('student', 'GET', '/notifications/count')).json()).toEqual({ unread: 3 });
    expect((await call('student', 'POST', `/notifications/read/${first.id}`)).statusCode).toBe(200);
    expect((await call('student', 'GET', '/notifications/count')).json()).toEqual({ unread: 2 });
    expect((await call('student', 'POST', '/notifications/read/not-an-id')).statusCode).toBe(400);
  });

  it('marks all as read, only the user’s own', async () => {
    expect((await call('student', 'POST', '/notifications/read-all')).statusCode).toBe(200);
    expect((await call('student', 'GET', '/notifications/count')).json()).toEqual({ unread: 0 });
    expect((await call('other', 'GET', '/notifications/count')).json()).toEqual({ unread: 1 });
    const readAt = (await call('student', 'GET', '/notifications')).json().map((n: { readAt: string | null }) => n.readAt);
    expect(readAt.every(Boolean)).toBe(true);
  });

  it('lets staff notify people of their own institution', async () => {
    const res = await call('teacher', 'POST', '/notifications', { userId: ids.student, titleAr: 'تنبيه', bodyAr: 'نص' });
    expect(res.statusCode).toBe(200);
    expect((await call('student', 'GET', '/notifications/count')).json()).toEqual({ unread: 1 });
    expect((await call('student', 'POST', '/notifications', { userId: ids.other, titleAr: 'x', bodyAr: 'y' })).statusCode).toBe(403);
  });

  it('is refused for everyone while the institution has the module off', async () => {
    const put = (enabled: boolean) => call('dean', 'PUT', '/admin/modules/notifications', { enabled });
    expect((await put(false)).statusCode).toBe(200);
    for (const url of ['/notifications', '/notifications/count']) {
      const res = await call('student', 'GET', url);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('MODULE_DISABLED');
    }
    expect((await call('student', 'POST', '/notifications/read-all')).json().code).toBe('MODULE_DISABLED');
    expect((await put(true)).statusCode).toBe(200);
    expect((await call('student', 'GET', '/notifications/count')).statusCode).toBe(200);
    await getDb().delete(notifications).where(eq(notifications.userId, ids.student));
  });
});
