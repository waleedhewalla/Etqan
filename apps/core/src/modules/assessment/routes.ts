import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, isNull, inArray, sql } from 'drizzle-orm';
import { AYAH_COUNTS, compareRefs, countAyat, parseRef } from '@itqan/quran';
import { getDb, type Database } from '../../db';
import { liveSessions, recitationLessons, sectionEnrollments, sections, tasmiSubmissions, users } from '../../db/schema';
import { canViewStudent, isStaff, isTenantAdmin } from '../../lib/access';
import { MAX_AUDIO_BYTES, sniffAudio } from '../../lib/audio';
import { hasConsent } from '../../lib/consent';
import { awardBadges } from '../../lib/badges';
import { ayatBetween, gradeRecitation } from '../../lib/grading';
import { ConsentRequiredError } from '../../lib/errors';
import { generateToken } from '../../lib/jwt';
import { getStorage } from '../../lib/storage';
import { AUDIO_LINK_TTL, streamAudio, validLinkToken } from '../../lib/audio-link';
import { isCheckEnabled, scheduleAsrCheck } from '../../lib/asr/runner';
import type { FlaggedWord } from '../../lib/asr/types';
import { MAX_ATTEMPTS, canRevise, tasmiStatus } from '../../lib/tasmi-status';
import { moduleConfig } from '../../lib/modules';
import type { TokenPayload } from '../../lib/jwt';
import { auditLog } from '../audit/service';

/** Longest recitation a single recording may cover. */
export const MAX_SUBMISSION_AYAT = 60;
/** The most attempts an institution may allow (see the recitation module's settings); walking a chain never goes past it. */
const MAX_ATTEMPTS_CEILING = 5;

type Submission = typeof tasmiSubmissions.$inferSelect;

/** What clients may see: never the storage key or a raw URL, only whether a recording exists. */
function serializeTasmi(row: Submission, hasLaterAttempt: boolean, maxAttempts: number) {
  const { audioKey, audioUrl, audioContentType, audioBytes, replyAudioKey, replyAudioContentType, replyAudioBytes, ...rest } = row;
  const facts = {
    verdict: row.reviewVerdict, attempt: row.attempt, hasLaterAttempt, reviewStartedAt: row.reviewStartedAt,
    hasReply: Boolean(row.reviewNotes || row.replyAt),
  };
  return {
    ...rest, hasAudio: Boolean(audioKey) && !row.audioDeletedAt, audioBytes, hasReplyAudio: Boolean(replyAudioKey),
    status: tasmiStatus(facts, maxAttempts), canRevise: canRevise(facts, maxAttempts), maxAttempts,
  };
}

/** The titles of the recorded lessons these submissions answer, by lesson id. */
async function lessonTitles(db: Database, rows: Submission[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.liveSessionId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const found = await db.select({ id: liveSessions.id, title: liveSessions.title }).from(liveSessions).where(inArray(liveSessions.id, ids));
  return new Map(found.map((f) => [f.id, f.title]));
}

/** Of these submissions, the ones a later attempt has replaced. */
async function replacedIds(db: Database, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.select({ of: tasmiSubmissions.revisionOf }).from(tasmiSubmissions)
    .where(inArray(tasmiSubmissions.revisionOf, ids));
  return new Set(rows.map((r) => r.of!));
}

/** Longest text reply a teacher may write. */
const MAX_REPLY_TEXT = 2000;

const reviewTasmiSchema = z.object({
  /** The teacher's call on each AI flag, by flag id. */
  flagDecisions: z.record(z.enum(['confirmed', 'dismissed'])).optional(),
  hifzScore: z.number().min(0).max(100),
  tajweedScore: z.number().min(0).max(100),
  fluencyScore: z.number().min(0).max(100),
  verdict: z.enum(['approved', 'redo', 'flagged']),
  notes: z.string().optional(),
});

export async function assessmentRoutes(app: FastifyInstance) {
  const db = getDb();

  /** The institution's recitation settings for the signed-in user: how often a recitation may be redone, and how long one may be. */
  const limitsFor = async (user: TokenPayload) => {
    if (!user.facultyId) return { maxAttempts: MAX_ATTEMPTS, maxAyat: MAX_SUBMISSION_AYAT };
    const c = await moduleConfig(user.facultyId, 'recitation');
    return { maxAttempts: Number(c.maxAttempts), maxAyat: Number(c.maxAyatPerRecording) };
  };

  // POST /v1/tasmi — multipart: fields startRef, endRef, sectionId, durationMs, then the `audio` file
  app.post('/tasmi', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const user = request.user;
    const errors = request.server.httpErrors;
    if (user.role !== 'student') return errors.forbidden('Only students submit recitations');
    if (!request.isMultipart()) return errors.badRequest('Send multipart/form-data');

    // Consent comes before reading any audio.
    if (!(await hasConsent(db, user.sub, 'voice_recording'))) throw new ConsentRequiredError('voice_recording');

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
    if (compareRefs(start, end) > 0) return errors.badRequest('The range ends before it starts');
    const limits = await limitsFor(user);
    if (countAyat(start, end) > limits.maxAyat) {
      return errors.badRequest(`A recording can cover at most ${limits.maxAyat} ayat`);
    }
    if (!z.string().uuid().safeParse(fields.sectionId).success) return errors.badRequest('Choose a halaqa');
    const durationMs = fields.durationMs ? Number(fields.durationMs) : undefined;
    if (durationMs !== undefined && (!Number.isInteger(durationMs) || durationMs < 0)) {
      return errors.badRequest('Invalid duration');
    }

    const [enrolled] = await db.select({ id: sectionEnrollments.id }).from(sectionEnrollments)
      .where(and(
        eq(sectionEnrollments.sectionId, fields.sectionId),
        eq(sectionEnrollments.studentId, user.sub),
        isNull(sectionEnrollments.droppedAt),
      )).limit(1);
    if (!enrolled) return errors.badRequest('You are not in this halaqa');

    // A recitation of the teacher's «آيات للحفظ» must be for that lesson's halaqa and its verses.
    let lessonId: string | null = null;
    if (fields.lessonId) {
      const [lesson] = z.string().uuid().safeParse(fields.lessonId).success
        ? await db.select().from(recitationLessons).where(eq(recitationLessons.id, fields.lessonId)).limit(1)
        : [];
      if (!lesson || lesson.sectionId !== fields.sectionId) return errors.badRequest('That lesson is not in this halaqa');
      if (lesson.startRef !== fields.startRef || lesson.endRef !== fields.endRef) {
        return errors.badRequest('Recite the verses of the lesson');
      }
      lessonId = lesson.id;
    }

    // A recitation of a recorded live lesson's verses: the lesson must be this halaqa's and the verses its own.
    let liveSessionId: string | null = null;
    if (fields.liveSessionId) {
      if (lessonId) return errors.badRequest('Choose a lesson or a recorded lesson, not both');
      const [session] = z.string().uuid().safeParse(fields.liveSessionId).success
        ? await db.select().from(liveSessions).where(eq(liveSessions.id, fields.liveSessionId)).limit(1)
        : [];
      if (!session || session.sectionId !== fields.sectionId || session.status !== 'ended') {
        return errors.badRequest('That lesson is not in this halaqa');
      }
      if (session.startRef !== fields.startRef || session.endRef !== fields.endRef) return errors.badRequest('Recite the verses of the lesson');
      liveSessionId = session.id;
    }

    // Recording again after «يُعاد»: the new attempt replaces the previous one and carries its lesson.
    let attempt = 1;
    let revisionOf: string | null = null;
    if (fields.revisionOf) {
      const [previous] = z.string().uuid().safeParse(fields.revisionOf).success
        ? await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, fields.revisionOf)).limit(1)
        : [];
      if (!previous || previous.studentId !== user.sub) return errors.badRequest('That recitation is not yours');
      if (previous.startRef !== fields.startRef || previous.endRef !== fields.endRef || previous.sectionId !== fields.sectionId) {
        return errors.badRequest('Record the same verses again');
      }
      const replaced = (await replacedIds(db, [previous.id])).has(previous.id);
      const facts = {
        verdict: previous.reviewVerdict, attempt: previous.attempt, hasLaterAttempt: replaced,
        reviewStartedAt: previous.reviewStartedAt, hasReply: true,
      };
      if (!canRevise(facts, limits.maxAttempts)) return errors.conflict('This recitation is not waiting to be recorded again');
      attempt = previous.attempt + 1;
      revisionOf = previous.id;
      lessonId = previous.lessonId;
      liveSessionId = previous.liveSessionId;
    }

    if (!audio || audio.length === 0) return errors.badRequest('No recording attached');
    if (audio.length > MAX_AUDIO_BYTES) return errors.payloadTooLarge('Recording is too large');
    const kind = sniffAudio(audio);
    if (!kind) return errors.unsupportedMediaType('That file is not an audio recording');

    const checkAi = await isCheckEnabled(db, user.facultyId, user.sub);
    const id = randomUUID();
    const key = `tasmi/${user.sub}/${id}.${kind.ext}`;
    await getStorage().put(key, audio, kind.mime);

    const [row] = await db.insert(tasmiSubmissions).values({
      id,
      studentId: user.sub,
      sectionId: fields.sectionId,
      startRef: fields.startRef,
      endRef: fields.endRef,
      audioKey: key,
      audioContentType: kind.mime,
      audioBytes: audio.length,
      durationMs,
      lessonId,
      liveSessionId,
      revisionOf,
      attempt,
      aiStatus: checkAi ? 'pending' : null,
    }).returning();
    if (checkAi) scheduleAsrCheck(db, row.id);
    return serializeTasmi(row, false, limits.maxAttempts);
  });

  // GET /v1/tasmi/:id/audio-link — short-lived link to the recording (student herself or her staff, not guardians)
  app.get('/tasmi/:id/audio-link', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.user;
    const [row] = await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, id)).limit(1);
    const allowed = row && (user.sub === row.studentId || (isStaff(user) && await canViewStudent(db, user, row.studentId)));
    if (!row || !allowed || !row.audioKey || row.audioDeletedAt) {
      return request.server.httpErrors.notFound('Recording not found');
    }
    await auditLog({
      actorId: user.sub, actorRole: user.role, action: 'tasmi.audio.view',
      targetType: 'tasmi_submission', targetId: id, ip: request.ip,
    });
    // The first time a teacher opens it, the student sees it move to "under review".
    if (user.sub !== row.studentId && !row.reviewStartedAt && !row.reviewVerdict) {
      await db.update(tasmiSubmissions).set({ reviewStartedAt: new Date() }).where(eq(tasmiSubmissions.id, id));
    }
    const token = generateToken({ sub: id, role: 'audio', purpose: 'audio' }, AUDIO_LINK_TTL);
    return { url: `/v1/tasmi/${id}/audio?token=${encodeURIComponent(token)}` };
  });

  // GET /v1/tasmi/:id/audio?token= — streams the recording (supports Range for seeking)
  app.get('/tasmi/:id/audio', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { token } = request.query as { token?: string };
    if (!validLinkToken(token, 'audio', id)) return request.server.httpErrors.unauthorized('Link expired');

    const [row] = await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, id)).limit(1);
    if (!row?.audioKey || row.audioDeletedAt) return request.server.httpErrors.notFound('Recording not found');
    return streamAudio(request, reply, row.audioKey, row.audioBytes);
  });

  // DELETE /v1/tasmi/:id/audio — the student removes her own recording; scores and notes stay
  app.delete('/tasmi/:id/audio', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user;
    const [row] = await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, id)).limit(1);
    if (!row || row.studentId !== user.sub || !row.audioKey || row.audioDeletedAt) {
      return request.server.httpErrors.notFound('Recording not found');
    }
    await getStorage().delete(row.audioKey);
    await db.update(tasmiSubmissions)
      .set({ audioKey: null, audioDeletedAt: new Date() })
      .where(eq(tasmiSubmissions.id, id));
    await auditLog({
      actorId: user.sub, actorRole: user.role, action: 'tasmi.audio.delete',
      targetType: 'tasmi_submission', targetId: id, ip: request.ip,
    });
    return reply.code(204).send();
  });

  // GET /v1/tasmi — List the student's own submissions
  app.get('/tasmi', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const rows = await db.select()
      .from(tasmiSubmissions)
      .where(eq(tasmiSubmissions.studentId, userId))
      .orderBy(desc(tasmiSubmissions.submittedAt))
      .limit(50);
    const replaced = await replacedIds(db, rows.map((r) => r.id));
    const { maxAttempts } = await limitsFor(request.user);
    const titles = await lessonTitles(db, rows);
    return rows.map((r) => ({ ...serializeTasmi(r, replaced.has(r.id), maxAttempts), liveSessionTitle: titles.get(r.liveSessionId ?? '') ?? null }));
  });

  // GET /v1/tasmi/pending?sectionId= — unreviewed submissions in the reviewer's halaqat
  app.get('/tasmi/pending', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const user = request.user;
    if (!isStaff(user)) return request.server.httpErrors.forbidden('Staff only');
    const { maxAttempts } = await limitsFor(user);
    const { sectionId } = request.query as { sectionId?: string };

    const managed = await db.select({ id: sections.id }).from(sections)
      .where(isTenantAdmin(user)
        ? eq(sections.tenantId, user.facultyId!)
        : and(eq(sections.tenantId, user.facultyId!), eq(sections.teacherId, user.sub)));
    let sectionIds = managed.map((m) => m.id);
    if (sectionId) sectionIds = sectionIds.filter((id) => id === sectionId);
    if (sectionIds.length === 0) return [];

    const rows = await db.select({ submission: tasmiSubmissions, studentName: users.displayNameAr })
      .from(tasmiSubmissions)
      .innerJoin(users, eq(tasmiSubmissions.studentId, users.id))
      .where(and(inArray(tasmiSubmissions.sectionId, sectionIds), isNull(tasmiSubmissions.reviewVerdict)))
      .orderBy(desc(tasmiSubmissions.submittedAt))
      .limit(50);

    // Submissions the student disputed come first: they are the ones most likely to be wrong.
    const disputed = (s: Submission) => ((s.aiFlaggedErrors ?? []) as FlaggedWord[]).filter((f) => f.disputed).length;
    const titles = await lessonTitles(db, rows.map((r) => r.submission));
    return rows
      .map((r) => ({
        ...serializeTasmi(r.submission, false, maxAttempts), studentName: r.studentName, disputedCount: disputed(r.submission),
        liveSessionTitle: titles.get(r.submission.liveSessionId ?? '') ?? null,
      }))
      .sort((a, b) => b.disputedCount - a.disputedCount);
  });

  // GET /v1/tasmi/:id — the student, her teacher, or an admin
  app.get('/tasmi/:id', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };

    const [submission] = await db.select()
      .from(tasmiSubmissions)
      .where(eq(tasmiSubmissions.id, id))
      .limit(1);

    if (!submission || !(await canViewStudent(db, request.user, submission.studentId))) {
      return request.server.httpErrors.notFound('Submission not found');
    }
    return serializeTasmi(submission, (await replacedIds(db, [id])).has(id), (await limitsFor(request.user)).maxAttempts);
  });

  // GET /v1/tasmi/:id/history — every attempt at these verses, oldest first, with its scores and the teacher's reply
  app.get('/tasmi/:id/history', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const [start] = z.string().uuid().safeParse(id).success
      ? await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, id)).limit(1) : [];
    if (!start || !(await canViewStudent(db, request.user, start.studentId))) {
      return request.server.httpErrors.notFound('Submission not found');
    }
    // Walk back to the first attempt, then forward to the latest. A chain is at most `maxAttempts` long (plus one, in case the limit was lowered).
    const { maxAttempts } = await limitsFor(request.user);
    const chain = [start];
    while (chain[0].revisionOf && chain.length <= MAX_ATTEMPTS_CEILING) {
      const [previous] = await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, chain[0].revisionOf)).limit(1);
      if (!previous) break;
      chain.unshift(previous);
    }
    while (chain.length <= MAX_ATTEMPTS_CEILING) {
      const [next] = await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.revisionOf, chain[chain.length - 1].id)).limit(1);
      if (!next) break;
      chain.push(next);
    }
    return chain.map((row, i) => serializeTasmi(row, i < chain.length - 1, maxAttempts));
  });

  // POST /v1/tasmi/:id/flags/:flagId/dispute — the student says an AI flag is wrong (before review)
  app.post('/tasmi/:id/flags/:flagId/dispute', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id, flagId } = request.params as { id: string; flagId: string };
    const [row] = await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, id)).limit(1);
    if (!row || row.studentId !== request.user.sub) return request.server.httpErrors.notFound('Submission not found');
    if (row.reviewVerdict) return request.server.httpErrors.conflict('This recitation was already reviewed');

    const flags = (row.aiFlaggedErrors ?? []) as FlaggedWord[];
    if (!flags.some((f) => f.id === flagId)) return request.server.httpErrors.notFound('Flag not found');

    const [updated] = await db.update(tasmiSubmissions)
      .set({ aiFlaggedErrors: flags.map((f) => (f.id === flagId ? { ...f, disputed: true } : f)) })
      .where(eq(tasmiSubmissions.id, id)).returning();
    return serializeTasmi(updated, false, (await limitsFor(request.user)).maxAttempts);
  });

  // POST /v1/tasmi/:id/review — Teacher reviews a submission
  app.post('/tasmi/:id/review', {
    schema: { body: reviewTasmiSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const reviewerId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = request.body as z.infer<typeof reviewTasmiSchema>;

    const [existing] = await db.select({
      studentId: tasmiSubmissions.studentId, aiFlaggedErrors: tasmiSubmissions.aiFlaggedErrors,
      reviewVerdict: tasmiSubmissions.reviewVerdict, startRef: tasmiSubmissions.startRef, endRef: tasmiSubmissions.endRef,
    })
      .from(tasmiSubmissions).where(eq(tasmiSubmissions.id, id)).limit(1);
    if (!existing || !isStaff(request.user) || !(await canViewStudent(db, request.user, existing.studentId))) {
      return request.server.httpErrors.notFound('Submission not found');
    }

    // Record the teacher's call on each AI flag; flags she did not mention stay undecided.
    const flags = (existing.aiFlaggedErrors ?? []) as FlaggedWord[];
    const decisions = body.flagDecisions ?? {};
    const decided = flags.map((f) => (decisions[f.id] ? { ...f, decision: decisions[f.id] } : f));

    const weightedTotal = body.hifzScore * 0.5 + body.tajweedScore * 0.3 + body.fluencyScore * 0.2;

    // The verdict and the student's rescheduled revision cards change together or not at all.
    // Cards are rescheduled once: editing a review later must not count twice. A "flagged" review
    // reschedules nothing, so the sheikha's final decision still counts as the first grading.
    const firstReview = existing.reviewVerdict !== 'approved' && existing.reviewVerdict !== 'redo';
    const result = await db.transaction(async (tx) => {
      const [row] = await tx.update(tasmiSubmissions)
        .set({
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          reviewStartedAt: sql`coalesce(${tasmiSubmissions.reviewStartedAt}, now())`,
          reviewHifzScore: body.hifzScore,
          reviewTajweedScore: body.tajweedScore,
          reviewFluencyScore: body.fluencyScore,
          reviewWeightedTotal: weightedTotal,
          reviewVerdict: body.verdict,
          reviewNotes: body.notes,
          aiFlaggedErrors: decided,
        })
        .where(eq(tasmiSubmissions.id, id))
        .returning();
      const graded = row && firstReview
        ? await gradeRecitation(tx as unknown as Database, existing.studentId, {
          verdict: body.verdict,
          hifzScore: body.hifzScore,
          ayat: ayatBetween(existing.startRef, existing.endRef, AYAH_COUNTS),
          flags: decided,
        })
        : 0;
      return { row, graded };
    });

    if (!result.row) return request.server.httpErrors.notFound('Submission not found');
    // Badges after the transaction commits: an approved recitation or newly mastered cards may earn one.
    await awardBadges(db, existing.studentId);
    return { ...serializeTasmi(result.row, (await replacedIds(db, [id])).has(id), (await limitsFor(request.user)).maxAttempts), graded: result.graded };
  });

  // ── The teacher's reply to a recording: text, a recorded voice message, or both ──

  /** The submission, if the caller is staff who may see this student; otherwise null. */
  const loadForStaff = async (request: FastifyRequest, id: string) => {
    if (!z.string().uuid().safeParse(id).success) return null;
    const [row] = await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, id)).limit(1);
    if (!row || !isStaff(request.user) || !(await canViewStudent(db, request.user, row.studentId))) return null;
    return row;
  };

  // POST /v1/tasmi/:id/reply — multipart: optional field `text`, optional field `durationMs`, optional `audio` file.
  // The text is the review note the student already sees; a new voice reply replaces the previous one.
  app.post('/tasmi/:id/reply', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const errors = request.server.httpErrors;
    const row = await loadForStaff(request, id);
    if (!row) return errors.notFound('Submission not found');
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

    const text = fields.text?.trim();
    if (text && text.length > MAX_REPLY_TEXT) return errors.badRequest(`A reply can be at most ${MAX_REPLY_TEXT} characters`);
    if (!text && !audio?.length) return errors.badRequest('Write a reply or record one');
    const durationMs = fields.durationMs ? Number(fields.durationMs) : undefined;
    if (durationMs !== undefined && (!Number.isInteger(durationMs) || durationMs < 0)) return errors.badRequest('Invalid duration');

    const update: Partial<typeof tasmiSubmissions.$inferInsert> = { replyBy: request.user.sub, replyAt: new Date() };
    if (text) update.reviewNotes = text;
    if (audio?.length) {
      if (audio.length > MAX_AUDIO_BYTES) return errors.payloadTooLarge('Recording is too large');
      const kind = sniffAudio(audio);
      if (!kind) return errors.unsupportedMediaType('That file is not an audio recording');
      const key = `tasmi-replies/${id}/${randomUUID()}.${kind.ext}`;
      await getStorage().put(key, audio, kind.mime);
      Object.assign(update, { replyAudioKey: key, replyAudioContentType: kind.mime, replyAudioBytes: audio.length, replyDurationMs: durationMs ?? null });
    }

    const [updated] = await db.update(tasmiSubmissions).set(update).where(eq(tasmiSubmissions.id, id)).returning();
    // The reply it replaces goes only after the new one is saved.
    if (audio?.length && row.replyAudioKey) await getStorage().delete(row.replyAudioKey).catch(() => undefined);
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'tasmi.reply',
      targetType: 'tasmi_submission', targetId: id, ip: request.ip,
      metadata: { text: Boolean(text), voice: Boolean(audio?.length) },
    });
    return serializeTasmi(updated, false, (await limitsFor(request.user)).maxAttempts);
  });

  // DELETE /v1/tasmi/:id/reply-audio — the teacher takes her voice reply back; the text stays
  app.delete('/tasmi/:id/reply-audio', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await loadForStaff(request, id);
    if (!row?.replyAudioKey) return request.server.httpErrors.notFound('Reply not found');
    await getStorage().delete(row.replyAudioKey);
    await db.update(tasmiSubmissions)
      .set({ replyAudioKey: null, replyAudioContentType: null, replyAudioBytes: null, replyDurationMs: null })
      .where(eq(tasmiSubmissions.id, id));
    return reply.code(204).send();
  });

  // GET /v1/tasmi/:id/reply-audio-link — short-lived link to the voice reply (the student or her staff, not guardians)
  app.get('/tasmi/:id/reply-audio-link', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.user;
    const [row] = await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, id)).limit(1);
    const allowed = row && (user.sub === row.studentId || (isStaff(user) && await canViewStudent(db, user, row.studentId)));
    if (!row || !allowed || !row.replyAudioKey) return request.server.httpErrors.notFound('Reply not found');
    const token = generateToken({ sub: id, role: 'audio', purpose: 'reply-audio' }, AUDIO_LINK_TTL);
    return { url: `/v1/tasmi/${id}/reply-audio?token=${encodeURIComponent(token)}` };
  });

  // GET /v1/tasmi/:id/reply-audio?token= — streams the voice reply
  app.get('/tasmi/:id/reply-audio', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { token } = request.query as { token?: string };
    if (!validLinkToken(token, 'reply-audio', id)) return request.server.httpErrors.unauthorized('Link expired');
    const [row] = await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, id)).limit(1);
    if (!row?.replyAudioKey) return request.server.httpErrors.notFound('Reply not found');
    return streamAudio(request, reply, row.replyAudioKey, row.replyAudioBytes);
  });
}
