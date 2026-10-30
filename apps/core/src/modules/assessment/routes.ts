import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, isNull, inArray } from 'drizzle-orm';
import { AYAH_COUNTS, compareRefs, countAyat, parseRef } from '@itqan/quran';
import { getDb, type Database } from '../../db';
import { sectionEnrollments, sections, tasmiSubmissions, users } from '../../db/schema';
import { canViewStudent, isStaff, isTenantAdmin } from '../../lib/access';
import { MAX_AUDIO_BYTES, sniffAudio } from '../../lib/audio';
import { hasConsent } from '../../lib/consent';
import { ayatBetween, gradeRecitation } from '../../lib/grading';
import { ConsentRequiredError } from '../../lib/errors';
import { generateToken, verifyToken } from '../../lib/jwt';
import { RangeNotSatisfiableError, getStorage } from '../../lib/storage';
import { isCheckEnabled, scheduleAsrCheck } from '../../lib/asr/runner';
import type { FlaggedWord } from '../../lib/asr/types';
import { auditLog } from '../audit/service';

/** Longest recitation a single recording may cover. */
const MAX_SUBMISSION_AYAT = 60;
const AUDIO_LINK_TTL = '5m';

type Submission = typeof tasmiSubmissions.$inferSelect;

/** What clients may see: never the storage key or a raw URL, only whether a recording exists. */
function serializeTasmi(row: Submission) {
  const { audioKey, audioUrl, audioContentType, audioBytes, ...rest } = row;
  return { ...rest, hasAudio: Boolean(audioKey) && !row.audioDeletedAt, audioBytes };
}

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
    if (countAyat(start, end) > MAX_SUBMISSION_AYAT) {
      return errors.badRequest(`A recording can cover at most ${MAX_SUBMISSION_AYAT} ayat`);
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
      aiStatus: checkAi ? 'pending' : null,
    }).returning();
    if (checkAi) scheduleAsrCheck(db, row.id);
    return serializeTasmi(row);
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
    const token = generateToken({ sub: id, role: 'audio', purpose: 'audio' }, AUDIO_LINK_TTL);
    return { url: `/v1/tasmi/${id}/audio?token=${encodeURIComponent(token)}` };
  });

  // GET /v1/tasmi/:id/audio?token= — streams the recording (supports Range for seeking)
  app.get('/tasmi/:id/audio', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { token } = request.query as { token?: string };
    let ok = false;
    try {
      const payload = token ? verifyToken(token) : null;
      ok = payload?.purpose === 'audio' && payload.sub === id;
    } catch { /* invalid or expired */ }
    if (!ok) return request.server.httpErrors.unauthorized('Link expired');

    const [row] = await db.select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, id)).limit(1);
    if (!row?.audioKey || row.audioDeletedAt) return request.server.httpErrors.notFound('Recording not found');

    let object;
    try {
      object = await getStorage().get(row.audioKey, request.headers.range);
    } catch (err) {
      if (err instanceof RangeNotSatisfiableError) {
        return reply.code(416).header('Content-Range', `bytes */${row.audioBytes ?? 0}`).send();
      }
      throw err;
    }
    if (!object) return request.server.httpErrors.notFound('Recording not found');

    reply
      .code(object.contentRange ? 206 : 200)
      .header('Content-Type', object.contentType)
      .header('Content-Length', object.contentLength)
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cross-Origin-Resource-Policy', 'cross-origin');
    if (object.contentRange) reply.header('Content-Range', object.contentRange);
    return reply.send(object.body);
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
    return rows.map(serializeTasmi);
  });

  // GET /v1/tasmi/pending?sectionId= — unreviewed submissions in the reviewer's halaqat
  app.get('/tasmi/pending', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const user = request.user;
    if (!isStaff(user)) return request.server.httpErrors.forbidden('Staff only');
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
    return rows
      .map((r) => ({ ...serializeTasmi(r.submission), studentName: r.studentName, disputedCount: disputed(r.submission) }))
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
    return serializeTasmi(submission);
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
    return serializeTasmi(updated);
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
    return { ...serializeTasmi(result.row), graded: result.graded };
  });
}
