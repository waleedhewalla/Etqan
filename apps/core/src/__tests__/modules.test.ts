/**
 * The product's modules, configured by the institution's admin: what is on, what each setting is, that a
 * module switched off refuses its routes (and only for that institution), and that the settings change what the
 * features do.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { guardianLinks, liveSessions, sectionEnrollments, sections, tasmiSubmissions, tenants, users } from '../db/schema';
import { config } from '../config';
import { generateToken } from '../lib/jwt';
import { setLiveGateway } from '../lib/live';
import { MemoryStorage, setStorage } from '../lib/storage';
import { purgeExpiredAudio } from '../lib/retention';
import { purgeExpiredRecordings } from '../lib/live-recording';
import { DEFAULT_MAX_AYAT_PER_RECORDING, DEFAULT_NEW_PER_DAY, MODULES, MODULE_KEYS, checkConfig, moduleDef, moduleForPath, resolveModules } from '../lib/modules';
import { DEFAULT_NEW_PER_DAY as PLAN_DEFAULT } from '../lib/hifz-plan';
import { MAX_SUBMISSION_AYAT } from '../modules/assessment/routes';
import { MAX_ATTEMPTS } from '../lib/tasmi-status';

describe('the module registry', () => {
  it('lists every module once, with its dependencies before it', () => {
    expect(MODULES.map((m) => m.key)).toEqual([...MODULE_KEYS]);
    MODULES.forEach((m, i) => (m.dependsOn ?? []).forEach((d) => expect(MODULE_KEYS.indexOf(d)).toBeLessThan(i)));
  });

  it('keeps the defaults it cannot import in step with the code that uses them', () => {
    expect(DEFAULT_NEW_PER_DAY).toBe(PLAN_DEFAULT);
    expect(DEFAULT_MAX_AYAT_PER_RECORDING).toBe(MAX_SUBMISSION_AYAT);
    expect(resolveModules(null).recitation.config.maxAttempts).toBe(MAX_ATTEMPTS);
  });

  it('turns everything on for an institution that chose nothing, with the deployment’s own settings', () => {
    const state = resolveModules({});
    for (const m of MODULES) expect(state[m.key].enabled).toBe(m.key !== 'ai_checking');
    expect(state.ai_checking).toMatchObject({ enabled: false, requested: false });
    expect(state.live.config).toEqual({ recordingAllowed: true, recordingMaxMb: config.LIVE_RECORDING_MAX_MB, recordingRetentionDays: config.LIVE_RECORDING_RETENTION_DAYS });
    expect(state.recitation.config.audioRetentionHours).toBe(Math.max(1, Math.round(config.AUDIO_RETENTION_HOURS)));
  });

  it('switches a module off, and what depends on it with it', () => {
    const state = resolveModules({ modules: { recitation: { enabled: false } } });
    expect(state.recitation).toMatchObject({ enabled: false, requested: false, blockedBy: null });
    expect(state.lessons).toMatchObject({ enabled: false, requested: true, blockedBy: 'recitation' });
    expect(state.monthly_record).toMatchObject({ enabled: false, blockedBy: 'recitation' });
    expect(state.live.enabled).toBe(true);
    // A core module cannot be switched off by stored data either.
    expect(resolveModules({ modules: { review: { enabled: false } } }).review.enabled).toBe(true);
  });

  it('reads AI checking from its own flag and ignores stored settings that are no longer valid', () => {
    expect(resolveModules({ aiChecking: true }).ai_checking.enabled).toBe(true);
    const state = resolveModules({ modules: { recitation: { config: { maxAttempts: 99, maxAyatPerRecording: 'many', audioRetentionHours: 48 } } } });
    expect(state.recitation.config).toMatchObject({ maxAttempts: MAX_ATTEMPTS, maxAyatPerRecording: DEFAULT_MAX_AYAT_PER_RECORDING, audioRetentionHours: 48 });
  });

  it('checks the settings it is given', () => {
    const live = moduleDef('live')!;
    expect(checkConfig(live, { recordingAllowed: false, recordingMaxMb: 100 })).toEqual({ ok: true, config: { recordingAllowed: false, recordingMaxMb: 100 } });
    for (const bad of [{ recordingMaxMb: 10 }, { recordingMaxMb: 1.5 }, { recordingMaxMb: '100' }, { recordingAllowed: 1 }, { nothing: 1 }]) {
      expect(checkConfig(live, bad).ok).toBe(false);
    }
  });

  it('knows which module a route belongs to', () => {
    const at = moduleForPath;
    expect(at('/v1/tasmi')).toBe('recitation');
    expect(at('/v1/tasmi/abc/audio')).toBe('recitation');
    expect(at('/v1/sections/abc/lessons')).toBe('lessons');
    expect(at('/v1/lessons/mine')).toBe('lessons');
    expect(at('/v1/sections/abc/live')).toBe('live');
    expect(at('/v1/live/now')).toBe('live');
    expect(at('/v1/mutashabihat/mine')).toBe('mutashabihat');
    expect(at('/v1/sections/abc/attendance')).toBe('attendance');
    expect(at('/v1/reports/attendance/abc')).toBe('attendance');
    expect(at('/v1/reports/student/abc/monthly/appraisal')).toBe('monthly_record');
    expect(at('/v1/reports/student/abc')).toBeNull(); // the progress report is not the monthly record
    expect(at('/v1/guardian/students')).toBe('guardians');
    expect(at('/v1/sections/abc/students/def/guardians')).toBe('guardians');
    expect(at('/v1/admin/programs')).toBe('program');
    expect(at('/v1/sections/abc/program/apply')).toBe('program');
    expect(at('/v1/badges')).toBe('badges');
    expect(at('/v1/notifications/read-all')).toBe('notifications');
    expect(at('/v1/scheduler/queue')).toBeNull(); // the daily review is core
    expect(at('/v1/sections')).toBeNull();
  });
});

describe.skipIf(!process.env.DATABASE_URL)('configuring modules', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const storage = new MemoryStorage();
  const call = (who: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url: `/v1${url}`, headers: { authorization: `Bearer ${tokens[who]}` }, payload });
  const put = (key: string, body: object, who = 'dean') => call(who, 'PUT', `/admin/modules/${key}`, body);
  const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
  const moduleOf = async (key: string, who = 'dean') => (await call(who, 'GET', '/admin/modules')).json().modules.find((m: { key: string }) => m.key === key);
  const multipart = (fields: Record<string, string>) => {
    const boundary = `----itqan${randomUUID()}`;
    const parts = Object.entries(fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('') + `--${boundary}--\r\n`;
    return { payload: parts, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
  };
  const postMultipart = (who: string, url: string, fields: Record<string, string>) => {
    const m = multipart(fields);
    return app.inject({ method: 'POST', url: `/v1${url}`, headers: { authorization: `Bearer ${tokens[who]}`, ...m.headers }, payload: m.payload });
  };

  beforeAll(async () => {
    setStorage(storage);
    setLiveGateway({ joinToken: async () => 'token', setCanSpeak: async () => undefined, closeRoom: async () => undefined });
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `mod-${tag}`, nameAr: 'معهد' }).returning();
    const [other] = await db.insert(tenants).values({ slug: `mox-${tag}`, nameAr: 'معهد آخر' }).returning();
    const mk = async (tenantId: string, role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId, role, displayNameAr: name }).returning())[0];
    const dean = await mk(tenant.id, 'dean', 'العميدة');
    const advisor = await mk(tenant.id, 'advisor', 'المرشدة');
    const teacher = await mk(tenant.id, 'lecturer', 'المعلمة');
    const student = await mk(tenant.id, 'student', 'أسماء');
    const guardian = await mk(tenant.id, 'mahram', 'ولي الأمر');
    const otherDean = await mk(other.id, 'dean', 'عميدة أخرى');
    const otherTeacher = await mk(other.id, 'lecturer', 'معلمة أخرى');
    const otherStudent = await mk(other.id, 'student', 'طالبة أخرى');
    const code = (p: string) => `${p}${tag.toUpperCase().slice(0, 6)}`;
    const [section] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: code('M'), teacherId: teacher.id }).returning();
    const [otherSection] = await db.insert(sections).values({ tenantId: other.id, nameAr: 'حلقة أخرى', joinCode: code('N'), teacherId: otherTeacher.id }).returning();
    await db.insert(sectionEnrollments).values([{ sectionId: section.id, studentId: student.id }, { sectionId: otherSection.id, studentId: otherStudent.id }]);
    await db.insert(guardianLinks).values({ studentId: student.id, guardianId: guardian.id });
    Object.assign(ids, { tenant: tenant.id, other: other.id, section: section.id, otherSection: otherSection.id, student: student.id, otherStudent: otherStudent.id, teacher: teacher.id, otherTeacher: otherTeacher.id });
    Object.assign(tokens, {
      dean: tok(dean), advisor: tok(advisor), teacher: tok(teacher), student: tok(student), guardian: tok(guardian),
      otherDean: tok(otherDean), otherTeacher: tok(otherTeacher), otherStudent: tok(otherStudent),
    });
  });

  afterAll(async () => {
    setLiveGateway(null);
    setStorage(null);
    await app?.close();
    await closeDb();
  });

  it('is configured by the institution managers only', async () => {
    for (const who of ['teacher', 'student', 'advisor', 'guardian']) {
      expect((await call(who, 'GET', '/admin/modules')).statusCode).toBe(403);
      expect((await put('badges', { enabled: false }, who)).statusCode).toBe(403);
    }
  });

  it('lists every module with its state and settings', async () => {
    const res = (await call('dean', 'GET', '/admin/modules')).json();
    expect(res.modules.map((m: { key: string }) => m.key)).toEqual([...MODULE_KEYS]);
    const review = res.modules.find((m: { key: string }) => m.key === 'review');
    expect(review).toMatchObject({ core: true, enabled: true });
    expect(review.settings[0]).toMatchObject({ key: 'newPerDay', value: DEFAULT_NEW_PER_DAY, default: DEFAULT_NEW_PER_DAY, custom: false, min: 1, max: 50 });
    expect(res.modules.find((m: { key: string }) => m.key === 'lessons')).toMatchObject({ dependsOn: ['recitation'], enabled: true, blockedBy: null });
    expect(res.modules.find((m: { key: string }) => m.key === 'ai_checking').availability).toMatchObject({ ok: false }); // the free plan, and no speech provider
    expect(res.modules.find((m: { key: string }) => m.key === 'badges').availability).toBeNull();
  });

  it('refuses what cannot be changed', async () => {
    expect((await put('review', { enabled: false })).statusCode).toBe(400); // core
    expect((await put('nonsense', { enabled: false })).statusCode).toBe(404);
    expect((await put('live', {})).statusCode).toBe(400);
    expect((await put('live', { config: { recordingMaxMb: 5 } })).statusCode).toBe(400); // below the least
    expect((await put('live', { config: { recordingMaxMb: 5000 } })).statusCode).toBe(400);
    expect((await put('live', { config: { recordingAllowed: 'yes' } })).statusCode).toBe(400);
    expect((await put('live', { config: { nothing: 1 } })).statusCode).toBe(400);
    expect((await put('live', { reset: ['nothing'] })).statusCode).toBe(400);
    expect((await put('review', { config: { newPerDay: 0 } })).statusCode).toBe(400);
  });

  it('tells every screen which modules are on, through the sign-in profile', async () => {
    const me = (await call('student', 'GET', '/auth/me')).json();
    expect(me.modules.recitation).toMatchObject({ enabled: true, config: { maxAttempts: MAX_ATTEMPTS } });
    expect(me.modules.ai_checking.enabled).toBe(false);
    expect(Object.keys(me.modules)).toEqual([...MODULE_KEYS]);
  });

  /** One route of each guarded module, asked as a student: the guard answers before anything else does. */
  const SAMPLES: [string, () => string][] = [
    ['recitation', () => '/tasmi'], ['lessons', () => '/lessons/mine'], ['live', () => '/live/now'], ['mutashabihat', () => '/mutashabihat/mine'],
    ['attendance', () => `/sections/${ids.section}/attendance`], ['monthly_record', () => `/reports/student/${ids.student}/monthly`],
    ['badges', () => '/badges'], ['guardians', () => '/guardian/students'], ['notifications', () => '/notifications'],
    ['program', () => `/sections/${ids.section}/program`],
  ];

  it('refuses the routes of a module that is switched off, for that institution only, and serves them again when it is back on', async () => {
    for (const [key, url] of SAMPLES) {
      const before = await call('student', 'GET', url());
      expect(before.json().code, `${key} should be on`).not.toBe('MODULE_DISABLED');
      expect((await put(key, { enabled: false })).statusCode).toBe(200);
      const off = await call('student', 'GET', url());
      expect(off.statusCode, key).toBe(403);
      expect(off.json()).toMatchObject({ code: 'MODULE_DISABLED' });
      // Another institution is not affected.
      const elsewhere = await call('otherStudent', 'GET', url().replace(ids.section, ids.otherSection).replace(ids.student, ids.otherStudent));
      expect(elsewhere.json().code, `${key} elsewhere`).not.toBe('MODULE_DISABLED');
      expect((await moduleOf(key)).enabled).toBe(false);
      expect((await put(key, { enabled: true })).statusCode).toBe(200);
      expect((await call('student', 'GET', url())).json().code, `${key} back on`).not.toBe('MODULE_DISABLED');
    }
  });

  it('keeps the admin screens for a module reachable only while it is on, and always lets the admin switch it back', async () => {
    await put('program', { enabled: false });
    expect((await call('dean', 'GET', '/admin/programs')).json().code).toBe('MODULE_DISABLED');
    expect((await put('program', { enabled: true })).statusCode).toBe(200);
    expect((await call('dean', 'GET', '/admin/programs')).statusCode).toBe(200);
  });

  it('turns off what depends on a module with it, and says why', async () => {
    await put('recitation', { enabled: false });
    expect((await call('student', 'GET', '/lessons/mine')).json().code).toBe('MODULE_DISABLED');
    expect((await call('student', 'GET', `/reports/student/${ids.student}/monthly`)).json().code).toBe('MODULE_DISABLED');
    expect(await moduleOf('lessons')).toMatchObject({ enabled: false, requested: true, blockedBy: 'recitation' });
    const me = (await call('student', 'GET', '/auth/me')).json();
    expect(me.modules).toMatchObject({ recitation: { enabled: false }, lessons: { enabled: false }, monthly_record: { enabled: false }, live: { enabled: true } });
    await put('recitation', { enabled: true });
    expect((await moduleOf('lessons')).enabled).toBe(true);
  });

  it('keeps settings between switching a module off and on, and puts them back to the default on request', async () => {
    await put('live', { config: { recordingRetentionDays: 30 } });
    await put('live', { enabled: false });
    await put('live', { enabled: true });
    const kept = (await moduleOf('live')).settings.find((s: { key: string }) => s.key === 'recordingRetentionDays');
    expect(kept).toMatchObject({ value: 30, custom: true, default: config.LIVE_RECORDING_RETENTION_DAYS });
    await put('live', { reset: ['recordingRetentionDays'] });
    expect((await moduleOf('live')).settings.find((s: { key: string }) => s.key === 'recordingRetentionDays')).toMatchObject({ value: config.LIVE_RECORDING_RETENTION_DAYS, custom: false });
  });

  it('switches AI checking only where the plan includes it', async () => {
    const res = await put('ai_checking', { enabled: true });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('PLAN_FEATURE_NOT_INCLUDED');
    await getDb().update(tenants).set({ planTier: 'madrasa_pro' }).where(eq(tenants.id, ids.tenant));
    expect((await put('ai_checking', { enabled: true })).statusCode).toBe(200);
    expect((await call('student', 'GET', '/auth/me')).json().modules.ai_checking.enabled).toBe(true);
    expect((await put('ai_checking', { enabled: false })).statusCode).toBe(200);
    expect((await call('student', 'GET', '/auth/me')).json().modules.ai_checking.enabled).toBe(false);
    await getDb().update(tenants).set({ planTier: 'free' }).where(eq(tenants.id, ids.tenant));
  });

  it('applies the default pace of new verses to students whose teacher set none', async () => {
    const plan = () => call('teacher', 'GET', `/sections/${ids.section}/students/${ids.student}/plan`).then((r) => r.json().newPerDay);
    expect(await plan()).toBe(DEFAULT_NEW_PER_DAY);
    await put('review', { config: { newPerDay: 7 } });
    expect(await plan()).toBe(7);
    await call('teacher', 'PUT', `/sections/${ids.section}/students/${ids.student}/plan/pace`, { newPerDay: 4 });
    await put('review', { config: { newPerDay: 12 } });
    expect(await plan()).toBe(4); // her teacher's choice wins
    await getDb().update(users).set({ newAyatPerDay: null }).where(eq(users.id, ids.student));
    expect(await plan()).toBe(12);
    await put('review', { reset: ['newPerDay'] });
  });

  it('limits how many verses one recording or lesson may cover', async () => {
    await getDb().insert((await import('../db/schema')).consents).values({ userId: ids.student, purpose: 'voice_recording', grantedAt: new Date() });
    await put('recitation', { config: { maxAyatPerRecording: 10 } });
    const tasmi = (end: string) => postMultipart('student', '/tasmi', { startRef: '78:1', endRef: end, sectionId: ids.section });
    const said = (r: { json: () => { detail?: string; message?: string } }) => r.json().detail ?? r.json().message ?? '';
    expect(said(await tasmi('78:11'))).toContain('at most 10 ayat'); // 11 verses
    expect(said(await tasmi('78:10'))).not.toContain('at most'); // 10 verses pass this check (and stop at the missing audio)
    const lesson = (end: string) => postMultipart('teacher', `/sections/${ids.section}/lessons`, { startRef: '78:1', endRef: end });
    expect(said(await lesson('78:11'))).toContain('at most 10 ayat');
    await put('recitation', { reset: ['maxAyatPerRecording'] });
    expect(said(await tasmi('78:11'))).not.toContain('at most');
  });

  it('lets an institution allow fewer or more attempts at the same verses', async () => {
    const db = getDb();
    const [row] = await db.insert(tasmiSubmissions).values({
      studentId: ids.student, sectionId: ids.section, startRef: '78:1', endRef: '78:3', attempt: 2, reviewVerdict: 'redo', reviewedAt: new Date(),
    }).returning();
    const read = async () => (await call('student', 'GET', '/tasmi')).json().find((t: { id: string }) => t.id === row.id);
    expect(await read()).toMatchObject({ maxAttempts: 3, status: 'revision_requested', canRevise: true });
    await put('recitation', { config: { maxAttempts: 2 } });
    expect(await read()).toMatchObject({ maxAttempts: 2, status: 'final_graded', canRevise: false });
    await put('recitation', { config: { maxAttempts: 5 } });
    expect(await read()).toMatchObject({ maxAttempts: 5, status: 'revision_requested', canRevise: true });
    await put('recitation', { reset: ['maxAttempts'] });
  });

  it('keeps recitation audio for as long as each institution says', async () => {
    const db = getDb();
    const longAgo = new Date(Date.now() - 3 * 3_600_000);
    const make = async (studentId: string, sectionId: string) => {
      const key = `tasmi/${randomUUID()}.webm`;
      await storage.put(key, Buffer.from('audio'), 'audio/webm');
      const [row] = await db.insert(tasmiSubmissions).values({
        studentId, sectionId, startRef: '78:1', endRef: '78:3', audioKey: key, reviewVerdict: 'approved', reviewedAt: longAgo, submittedAt: longAgo,
      }).returning();
      return { id: row.id, key };
    };
    const mine = await make(ids.student, ids.section);
    const theirs = await make(ids.otherStudent, ids.otherSection);
    await put('recitation', { config: { audioRetentionHours: 1 } }); // this institution keeps it an hour after review; the other keeps the default
    await purgeExpiredAudio(db);
    expect(await storage.get(mine.key)).toBeNull();
    expect((await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, mine.id)))[0].audioDeletedAt).not.toBeNull();
    expect(await storage.get(theirs.key)).not.toBeNull();
    await put('recitation', { reset: ['audioRetentionHours'] });
  });

  describe('live lessons', () => {
    const startLesson = async () => (await call('teacher', 'POST', `/sections/${ids.section}/live`, { title: 'درس' })).json().id as string;

    it('lets an institution switch recording off, and tells the room', async () => {
      await put('live', { config: { recordingAllowed: false } });
      const id = await startLesson();
      expect((await call('teacher', 'GET', `/live/${id}/state`)).json().recordingAllowed).toBe(false);
      const res = await call('teacher', 'POST', `/live/${id}/recording/start`);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('RECORDING_NOT_ALLOWED');
      await put('live', { config: { recordingAllowed: true } });
      expect((await call('teacher', 'GET', `/live/${id}/state`)).json().recordingAllowed).toBe(true);
      expect((await call('teacher', 'POST', `/live/${id}/recording/start`)).statusCode).toBe(200);
      await call('teacher', 'POST', `/live/${id}/end`);
      ids.lesson = id;
    });

    it('stops a recording at the institution’s size limit', async () => {
      await put('live', { config: { recordingMaxMb: 50 } });
      const id = await startLesson();
      await call('teacher', 'POST', `/live/${id}/recording/start`);
      const chunk = (seq: number) => {
        const boundary = `----itqan${randomUUID()}`;
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="seq"\r\n\r\n${seq}\r\n--${boundary}\r\nContent-Disposition: form-data; name="chunk"; filename="c"\r\nContent-Type: video/webm\r\n\r\n`),
          Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]), Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);
        return app.inject({ method: 'POST', url: `/v1/live/${id}/recording/chunks`, headers: { authorization: `Bearer ${tokens.teacher}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
      };
      expect((await chunk(0)).statusCode).toBe(200);
      await getDb().update(liveSessions).set({ recordingBytes: 50 * 1024 * 1024 - 2 }).where(eq(liveSessions.id, id));
      const res = await chunk(1);
      expect(res.statusCode).toBe(413);
      expect(res.json().code).toBe('RECORDING_FULL');
      await call('teacher', 'POST', `/live/${id}/end`);
      await put('live', { reset: ['recordingMaxMb'] });
    });

    it('keeps recordings for as long as each institution says', async () => {
      const db = getDb();
      const tenOldDays = new Date(Date.now() - 10 * 86_400_000);
      const make = async (sectionId: string, teacherId: string) => {
        const key = `sessions/${sectionId}/${randomUUID()}.webm`;
        await storage.put(key, Buffer.from('video'), 'video/webm');
        const [s] = await db.insert(liveSessions).values({
          sectionId, teacherId, title: 'قديم', status: 'ended', roomName: `r-${randomUUID()}`, recordingStatus: 'ready', recordingKey: key, recordingBytes: 5, recordingReadyAt: tenOldDays,
        }).returning();
        return { id: s.id, key };
      };
      const mine = await make(ids.section, ids.teacher);
      const theirs = await make(ids.otherSection, ids.otherTeacher);
      await put('live', { config: { recordingRetentionDays: 7 } });
      await purgeExpiredRecordings(db);
      expect(await storage.get(mine.key)).toBeNull();
      expect((await db.select().from(liveSessions).where(eq(liveSessions.id, mine.id)))[0].recordingStatus).toBe('deleted');
      expect(await storage.get(theirs.key)).not.toBeNull(); // 90 days by default
      expect((await db.select().from(liveSessions).where(eq(liveSessions.id, theirs.id)))[0].recordingStatus).toBe('ready');
      await put('live', { reset: ['recordingRetentionDays'] });
    });
  });

  it('records each change in the audit log', async () => {
    const entries = (await call('dean', 'GET', '/admin/audit?action=module.updated&limit=100')).json().entries;
    expect(entries.length).toBeGreaterThan(5);
    expect(entries[0]).toMatchObject({ action: 'module.updated', actorName: 'العميدة', resource: 'tenant' });
    expect(entries.some((e: { details: { module: string; enabled?: boolean } }) => e.details.module === 'badges' && e.details.enabled === false)).toBe(true);
  });
});
