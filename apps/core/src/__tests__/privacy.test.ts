/**
 * Giving people their data and deleting it on request: the file she can download, the request and its decision, the stop during
 * the grace period, and what anonymizing and erasing remove and keep.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import {
  attendance, auditLogs, consents, dataRequests, guardianLinks, hifzPeriodResults, hifzPrograms, notifications, reviewLogs, sectionEnrollments, sections,
  studentCards, studentMonthlyAppraisals, tasmiSubmissions, tenants, users,
} from '../db/schema';
import { generateToken } from '../lib/jwt';
import { DELETED_NAME, executeDueDeletions } from '../lib/data-deletion';
import { MemoryStorage, setStorage } from '../lib/storage';
import { config } from '../config';

const DAY = 86_400_000;

describe.skipIf(!process.env.DATABASE_URL)('data requests', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const storage = new MemoryStorage();
  const call = (who: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url: `/v1${url}`, headers: { authorization: `Bearer ${tokens[who]}` }, payload });
  const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
  const phone = (i: number) => `+2011${tag.replace(/\D/g, '').padEnd(4, '3').slice(0, 4)}${String(i).padStart(4, '0')}`;
  const later = (days = config.DATA_DELETION_GRACE_DAYS + 1) => new Date(Date.now() + days * DAY);
  const request = async (who: string, userId: string, approveWith?: object) => {
    const made = (await call(who, 'POST', '/admin/data-requests', { userId })).json();
    if (approveWith) await call('dean', 'POST', `/admin/data-requests/${made.id}/approve`, approveWith);
    return made.id as string;
  };

  /** A student with a graded recitation and its recording, learning history, and everything else a student leaves behind. */
  const seedStudent = async (key: string, name: string, number: number) => {
    const db = getDb();
    const [s] = await db.insert(users).values({ tenantId: ids.tenant, role: 'student', displayNameAr: name, whatsappE164: phone(number), email: `${key}-${tag}@x.test` }).returning();
    await db.insert(sectionEnrollments).values({ sectionId: ids.section, studentId: s.id });
    const audio = `tasmi/${s.id}.webm`; const reply = `tasmi/${s.id}-reply.webm`;
    await storage.put(audio, Buffer.from('audio'), 'audio/webm'); await storage.put(reply, Buffer.from('reply'), 'audio/webm');
    await db.insert(tasmiSubmissions).values({
      studentId: s.id, sectionId: ids.section, startRef: '112:1', endRef: '112:4', audioKey: audio, replyAudioKey: reply, reviewVerdict: 'approved', reviewedAt: new Date(),
      reviewHifzScore: 90, reviewTajweedScore: 80, reviewFluencyScore: 85, reviewWeightedTotal: 86, reviewNotes: `ملاحظة عن ${name}`,
    });
    const [card] = await db.insert(studentCards).values({ studentId: s.id, ayahRef: '112:1' }).returning();
    await db.insert(reviewLogs).values({ cardId: card.id, rating: 'good', wasCorrect: true });
    await db.insert(consents).values({ userId: s.id, purpose: 'voice_recording', grantedAt: new Date() });
    await db.insert(notifications).values({ userId: s.id, titleAr: 'عنوان', bodyAr: 'نص' });
    await db.insert(attendance).values({ studentId: s.id, sectionId: ids.section, date: '2026-11-01', present: true, markedBy: ids.teacher });
    await db.insert(studentMonthlyAppraisals).values({ studentId: s.id, month: '2026-11', note: `تقدير ${name}`, teacherId: ids.teacher });
    await db.insert(hifzPeriodResults).values({
      studentId: s.id, sectionId: ids.section, programId: ids.program, periodIndex: 0, periodName: 'الأولى', attempt: 1, scoreHifz: 40, scoreTajweed: 25, scoreReview: null,
      scoreRetention: 15, weights: { hifz: 40, tajweed: 25, review: 0, retention: 15 }, passScore: 85, minCriterionPct: 70, total: 80, outcome: 'repeat', note: 'سرّ', enteredBy: ids.teacher,
    });
    ids[key] = s.id; ids[`${key}Audio`] = audio; ids[`${key}Reply`] = reply;
    tokens[key] = tok(s);
    return s;
  };

  beforeAll(async () => {
    setStorage(storage);
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `prv-${tag}`, nameAr: 'معهد' }).returning();
    const [other] = await db.insert(tenants).values({ slug: `prx-${tag}`, nameAr: 'معهد آخر' }).returning();
    const mk = async (tenantId: string, role: typeof users.$inferInsert['role'], name: string, extra: Partial<typeof users.$inferInsert> = {}) =>
      (await db.insert(users).values({ tenantId, role, displayNameAr: name, ...extra }).returning())[0];
    const dean = await mk(tenant.id, 'dean', 'العميدة', { email: `dean-${tag}@x.test` });
    const operator = await mk(tenant.id, 'operator', 'المشغّل', { email: `op-${tag}@x.test` });
    const teacher = await mk(tenant.id, 'lecturer', 'المعلمة', { email: `t-${tag}@x.test` });
    const advisor = await mk(tenant.id, 'advisor', 'المرشدة', { email: `adv-${tag}@x.test` });
    const foreignDean = await mk(other.id, 'dean', 'عميدة أخرى', { email: `fd-${tag}@x.test` });
    const [section] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: `R${tag.toUpperCase().slice(0, 6)}`, teacherId: teacher.id }).returning();
    const [program] = await db.insert(hifzPrograms).values({ tenantId: tenant.id, nameAr: 'برنامج' }).returning();
    Object.assign(ids, { operator: operator.id, tenant: tenant.id, other: other.id, dean: dean.id, teacher: teacher.id, advisor: advisor.id, section: section.id, program: program.id });
    Object.assign(tokens, { dean: tok(dean), operator: tok(operator), teacher: tok(teacher), advisor: tok(advisor), foreignDean: tok(foreignDean) });
    const asma = await seedStudent('asma', 'أسماء', 1);
    await seedStudent('basma', 'بسمة', 2); // a classmate who must be untouched by everything done to Asma
    const guardian = await mk(tenant.id, 'mahram', 'ولي أسماء', { whatsappE164: phone(50) });
    await db.insert(guardianLinks).values({ studentId: asma.id, guardianId: guardian.id });
    Object.assign(ids, { guardian: guardian.id });
    tokens.guardian = tok(guardian);
  });

  afterAll(async () => {
    setStorage(null);
    await app?.close();
    await closeDb();
  });

  it('gives a person her data as a file, and no one else’s', async () => {
    const res = await call('asma', 'GET', '/me/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const data = res.json();
    expect(data.profile).toMatchObject({ id: ids.asma, name: 'أسماء', role: 'student', whatsapp: phone(1) });
    expect(data.recitations).toHaveLength(1);
    expect(data.recitations[0]).toMatchObject({ verdict: 'approved', total: 86, teacherNote: 'ملاحظة عن أسماء' });
    expect(data.periodTests[0]).toMatchObject({ period: 'الأولى', outcome: 'repeat' });
    expect(data.monthlyAppraisals[0].note).toBe('تقدير أسماء');
    expect(data.revisionCards).toHaveLength(1);
    expect(data.guardianLinks[0].guardian).toMatchObject({ name: 'ولي أسماء' });
    const text = JSON.stringify(data);
    expect(text).not.toContain('بسمة'); // nothing of her classmate
    expect(text).not.toContain('.webm'); // no recordings, nor where they are kept
    expect((await app.inject({ method: 'GET', url: '/v1/me/export' })).statusCode).toBe(401);
    // A guardian gets her own data: the child's name, nothing more of her.
    const g = (await call('guardian', 'GET', '/me/export')).json();
    expect(g.profile.name).toBe('ولي أسماء');
    expect(g.guardianLinks[0].student).toEqual({ name: 'أسماء' });
    expect(JSON.stringify(g)).not.toContain('ملاحظة');
  });

  it('lets a dean give a person her data, in her own institution only', async () => {
    const res = await call('dean', 'GET', `/admin/users/${ids.asma}/export`);
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.id).toBe(ids.asma);
    for (const who of ['teacher', 'asma']) expect((await call(who, 'GET', `/admin/users/${ids.asma}/export`)).statusCode).toBe(403);
    expect((await call('foreignDean', 'GET', `/admin/users/${ids.asma}/export`)).statusCode).toBe(404);
    expect((await call('dean', 'GET', `/admin/users/${ids.dean}/export`)).statusCode).toBe(403); // a dean's data is the operator's
    expect((await call('dean', 'GET', `/admin/users/${ids.operator}/export`)).statusCode).toBe(404);
  });

  it('lets her ask, once, and withdraw the request before it is decided', async () => {
    expect((await call('asma', 'GET', '/me/data-request')).json()).toMatchObject({ request: null, graceDays: config.DATA_DELETION_GRACE_DAYS });
    const made = await call('asma', 'POST', '/me/data-request');
    expect(made.statusCode).toBe(201);
    expect(made.json().request).toMatchObject({ status: 'pending', source: 'self', subjectRole: 'student', mode: null });
    expect((await call('asma', 'POST', '/me/data-request')).statusCode).toBe(409);
    expect((await call('asma', 'GET', '/me/data-request')).json().request.status).toBe('pending');
    expect((await call('asma', 'DELETE', '/me/data-request')).statusCode).toBe(200);
    expect((await call('asma', 'GET', '/me/data-request')).json().request).toBeNull();
    expect((await call('asma', 'DELETE', '/me/data-request')).statusCode).toBe(404);
    expect((await call('asma', 'POST', '/me/data-request')).statusCode).toBe(201); // and may ask again
  });

  it('shows a dean the open requests of her institution, and lets only a dean decide', async () => {
    const list = (await call('dean', 'GET', '/admin/data-requests')).json();
    expect(list.requests).toHaveLength(1);
    expect(list.requests[0]).toMatchObject({ userId: ids.asma, subjectName: 'أسماء', status: 'pending', erasable: true, leadsHalaqat: 0 });
    ids.request = list.requests[0].id;
    expect((await call('foreignDean', 'GET', '/admin/data-requests')).json().requests).toEqual([]);
    for (const who of ['teacher', 'asma', 'advisor']) {
      expect((await call(who, 'GET', '/admin/data-requests')).statusCode, who).toBe(403);
      expect((await call(who, 'POST', `/admin/data-requests/${ids.request}/approve`, {})).statusCode, who).toBe(403);
    }
    expect((await call('foreignDean', 'POST', `/admin/data-requests/${ids.request}/approve`, {})).statusCode).toBe(404);
  });

  it('can be refused, with a reason, and then she may ask again', async () => {
    expect((await call('dean', 'POST', `/admin/data-requests/${ids.request}/reject`, { reason: 'x' })).statusCode).toBe(400);
    const res = await call('dean', 'POST', `/admin/data-requests/${ids.request}/reject`, { reason: 'تحتاج الكلية سجلها هذا الفصل' });
    expect(res.json()).toMatchObject({ status: 'rejected', decisionNote: 'تحتاج الكلية سجلها هذا الفصل' });
    expect((await call('asma', 'GET', '/me/data-request')).json().request).toMatchObject({ status: 'rejected', decisionNote: expect.stringContaining('الكلية') });
    expect((await call('dean', 'POST', `/admin/data-requests/${ids.request}/reject`, { reason: 'مرة ثانية' })).statusCode).toBe(409);
    const again = await call('asma', 'POST', '/me/data-request');
    expect(again.statusCode).toBe(201);
    ids.request = again.json().request.id;
  });

  it('stops the account at once when approved, and keeps the data until the grace period is over', async () => {
    const res = await call('dean', 'POST', `/admin/data-requests/${ids.request}/approve`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'scheduled', mode: 'anonymize' });
    const days = (Date.parse(res.json().scheduledFor) - Date.now()) / DAY;
    expect(days).toBeGreaterThan(config.DATA_DELETION_GRACE_DAYS - 0.1);
    expect(days).toBeLessThan(config.DATA_DELETION_GRACE_DAYS + 0.1);
    expect((await call('asma', 'GET', '/auth/me')).statusCode).toBe(401); // no more sign-in, and her open session is cut
    expect((await call('dean', 'POST', `/admin/data-requests/${ids.request}/approve`, {})).statusCode).toBe(409); // decided already
    // Nothing is removed before the day.
    expect(await executeDueDeletions(getDb())).toBe(0);
    expect((await getDb().select().from(users).where(eq(users.id, ids.asma)))[0].displayNameAr).toBe('أسماء');
  });

  it('is undone by cancelling, which restores the account it stopped', async () => {
    const res = await call('dean', 'POST', `/admin/data-requests/${ids.request}/cancel`);
    expect(res.json().status).toBe('cancelled');
    expect((await call('asma', 'GET', '/auth/me')).statusCode).toBe(200);
    expect((await call('dean', 'POST', `/admin/data-requests/${ids.request}/cancel`)).statusCode).toBe(409);
    // An account that was already stopped stays stopped when its request is cancelled.
    await getDb().update(users).set({ active: false }).where(eq(users.id, ids.basma));
    const id = await request('dean', ids.basma, {});
    expect((await call('dean', 'POST', `/admin/data-requests/${id}/cancel`)).json().status).toBe('cancelled');
    expect((await getDb().select().from(users).where(eq(users.id, ids.basma)))[0].active).toBe(false);
    await getDb().update(users).set({ active: true }).where(eq(users.id, ids.basma));
    ids.request = '';
  });

  it('anonymizes: the name, contact, recordings, remarks and learning history go; the grades, attendance and place in the halaqa stay', async () => {
    ids.request = await request('dean', ids.asma, { mode: 'anonymize' });
    const db = getDb();
    expect(await executeDueDeletions(db, later())).toBe(1);

    const [user] = await db.select().from(users).where(eq(users.id, ids.asma));
    expect(user).toMatchObject({ displayNameAr: DELETED_NAME, email: null, whatsappE164: null, active: false });
    // What stays: her scores and verdict, her attendance, her place in the halaqa, her period result.
    const [recitation] = await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.studentId, ids.asma));
    expect(recitation).toMatchObject({ reviewVerdict: 'approved', reviewWeightedTotal: 86, reviewHifzScore: 90, audioKey: null, replyAudioKey: null, reviewNotes: null });
    expect(await db.select().from(attendance).where(eq(attendance.studentId, ids.asma))).toHaveLength(1);
    expect(await db.select().from(sectionEnrollments).where(eq(sectionEnrollments.studentId, ids.asma))).toHaveLength(1);
    const [result] = await db.select().from(hifzPeriodResults).where(eq(hifzPeriodResults.studentId, ids.asma));
    expect(result).toMatchObject({ total: 80, outcome: 'repeat', note: null });
    expect((await db.select().from(studentMonthlyAppraisals).where(eq(studentMonthlyAppraisals.studentId, ids.asma)))[0].note).toBe('');
    // What goes.
    expect(await storage.get(ids.asmaAudio)).toBeNull();
    expect(await storage.get(ids.asmaReply)).toBeNull();
    for (const table of [studentCards, notifications, consents] as const) {
      const col = table === studentCards ? studentCards.studentId : (table as typeof notifications).userId;
      expect(await db.select().from(table).where(eq(col as never, ids.asma))).toHaveLength(0);
    }
    expect(await db.select().from(guardianLinks).where(eq(guardianLinks.studentId, ids.asma))).toHaveLength(0);
    expect((await db.select().from(users).where(eq(users.id, ids.guardian)))).toHaveLength(1); // her guardian's own account stays
    // Her classmate is untouched.
    expect((await db.select().from(users).where(eq(users.id, ids.basma)))[0]).toMatchObject({ displayNameAr: 'بسمة', whatsappE164: phone(2) });
    expect(await storage.get(ids.basmaAudio)).not.toBeNull();
    expect(await db.select().from(studentCards).where(eq(studentCards.studentId, ids.basma))).toHaveLength(1);
    // The request is the record that it was done, without her name.
    const [done] = await db.select().from(dataRequests).where(eq(dataRequests.id, ids.request));
    expect(done).toMatchObject({ status: 'done', mode: 'anonymize', subjectName: null });
    expect(done.summary).toMatchObject({ mode: 'anonymize', recordings: 2, cards: 1 });
    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.resourceId, ids.request), eq(auditLogs.action, 'data.deletion.completed')));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain('أسماء');
    // Running it again does nothing.
    expect(await executeDueDeletions(db, later())).toBe(0);
  });

  it('frees her number and email for someone else', async () => {
    const res = await call('dean', 'POST', '/admin/users', { role: 'student', displayNameAr: 'طالبة جديدة', whatsapp: phone(1) });
    expect(res.statusCode).toBe(201);
  });

  it('erases: the account and everything attached to it, grades included, and the trail that she existed stays', async () => {
    const carol = await seedStudent('carol', 'كارول', 3);
    await getDb().insert(auditLogs).values({ userId: carol.id, tenantId: ids.tenant, action: 'login', resource: 'session' });
    const id = await request('dean', ids.carol, { mode: 'erase' });
    expect(await executeDueDeletions(getDb(), later())).toBe(1);
    const db = getDb();
    expect(await db.select().from(users).where(eq(users.id, ids.carol))).toHaveLength(0);
    expect(await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.studentId, ids.carol))).toHaveLength(0);
    expect(await db.select().from(hifzPeriodResults).where(eq(hifzPeriodResults.studentId, ids.carol))).toHaveLength(0);
    expect(await db.select().from(attendance).where(eq(attendance.studentId, ids.carol))).toHaveLength(0);
    expect(await storage.get(ids.carolAudio)).toBeNull();
    expect(await db.select().from(auditLogs).where(eq(auditLogs.userId, ids.carol))).toHaveLength(0); // no longer points at her
    const [done] = await db.select().from(dataRequests).where(eq(dataRequests.id, id));
    expect(done).toMatchObject({ status: 'done', mode: 'erase', subjectName: null, userId: ids.carol });
    // The others are as they were.
    expect(await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.studentId, ids.basma))).toHaveLength(1);
  });

  it('lets only students and guardians be erased: staff are anonymized, and not while they lead a halaqa', async () => {
    const forAdvisor = await request('dean', ids.advisor);
    expect((await call('dean', 'POST', `/admin/data-requests/${forAdvisor}/approve`, { mode: 'erase' })).statusCode).toBe(400);
    const forTeacher = await request('dean', ids.teacher);
    const blocked = await call('dean', 'POST', `/admin/data-requests/${forTeacher}/approve`, {});
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message ?? blocked.json().detail).toContain('halaqa');
    expect((await call('dean', 'GET', '/admin/data-requests')).json().requests.find((r: { id: string }) => r.id === forTeacher)).toMatchObject({ leadsHalaqat: 1, erasable: false });
    // The advisor, who leads none, is anonymized.
    expect((await call('dean', 'POST', `/admin/data-requests/${forAdvisor}/approve`, {})).statusCode).toBe(200);
    // A halaqa given to her in the meantime holds the deletion back.
    await getDb().update(sections).set({ teacherId: ids.advisor }).where(eq(sections.id, ids.section));
    expect(await executeDueDeletions(getDb(), later())).toBe(0);
    const [held] = await getDb().select().from(dataRequests).where(eq(dataRequests.id, forAdvisor));
    expect(held.status).toBe('scheduled');
    expect((held.summary as { error: string }).error).toContain('halaqa');
    await getDb().update(sections).set({ teacherId: ids.teacher }).where(eq(sections.id, ids.section));
    expect(await executeDueDeletions(getDb(), later())).toBe(1);
    expect((await getDb().select().from(users).where(eq(users.id, ids.advisor)))[0]).toMatchObject({ displayNameAr: DELETED_NAME, email: null, active: false });
    await call('dean', 'POST', `/admin/data-requests/${forTeacher}/cancel`);
  });

  it('leaves a dean’s data to the platform operator', async () => {
    expect((await call('dean', 'POST', '/admin/data-requests', { userId: ids.dean })).statusCode).toBe(403);
    expect((await call('dean', 'POST', '/admin/data-requests', { userId: ids.operator })).statusCode).toBe(404);
    const made = await call('operator', 'POST', '/admin/data-requests', { userId: ids.dean });
    expect(made.statusCode).toBe(201);
    expect((await call('dean', 'POST', `/admin/data-requests/${made.json().id}/approve`, {})).statusCode).toBe(403);
    expect((await call('operator', 'POST', `/admin/data-requests/${made.json().id}/cancel`)).statusCode).toBe(200);
  });

  it('lists the decided requests too, and keeps institutions apart', async () => {
    const done = (await call('dean', 'GET', '/admin/data-requests?status=done')).json().requests;
    expect(done.map((r: { status: string }) => r.status)).toEqual(expect.arrayContaining(['done', 'cancelled', 'rejected']));
    expect(done.every((r: { subjectName: string | null; status: string }) => r.status !== 'done' || r.subjectName === null)).toBe(true);
    expect((await call('foreignDean', 'GET', '/admin/data-requests?status=done')).json().requests).toEqual([]);
    expect((await call('dean', 'GET', '/admin/data-requests?status=nope')).statusCode).toBe(400);
  });
});
