/**
 * «آيات للحفظ»: a teacher records verses for her halaqa, her students listen and recite them back.
 * Who may record, list, listen and delete; linking a recitation to its lesson. Uses in-memory storage.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { consents, guardianLinks, recitationLessons, sectionEnrollments, sections, studentCards, tasmiSubmissions, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { MemoryStorage, setStorage } from '../lib/storage';

/** A tiny but correctly-labelled WebM file (EBML header + padding). */
const webm = (size = 2000) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(size - 4, 7)]);

function multipart(fields: Record<string, string>, audio?: Buffer) {
  const boundary = `----itqan${randomUUID()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (audio) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n`), audio, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe.skipIf(!process.env.DATABASE_URL)('verses to memorize, recorded by the teacher', () => {
  let app: FastifyInstance;
  const storage = new MemoryStorage();
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, url: string, fields: Record<string, string>, audio?: Buffer) => {
    const m = multipart(fields, audio);
    return app.inject({ method: 'POST', url, payload: m.payload, headers: { ...auth(who), 'content-type': m.contentType } });
  };
  /** `audio: null` sends no file (undefined would fall back to the default). */
  const record = (who: string, fields: Record<string, string>, audio: Buffer | null = webm(), section = 'section') =>
    post(who, `/v1/sections/${ids[section]}/lessons`, fields, audio ?? undefined);
  const recite = (who: string, fields: Record<string, string>) => post(who, '/v1/tasmi', { sectionId: ids.section, ...fields }, webm(2400));
  const get = (who: string, url: string) => app.inject({ method: 'GET', url, headers: auth(who) });

  beforeAll(async () => {
    setStorage(storage);
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `les-${tag}`, nameAr: 'معهد' }).returning();
    const mk = async (role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId: tenant.id, role, displayNameAr: name }).returning())[0];
    const teacher = await mk('lecturer', 'المعلمة هدى');
    const otherTeacher = await mk('lecturer', 'معلمة أخرى');
    const dean = await mk('dean', 'العميدة');
    const student = await mk('student', 'طالبة');
    const classmate = await mk('student', 'زميلة');
    const outsider = await mk('student', 'من حلقة أخرى');
    const guardian = await mk('mahram', 'ولي الأمر');
    const code = (p: string) => `${p}${tag.toUpperCase().slice(0, 6)}`;
    const [section] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة الفجر', joinCode: code('L'), teacherId: teacher.id }).returning();
    const [otherSection] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة أخرى', joinCode: code('K'), teacherId: otherTeacher.id }).returning();
    await db.insert(sectionEnrollments).values([
      { sectionId: section.id, studentId: student.id }, { sectionId: section.id, studentId: classmate.id },
      { sectionId: otherSection.id, studentId: outsider.id },
    ]);
    await db.insert(guardianLinks).values({ studentId: student.id, guardianId: guardian.id });
    await db.insert(consents).values([student, classmate].map((u) => ({ userId: u.id, purpose: 'voice_recording' as const, grantedAt: new Date() })));
    await db.insert(studentCards).values({ studentId: student.id, ayahRef: '78:2', state: 'review', stability: 5, reps: 3 });
    Object.assign(ids, { section: section.id, otherSection: otherSection.id, student: student.id, classmate: classmate.id, teacher: teacher.id });
    const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
    Object.assign(tokens, {
      teacher: tok(teacher), otherTeacher: tok(otherTeacher), dean: tok(dean), student: tok(student),
      classmate: tok(classmate), outsider: tok(outsider), guardian: tok(guardian),
    });
  });

  afterAll(async () => {
    setStorage(null);
    await app?.close();
    await closeDb();
  });

  it('can be recorded only by whoever manages the halaqa', async () => {
    const fields = { startRef: '78:1', endRef: '78:5' };
    for (const who of ['student', 'otherTeacher', 'guardian']) expect((await record(who, fields)).statusCode).toBe(404);
    expect(await getDb().select().from(recitationLessons).where(eq(recitationLessons.sectionId, ids.section))).toHaveLength(0);
  });

  it('validates the verses and the recording', async () => {
    expect((await record('teacher', { startRef: '78:1', endRef: '78:5' }, null)).statusCode).toBe(400); // no audio
    expect((await record('teacher', { startRef: '78:1', endRef: '78:5' }, Buffer.from('just some text, not audio'))).statusCode).toBe(415);
    expect((await record('teacher', { startRef: '78:5', endRef: '78:1' })).statusCode).toBe(400);
    expect((await record('teacher', { startRef: '78:1', endRef: '78:99' })).statusCode).toBe(400);
    expect((await record('teacher', { startRef: '78:40', endRef: '79:2' })).statusCode).toBe(400); // two suras
    expect((await record('teacher', { startRef: '2:1', endRef: '2:61' })).statusCode).toBe(400); // more than a student can recite back
    expect((await record('teacher', { startRef: '78:1', endRef: '78:5', note: 'x'.repeat(501) })).statusCode).toBe(400);
    expect(await getDb().select().from(recitationLessons).where(eq(recitationLessons.sectionId, ids.section))).toHaveLength(0);
  });

  it('saves the lesson and, when asked, adds its verses to each student\'s plan as new memorization', async () => {
    const res = await record('teacher', { startRef: '78:1', endRef: '78:5', note: '  انتبهن لمدّ «النبإ».  ', durationMs: '9000', addToPlan: 'true' }, webm(3000));
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ sectionId: ids.section, teacherId: ids.teacher, startRef: '78:1', endRef: '78:5', note: 'انتبهن لمدّ «النبإ».', durationMs: 9000 });
    // Five verses for the classmate, four for the student who already had 78:2.
    expect(body.planned).toBe(9);
    expect(body.audioKey).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('lessons/');
    ids.lesson = body.id;

    const cards = await getDb().select().from(studentCards).where(eq(studentCards.studentId, ids.student));
    expect(cards.filter((c) => c.state === 'new').map((c) => c.ayahRef).sort()).toEqual(['78:1', '78:3', '78:4', '78:5']);
    expect(cards.find((c) => c.ayahRef === '78:2')).toMatchObject({ state: 'review', reps: 3 }); // untouched

    const without = await record('teacher', { startRef: '112:1', endRef: '112:4' });
    expect(without.json().planned).toBe(0);
    ids.second = without.json().id;
    expect(await getDb().select().from(studentCards).where(eq(studentCards.studentId, ids.classmate))).toHaveLength(5);
  });

  it('shows a student the lessons of her own halaqat, newest first, and nobody else\'s', async () => {
    const mine = (await get('student', '/v1/lessons/mine')).json();
    expect(mine.map((l: { id: string }) => l.id)).toEqual([ids.second, ids.lesson]);
    expect(mine[1]).toMatchObject({ startRef: '78:1', endRef: '78:5', teacherName: 'المعلمة هدى', sectionName: 'حلقة الفجر', myRecitation: null });
    expect(mine[1].audioKey).toBeUndefined();
    expect((await get('outsider', '/v1/lessons/mine')).json()).toEqual([]);
    expect((await get('guardian', '/v1/lessons/mine')).json()).toEqual([]);
  });

  it('lets the halaqa\'s students and its staff listen, with seeking, and no one else', async () => {
    const link = (who: string) => get(who, `/v1/lessons/${ids.lesson}/audio-link`);
    for (const who of ['outsider', 'guardian', 'otherTeacher']) expect((await link(who)).statusCode).toBe(404);
    for (const who of ['teacher', 'dean', 'classmate']) expect((await link(who)).statusCode).toBe(200);
    expect((await get('student', `/v1/lessons/${randomUUID()}/audio-link`)).statusCode).toBe(404);
    const { url } = (await link('student')).json();

    const full = await app.inject({ method: 'GET', url });
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('audio/webm');
    expect(full.rawPayload.length).toBe(3000);
    const part = await app.inject({ method: 'GET', url, headers: { range: 'bytes=100-199' } });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload.length).toBe(100);

    expect((await app.inject({ method: 'GET', url: `/v1/lessons/${ids.lesson}/audio` })).statusCode).toBe(401);
    // A link for one lesson does not open another, and a recitation link does not open a lesson.
    expect((await app.inject({ method: 'GET', url: url.replace(ids.lesson, ids.second) })).statusCode).toBe(401);
    const other = generateToken({ sub: ids.lesson, role: 'audio', purpose: 'audio' }, '5m');
    expect((await app.inject({ method: 'GET', url: `/v1/lessons/${ids.lesson}/audio?token=${other}` })).statusCode).toBe(401);
  });

  it('links a student\'s recitation to the lesson, and only for the lesson\'s own verses and halaqa', async () => {
    expect((await recite('student', { startRef: '78:1', endRef: '78:4', lessonId: ids.lesson })).statusCode).toBe(400);
    expect((await recite('student', { startRef: '78:1', endRef: '78:5', lessonId: randomUUID() })).statusCode).toBe(400);
    expect((await recite('student', { startRef: '78:1', endRef: '78:5', lessonId: 'nonsense' })).statusCode).toBe(400);

    const res = await recite('student', { startRef: '78:1', endRef: '78:5', lessonId: ids.lesson });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ lessonId: ids.lesson, startRef: '78:1', endRef: '78:5' });
    ids.tasmi = res.json().id;

    // A recitation without a lesson still works exactly as before.
    expect((await recite('student', { startRef: '1:1', endRef: '1:7' })).json().lessonId).toBeNull();
  });

  it('shows the student her recitation and its result on the lesson, and the teacher who has recited', async () => {
    let mine = (await get('student', '/v1/lessons/mine')).json();
    expect(mine.find((l: { id: string }) => l.id === ids.lesson).myRecitation).toMatchObject({ id: ids.tasmi, verdict: null, total: null });
    expect(mine.find((l: { id: string }) => l.id === ids.second).myRecitation).toBeNull();

    await recite('student', { startRef: '78:1', endRef: '78:5', lessonId: ids.lesson }); // a second try
    const review = await app.inject({
      method: 'POST', url: `/v1/tasmi/${ids.tasmi}/review`, headers: auth('teacher'),
      payload: { hifzScore: 90, tajweedScore: 80, fluencyScore: 70, verdict: 'approved' },
    });
    expect(review.statusCode).toBe(200);
    mine = (await get('student', '/v1/lessons/mine')).json();
    // Her latest recitation of the lesson is the one shown.
    expect(mine.find((l: { id: string }) => l.id === ids.lesson).myRecitation).toMatchObject({ verdict: null });

    const list = await get('teacher', `/v1/sections/${ids.section}/lessons`);
    expect(list.statusCode).toBe(200);
    // Two students in the halaqa; one recited (twice, counted once).
    expect(list.json().map((l: { id: string; students: number; recited: number }) => [l.id, l.students, l.recited]))
      .toEqual([[ids.second, 2, 0], [ids.lesson, 2, 1]]);
    expect((await get('dean', `/v1/sections/${ids.section}/lessons`)).statusCode).toBe(200);
    for (const who of ['student', 'otherTeacher']) expect((await get(who, `/v1/sections/${ids.section}/lessons`)).statusCode).toBe(404);
  });

  it('lets the teacher delete a lesson and its recording; recitations of it stay', async () => {
    const del = (who: string, id = ids.lesson) => app.inject({ method: 'DELETE', url: `/v1/lessons/${id}`, headers: auth(who) });
    for (const who of ['student', 'otherTeacher']) expect((await del(who)).statusCode).toBe(404);
    const [before] = await getDb().select().from(recitationLessons).where(eq(recitationLessons.id, ids.lesson));
    expect((await del('teacher')).statusCode).toBe(204);
    expect(await storage.get(before.audioKey)).toBeNull();
    expect((await del('teacher')).statusCode).toBe(404);

    const [kept] = await getDb().select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, ids.tasmi));
    expect(kept).toMatchObject({ lessonId: null, reviewVerdict: 'approved', reviewWeightedTotal: 83 });
    expect((await get('student', '/v1/lessons/mine')).json().map((l: { id: string }) => l.id)).toEqual([ids.second]);
    expect((await get('student', `/v1/lessons/${ids.lesson}/audio-link`)).statusCode).toBe(404);
  });
});
