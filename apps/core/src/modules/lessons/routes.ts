/**
 * «آيات للحفظ»: a teacher records verses for her halaqa; her students listen, memorize, and recite them back.
 * The recording is stored with the same storage as recitations and is reached through short-lived links.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { compareRefs, countAyat, parseRef } from '@itqan/quran';
import { getDb } from '../../db';
import { recitationLessons, sectionEnrollments, sections, tasmiSubmissions, users } from '../../db/schema';
import { loadManagedSection } from '../../lib/access';
import { MAX_AUDIO_BYTES, sniffAudio } from '../../lib/audio';
import { AUDIO_LINK_TTL, streamAudio, validLinkToken } from '../../lib/audio-link';
import { addToPlan } from '../../lib/hifz-plan';
import { generateToken, type TokenPayload } from '../../lib/jwt';
import { getStorage } from '../../lib/storage';
import { auditLog } from '../audit/service';
import { MAX_SUBMISSION_AYAT } from '../assessment/routes';

const MAX_NOTE = 500;
const MAX_LISTED = 50;

type Lesson = typeof recitationLessons.$inferSelect;

/** What clients see: never the storage key. */
function serialize(lesson: Lesson) {
  const { audioKey, audioContentType, audioBytes, ...rest } = lesson;
  return rest;
}

export async function lessonRoutes(app: FastifyInstance) {
  const db = getDb();

  const activeStudents = async (sectionId: string) => (await db.select({ id: sectionEnrollments.studentId })
    .from(sectionEnrollments)
    .where(and(eq(sectionEnrollments.sectionId, sectionId), isNull(sectionEnrollments.droppedAt)))).map((r) => r.id);

  /** Whether the caller is an active student of the section. */
  const isEnrolled = async (user: TokenPayload, sectionId: string) => {
    const [row] = await db.select({ id: sectionEnrollments.id }).from(sectionEnrollments)
      .where(and(
        eq(sectionEnrollments.sectionId, sectionId), eq(sectionEnrollments.studentId, user.sub), isNull(sectionEnrollments.droppedAt),
      )).limit(1);
    return Boolean(row);
  };

  // POST /v1/sections/:id/lessons — multipart: startRef, endRef, note?, durationMs?, addToPlan?, then the `audio` file
  app.post('/sections/:id/lessons', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user;
    const errors = request.server.httpErrors;
    const section = await loadManagedSection(db, user, id);
    if (!section || !section.active) return errors.notFound('Section not found');
    if (!request.isMultipart()) return errors.badRequest('Send multipart/form-data');

    const fields: Record<string, string> = {};
    let audio: Buffer | null = null;
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'audio' || audio) { part.file.resume(); continue; }
          audio = await part.toBuffer(); // throws if larger than the multipart limit
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value;
        }
      }
    } catch {
      return errors.payloadTooLarge('Recording is too large');
    }

    const start = parseRef(fields.startRef ?? '');
    const end = parseRef(fields.endRef ?? '');
    if (!start || !end) return errors.badRequest('Invalid verse reference');
    // One sura at a time, and no longer than a student may recite back in one recording.
    if (start[0] !== end[0]) return errors.badRequest('A lesson covers verses of one sura');
    if (compareRefs(start, end) > 0) return errors.badRequest('The range ends before it starts');
    if (countAyat(start, end) > MAX_SUBMISSION_AYAT) return errors.badRequest(`A lesson can cover at most ${MAX_SUBMISSION_AYAT} ayat`);
    const note = fields.note?.trim() || null;
    if (note && note.length > MAX_NOTE) return errors.badRequest(`A note can be at most ${MAX_NOTE} characters`);
    const durationMs = fields.durationMs ? Number(fields.durationMs) : undefined;
    if (durationMs !== undefined && (!Number.isInteger(durationMs) || durationMs < 0)) return errors.badRequest('Invalid duration');

    if (!audio || audio.length === 0) return errors.badRequest('No recording attached');
    if (audio.length > MAX_AUDIO_BYTES) return errors.payloadTooLarge('Recording is too large');
    const kind = sniffAudio(audio);
    if (!kind) return errors.unsupportedMediaType('That file is not an audio recording');

    const lessonId = randomUUID();
    const key = `lessons/${section.id}/${lessonId}.${kind.ext}`;
    await getStorage().put(key, audio, kind.mime);
    const [lesson] = await db.insert(recitationLessons).values({
      id: lessonId, sectionId: section.id, teacherId: user.sub, startRef: fields.startRef, endRef: fields.endRef, note,
      audioKey: key, audioContentType: kind.mime, audioBytes: audio.length, durationMs: durationMs ?? null,
    }).returning();

    // Optionally put the verses in every student's plan as new memorization; verses she already has are left alone.
    let planned = 0;
    if (fields.addToPlan === 'true') {
      const ayat = Array.from({ length: end[1] - start[1] + 1 }, (_, i) => `${start[0]}:${start[1] + i}`);
      for (const studentId of await activeStudents(section.id)) planned += (await addToPlan(db, studentId, ayat, 'new')).added;
    }

    await auditLog({
      actorId: user.sub, actorRole: user.role, action: 'lesson.created',
      targetType: 'section', targetId: section.id, metadata: { lessonId, startRef: lesson.startRef, endRef: lesson.endRef, planned },
    });
    return reply.code(201).send({ ...serialize(lesson), planned });
  });

  // GET /v1/sections/:id/lessons — for whoever manages the halaqa: each lesson and how many students recited it
  app.get('/sections/:id/lessons', { preHandler: [app.authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const section = await loadManagedSection(db, request.user, id);
    if (!section) return request.server.httpErrors.notFound('Section not found');

    const lessons = await db.select().from(recitationLessons)
      .where(eq(recitationLessons.sectionId, id)).orderBy(desc(recitationLessons.createdAt)).limit(MAX_LISTED);
    const students = await activeStudents(id);
    const recited = lessons.length && students.length
      ? await db.select({ lessonId: tasmiSubmissions.lessonId, studentId: tasmiSubmissions.studentId }).from(tasmiSubmissions)
        .where(and(inArray(tasmiSubmissions.lessonId, lessons.map((l) => l.id)), inArray(tasmiSubmissions.studentId, students)))
      : [];
    // A student who recited a lesson twice counts once.
    const byLesson = new Map<string, Set<string>>();
    for (const r of recited) byLesson.set(r.lessonId!, (byLesson.get(r.lessonId!) ?? new Set()).add(r.studentId));
    return lessons.map((l) => ({ ...serialize(l), students: students.length, recited: byLesson.get(l.id)?.size ?? 0 }));
  });

  // GET /v1/lessons/mine — the student: lessons of her halaqat, newest first, with her own latest recitation of each
  app.get('/lessons/mine', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user;
    const mine = await db.select({ sectionId: sectionEnrollments.sectionId }).from(sectionEnrollments)
      .innerJoin(sections, eq(sectionEnrollments.sectionId, sections.id))
      .where(and(eq(sectionEnrollments.studentId, user.sub), isNull(sectionEnrollments.droppedAt), eq(sections.active, true)));
    if (mine.length === 0) return [];

    const rows = await db.select({ lesson: recitationLessons, teacherName: users.displayNameAr, sectionName: sections.nameAr })
      .from(recitationLessons)
      .innerJoin(sections, eq(recitationLessons.sectionId, sections.id))
      .leftJoin(users, eq(recitationLessons.teacherId, users.id))
      .where(inArray(recitationLessons.sectionId, mine.map((m) => m.sectionId)))
      .orderBy(desc(recitationLessons.createdAt)).limit(MAX_LISTED);
    if (rows.length === 0) return [];

    const recitations = await db.select({
      id: tasmiSubmissions.id, lessonId: tasmiSubmissions.lessonId, submittedAt: tasmiSubmissions.submittedAt,
      verdict: tasmiSubmissions.reviewVerdict, total: tasmiSubmissions.reviewWeightedTotal,
    }).from(tasmiSubmissions)
      .where(and(eq(tasmiSubmissions.studentId, user.sub), inArray(tasmiSubmissions.lessonId, rows.map((r) => r.lesson.id))))
      .orderBy(desc(tasmiSubmissions.submittedAt));
    const latest = new Map<string, typeof recitations[number]>();
    for (const r of recitations) if (!latest.has(r.lessonId!)) latest.set(r.lessonId!, r);

    return rows.map((r) => {
      const mineOfLesson = latest.get(r.lesson.id);
      return {
        ...serialize(r.lesson), teacherName: r.teacherName, sectionName: r.sectionName,
        myRecitation: mineOfLesson
          ? { id: mineOfLesson.id, submittedAt: mineOfLesson.submittedAt, verdict: mineOfLesson.verdict, total: mineOfLesson.total }
          : null,
      };
    });
  });

  // GET /v1/lessons/:id/audio-link — short-lived link, for the halaqa's students and whoever manages it (not guardians)
  app.get('/lessons/:id/audio-link', { preHandler: [app.authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const [lesson] = z.string().uuid().safeParse(id).success
      ? await db.select().from(recitationLessons).where(eq(recitationLessons.id, id)).limit(1) : [];
    const allowed = lesson && (await isEnrolled(request.user, lesson.sectionId) || await loadManagedSection(db, request.user, lesson.sectionId));
    if (!lesson || !allowed) return request.server.httpErrors.notFound('Lesson not found');
    const token = generateToken({ sub: id, role: 'audio', purpose: 'lesson-audio' }, AUDIO_LINK_TTL);
    return { url: `/v1/lessons/${id}/audio?token=${encodeURIComponent(token)}` };
  });

  // GET /v1/lessons/:id/audio?token= — streams the teacher's recording (supports Range for seeking)
  app.get('/lessons/:id/audio', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { token } = request.query as { token?: string };
    if (!validLinkToken(token, 'lesson-audio', id)) return request.server.httpErrors.unauthorized('Link expired');
    const [lesson] = await db.select().from(recitationLessons).where(eq(recitationLessons.id, id)).limit(1);
    if (!lesson) return request.server.httpErrors.notFound('Lesson not found');
    return streamAudio(request, reply, lesson.audioKey, lesson.audioBytes);
  });

  // DELETE /v1/lessons/:id — the teacher removes a lesson and its recording; students' recitations of it stay
  app.delete('/lessons/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [lesson] = z.string().uuid().safeParse(id).success
      ? await db.select().from(recitationLessons).where(eq(recitationLessons.id, id)).limit(1) : [];
    if (!lesson || !(await loadManagedSection(db, request.user, lesson.sectionId))) {
      return request.server.httpErrors.notFound('Lesson not found');
    }
    await getStorage().delete(lesson.audioKey);
    await db.delete(recitationLessons).where(eq(recitationLessons.id, id));
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'lesson.deleted',
      targetType: 'section', targetId: lesson.sectionId, metadata: { lessonId: id },
    });
    return reply.code(204).send();
  });
}
