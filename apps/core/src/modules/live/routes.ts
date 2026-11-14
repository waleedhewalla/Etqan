/**
 * Live lessons: a teacher opens a room for her halaqa, her students join to listen, ask in writing,
 * or raise a hand and be given the microphone. Media goes through the media server (lib/live.ts);
 * this module decides who may enter and keeps who attended and what was asked.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { compareRefs, parseRef } from '@itqan/quran';
import { getDb } from '../../db';
import { liveSessions, sectionEnrollments, sections, sessionParticipants, sessionQuestions, users } from '../../db/schema';
import { isStaff, isTenantAdmin, loadManagedSection } from '../../lib/access';
import { ItqanError } from '../../lib/errors';
import { isLiveConfigured, live, liveUrl } from '../../lib/live';
import { streamAudio, validLinkToken } from '../../lib/audio-link';
import { generateToken } from '../../lib/jwt';
import {
  MAX_CHUNK_BYTES, appendChunk, deleteRecording, finalizeRecording, maxRecordingBytes, partKind, recordingContentType, sniffVideo,
} from '../../lib/live-recording';
import type { TokenPayload } from '../../lib/jwt';
import { auditLog } from '../audit/service';

const MAX_LISTED = 30;
const ref = z.string().refine((r) => parseRef(r) !== null, 'Unknown verse');
const startSchema = z.object({
  title: z.string().trim().min(2).max(120),
  startRef: ref.optional(),
  endRef: ref.optional(),
}).refine((b) => Boolean(b.startRef) === Boolean(b.endRef), 'Give both verses or neither')
  .refine((b) => !b.startRef || !b.endRef || compareRefs(parseRef(b.startRef)!, parseRef(b.endRef)!) <= 0, 'The range ends before it starts');
const questionSchema = z.object({ text: z.string().trim().min(1).max(500) });
const handSchema = z.object({ raised: z.boolean() });
const speakSchema = z.object({ canSpeak: z.boolean() });
const answerSchema = z.object({ answered: z.boolean() });

type Session = typeof liveSessions.$inferSelect;
/** A lesson is watched for longer than a recitation is heard, and the player keeps asking for more of the file as it goes. */
const RECORDING_LINK_TTL = '4h';
const finishSchema = z.object({ durationMs: z.number().int().min(0).max(24 * 3_600_000).optional() });
/** What clients see: never the room name, which is as good as a key to the room, nor where the recording is kept. */
const serialize = ({ roomName, recordingKey, recordingChunks, ...rest }: Session) => rest;

export async function liveRoutes(app: FastifyInstance) {
  const db = getDb();

  /** How the caller relates to a session: its host, a listener, or neither (null). */
  const roleIn = async (user: TokenPayload, session: Session): Promise<'host' | 'listener' | null> => {
    if (await loadManagedSection(db, user, session.sectionId)) {
      // The teacher who opened it hosts; a dean looking in listens.
      return session.teacherId === user.sub ? 'host' : 'listener';
    }
    const [enrolled] = await db.select({ id: sectionEnrollments.id }).from(sectionEnrollments)
      .where(and(
        eq(sectionEnrollments.sectionId, session.sectionId), eq(sectionEnrollments.studentId, user.sub), isNull(sectionEnrollments.droppedAt),
      )).limit(1);
    return enrolled ? 'listener' : null;
  };

  const find = async (id: string) => (z.string().uuid().safeParse(id).success
    ? (await db.select().from(liveSessions).where(eq(liveSessions.id, id)).limit(1))[0]
    : undefined);

  /** The session and the caller's role in it, or the reply to send when she has none. */
  const enter = async (request: { params: unknown; user: TokenPayload; server: FastifyInstance }) => {
    const session = await find((request.params as { id: string }).id);
    const role = session ? await roleIn(request.user, session) : null;
    if (!session || !role) return { error: request.server.httpErrors.notFound('Session not found') };
    return { session, role };
  };

  // POST /v1/sections/:id/live — the teacher starts a live lesson for her halaqa
  app.post('/sections/:id/live', { schema: { body: startSchema }, preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user;
    const section = await loadManagedSection(db, user, id);
    if (!section || !section.active) return request.server.httpErrors.notFound('Section not found');
    if (!isLiveConfigured()) throw new ItqanError('Live lessons are not set up on this server', 'LIVE_NOT_CONFIGURED', 503);
    const body = request.body as z.infer<typeof startSchema>;

    // One live lesson per halaqa at a time.
    const [running] = await db.select().from(liveSessions)
      .where(and(eq(liveSessions.sectionId, id), eq(liveSessions.status, 'live'))).limit(1);
    if (running) return request.server.httpErrors.conflict('This halaqa already has a live lesson');

    const [session] = await db.insert(liveSessions).values({
      sectionId: id, teacherId: user.sub, title: body.title, startRef: body.startRef, endRef: body.endRef,
      roomName: `itqan-${randomBytes(18).toString('hex')}`,
    }).returning();
    await auditLog({
      actorId: user.sub, actorRole: user.role, action: 'session.started', targetType: 'section', targetId: id,
      metadata: { sessionId: session.id },
    });
    return reply.code(201).send(serialize(session));
  });

  // GET /v1/sections/:id/live — recent lessons of a halaqa, with how many attended
  app.get('/sections/:id/live', { preHandler: [app.authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    if (!(await loadManagedSection(db, request.user, id))) return request.server.httpErrors.notFound('Section not found');
    const rows = await db.select().from(liveSessions)
      .where(eq(liveSessions.sectionId, id)).orderBy(desc(liveSessions.startedAt)).limit(MAX_LISTED);
    const attended = rows.length
      ? await db.select({ sessionId: sessionParticipants.sessionId, n: count() }).from(sessionParticipants)
        .innerJoin(users, eq(sessionParticipants.userId, users.id))
        .where(and(inArray(sessionParticipants.sessionId, rows.map((r) => r.id)), eq(users.role, 'student')))
        .groupBy(sessionParticipants.sessionId)
      : [];
    const bySession = new Map(attended.map((a) => [a.sessionId, a.n]));
    return { enabled: isLiveConfigured(), sessions: rows.map((r) => ({ ...serialize(r), attended: bySession.get(r.id) ?? 0 })) };
  });

  // GET /v1/live/now — lessons the caller can join right now
  app.get('/live/now', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user;
    let sectionIds: string[];
    if (isStaff(user)) {
      sectionIds = (await db.select({ id: sections.id }).from(sections)
        .where(isTenantAdmin(user)
          ? eq(sections.tenantId, user.facultyId!)
          : and(eq(sections.tenantId, user.facultyId!), eq(sections.teacherId, user.sub)))).map((s) => s.id);
    } else {
      sectionIds = (await db.select({ id: sectionEnrollments.sectionId }).from(sectionEnrollments)
        .where(and(eq(sectionEnrollments.studentId, user.sub), isNull(sectionEnrollments.droppedAt)))).map((s) => s.id);
    }
    if (sectionIds.length === 0) return [];
    const rows = await db.select({ session: liveSessions, sectionName: sections.nameAr, teacherName: users.displayNameAr })
      .from(liveSessions)
      .innerJoin(sections, eq(liveSessions.sectionId, sections.id))
      .leftJoin(users, eq(liveSessions.teacherId, users.id))
      .where(and(inArray(liveSessions.sectionId, sectionIds), eq(liveSessions.status, 'live')))
      .orderBy(desc(liveSessions.startedAt));
    return rows.map((r) => ({ ...serialize(r.session), sectionName: r.sectionName, teacherName: r.teacherName }));
  });

  // POST /v1/live/:id/join — a token for the room, for the halaqa's students and whoever manages it
  app.post('/live/:id/join', { preHandler: [app.authenticate] }, async (request) => {
    const entered = await enter(request);
    if ('error' in entered) return entered.error;
    const { session, role } = entered;
    if (session.status !== 'live') return request.server.httpErrors.gone('This lesson has ended');
    if (!isLiveConfigured()) throw new ItqanError('Live lessons are not set up on this server', 'LIVE_NOT_CONFIGURED', 503);

    const [me] = await db.select({ name: users.displayNameAr }).from(users).where(eq(users.id, request.user.sub)).limit(1);
    // Joining again (a dropped connection) starts her as a listener without the microphone.
    await db.insert(sessionParticipants).values({ sessionId: session.id, userId: request.user.sub })
      .onConflictDoUpdate({
        target: [sessionParticipants.sessionId, sessionParticipants.userId],
        set: { canSpeak: false, handRaisedAt: null },
      });
    const token = await live().joinToken(session.roomName, request.user.sub, me?.name ?? '', role);
    return { url: liveUrl(), token, role, session: serialize(session) };
  });

  // GET /v1/live/:id/state — polled by everyone in the room: is it still live, who is here, what was asked
  app.get('/live/:id/state', { preHandler: [app.authenticate] }, async (request) => {
    const entered = await enter(request);
    if ('error' in entered) return entered.error;
    const { session, role } = entered;

    const people = await db.select({
      userId: sessionParticipants.userId, name: users.displayNameAr, role: users.role,
      handRaisedAt: sessionParticipants.handRaisedAt, canSpeak: sessionParticipants.canSpeak,
    }).from(sessionParticipants).innerJoin(users, eq(sessionParticipants.userId, users.id))
      .where(eq(sessionParticipants.sessionId, session.id)).orderBy(asc(sessionParticipants.joinedAt));
    const questions = await db.select({
      id: sessionQuestions.id, userId: sessionQuestions.userId, name: users.displayNameAr,
      text: sessionQuestions.text, askedAt: sessionQuestions.askedAt, answeredAt: sessionQuestions.answeredAt,
    }).from(sessionQuestions).innerJoin(users, eq(sessionQuestions.userId, users.id))
      .where(eq(sessionQuestions.sessionId, session.id)).orderBy(asc(sessionQuestions.askedAt));

    const me = people.find((p) => p.userId === request.user.sub);
    const students = people.filter((p) => p.role === 'student');
    return {
      session: serialize(session),
      role,
      me: { handRaised: Boolean(me?.handRaisedAt), canSpeak: me?.canSpeak ?? false },
      attending: students.length,
      // Only the host sees who is here and who is asking to speak; a student sees just her own state.
      participants: role === 'host'
        ? students.map((p) => ({ userId: p.userId, name: p.name, handRaised: Boolean(p.handRaisedAt), canSpeak: p.canSpeak }))
        : [],
      // Everyone sees the questions, so the same one is not asked twice.
      questions: questions.map((q) => ({ ...q, mine: q.userId === request.user.sub })),
    };
  });

  // POST /v1/live/:id/questions — a written question during the lesson
  app.post('/live/:id/questions', { schema: { body: questionSchema }, preHandler: [app.authenticate] }, async (request, reply) => {
    const entered = await enter(request);
    if ('error' in entered) return entered.error;
    if (entered.session.status !== 'live') return request.server.httpErrors.gone('This lesson has ended');
    const { text } = request.body as z.infer<typeof questionSchema>;
    const [question] = await db.insert(sessionQuestions)
      .values({ sessionId: entered.session.id, userId: request.user.sub, text }).returning();
    return reply.code(201).send(question);
  });

  // PATCH /v1/live/:id/questions/:questionId — the host marks a question answered
  app.patch('/live/:id/questions/:questionId', { schema: { body: answerSchema }, preHandler: [app.authenticate] }, async (request) => {
    const entered = await enter(request);
    if ('error' in entered) return entered.error;
    if (entered.role !== 'host') return request.server.httpErrors.forbidden('Only the teacher of this lesson');
    const { questionId } = request.params as { questionId: string };
    const { answered } = request.body as z.infer<typeof answerSchema>;
    const [updated] = z.string().uuid().safeParse(questionId).success
      ? await db.update(sessionQuestions).set({ answeredAt: answered ? new Date() : null })
        .where(and(eq(sessionQuestions.id, questionId), eq(sessionQuestions.sessionId, entered.session.id))).returning()
      : [];
    return updated ?? request.server.httpErrors.notFound('Question not found');
  });

  // PUT /v1/live/:id/hand — a listener raises or lowers her hand
  app.put('/live/:id/hand', { schema: { body: handSchema }, preHandler: [app.authenticate] }, async (request) => {
    const entered = await enter(request);
    if ('error' in entered) return entered.error;
    if (entered.session.status !== 'live') return request.server.httpErrors.gone('This lesson has ended');
    const { raised } = request.body as z.infer<typeof handSchema>;
    const [row] = await db.update(sessionParticipants).set({ handRaisedAt: raised ? new Date() : null })
      .where(and(eq(sessionParticipants.sessionId, entered.session.id), eq(sessionParticipants.userId, request.user.sub))).returning();
    if (!row) return request.server.httpErrors.conflict('Join the lesson first');
    return { handRaised: Boolean(row.handRaisedAt) };
  });

  // PUT /v1/live/:id/participants/:userId/speak — the host gives or takes back a student's microphone
  app.put('/live/:id/participants/:userId/speak', { schema: { body: speakSchema }, preHandler: [app.authenticate] }, async (request) => {
    const entered = await enter(request);
    if ('error' in entered) return entered.error;
    const { session, role } = entered;
    if (role !== 'host') return request.server.httpErrors.forbidden('Only the teacher of this lesson');
    if (session.status !== 'live') return request.server.httpErrors.gone('This lesson has ended');
    const { userId } = request.params as { userId: string };
    const { canSpeak } = request.body as z.infer<typeof speakSchema>;

    const [participant] = z.string().uuid().safeParse(userId).success
      ? await db.select().from(sessionParticipants)
        .where(and(eq(sessionParticipants.sessionId, session.id), eq(sessionParticipants.userId, userId))).limit(1)
      : [];
    if (!participant) return request.server.httpErrors.notFound('She is not in this lesson');

    // The media server first: if it refuses, nothing here says she can speak.
    try {
      await live().setCanSpeak(session.roomName, userId, canSpeak);
    } catch (err) {
      request.log.warn({ err }, 'could not change microphone permission');
      return request.server.httpErrors.conflict('She is not connected right now');
    }
    await db.update(sessionParticipants)
      .set({ canSpeak, handRaisedAt: null })
      .where(eq(sessionParticipants.id, participant.id));
    return { userId, canSpeak };
  });

  // POST /v1/live/:id/end — the host (or whoever manages the halaqa) ends the lesson for everyone
  app.post('/live/:id/end', { preHandler: [app.authenticate] }, async (request) => {
    const session = await find((request.params as { id: string }).id);
    if (!session || !(await loadManagedSection(db, request.user, session.sectionId))) {
      return request.server.httpErrors.notFound('Session not found');
    }
    if (session.status === 'ended') return serialize(session);
    await db.update(liveSessions).set({ status: 'ended', endedAt: new Date() }).where(eq(liveSessions.id, session.id));
    // A recording the teacher's browser did not close itself is closed with what it sent.
    const [current] = await db.select().from(liveSessions).where(eq(liveSessions.id, session.id)).limit(1);
    const ended = await finalizeRecording(db, current);
    await db.update(sessionParticipants).set({ canSpeak: false, handRaisedAt: null }).where(eq(sessionParticipants.sessionId, session.id));
    // Best effort: the lesson is over in our records even if the media server cannot be reached.
    await live().closeRoom(session.roomName).catch((err) => request.log.warn({ err }, 'could not close the room'));
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'session.ended', targetType: 'section', targetId: session.sectionId,
      metadata: { sessionId: session.id },
    });
    return serialize(ended);
  });

  // ---- Recording: made in the host's browser (her voice and what she shows), sent here in pieces ----

  /** The lesson when the caller is its host, or the reply to send when she is not. */
  const hosting = async (request: { params: unknown; user: TokenPayload; server: FastifyInstance }) => {
    const entered = await enter(request);
    if ('error' in entered) return entered;
    if (entered.role !== 'host') return { error: request.server.httpErrors.forbidden('Only the host records the lesson') };
    return entered;
  };

  // POST /v1/live/:id/recording/start — the host starts recording; everyone in the room is shown that it is on
  app.post('/live/:id/recording/start', { preHandler: [app.authenticate] }, async (request) => {
    const entered = await hosting(request);
    if ('error' in entered) return entered.error;
    const { session } = entered;
    if (session.status !== 'live') return request.server.httpErrors.gone('The lesson has ended');
    // One recording per lesson: a stopped or interrupted one is not started again.
    const [started] = await db.update(liveSessions).set({ recordingStatus: 'recording', recordingChunks: 0, recordingBytes: 0 })
      .where(and(eq(liveSessions.id, session.id), isNull(liveSessions.recordingStatus))).returning();
    if (!started) return request.server.httpErrors.conflict('This lesson already has a recording');
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'session.recording.started', targetType: 'section', targetId: session.sectionId,
      metadata: { sessionId: session.id },
    });
    return serialize(started);
  });

  // POST /v1/live/:id/recording/chunks — the next piece (multipart: seq, chunk)
  app.post('/live/:id/recording/chunks', { preHandler: [app.authenticate] }, async (request) => {
    const errors = request.server.httpErrors;
    const entered = await hosting(request);
    if ('error' in entered) return entered.error;
    const { session } = entered;
    if (session.recordingStatus !== 'recording') return errors.conflict('This lesson is not being recorded');
    if (!request.isMultipart()) return errors.badRequest('Send multipart/form-data');

    let seq = NaN;
    let chunk: Buffer | null = null;
    try {
      for await (const part of request.parts({ limits: { fileSize: MAX_CHUNK_BYTES } })) {
        if (part.type === 'file') {
          if (part.fieldname !== 'chunk' || chunk) { part.file.resume(); continue; }
          chunk = await part.toBuffer();
        } else if (part.fieldname === 'seq' && typeof part.value === 'string') {
          seq = Number(part.value);
        }
      }
    } catch {
      return errors.payloadTooLarge('That piece is too large');
    }
    if (!Number.isInteger(seq) || seq < 0) return errors.badRequest('Invalid piece number');
    if (!chunk || chunk.length === 0) return errors.badRequest('No recording attached');
    // A piece sent twice (the reply was lost on the way back) is accepted once.
    if (seq < session.recordingChunks) return { received: session.recordingChunks };
    if (seq > session.recordingChunks) return errors.conflict(`Expected piece ${session.recordingChunks}`);

    const total = (session.recordingBytes ?? 0) + chunk.length;
    if (total > maxRecordingBytes()) throw new ItqanError('The recording has reached its size limit', 'RECORDING_FULL', 413);
    // The first piece says what kind of file this is; later pieces continue it.
    const kind = seq === 0 ? sniffVideo(chunk) : await partKind(session.id);
    if (!kind) return seq === 0 ? errors.unsupportedMediaType('That is not a video recording') : errors.conflict('The recording was lost');

    const [claimed] = await db.update(liveSessions).set({ recordingChunks: seq + 1, recordingBytes: total })
      .where(and(eq(liveSessions.id, session.id), eq(liveSessions.recordingStatus, 'recording'), eq(liveSessions.recordingChunks, seq)))
      .returning({ id: liveSessions.id });
    if (!claimed) return errors.conflict('This lesson is not being recorded');
    try {
      await appendChunk(session.id, kind, chunk);
    } catch (err) {
      // Not written (a full disk, say): the piece is not counted, so the browser's next try sends it again.
      await db.update(liveSessions).set({ recordingChunks: seq, recordingBytes: session.recordingBytes ?? 0 })
        .where(and(eq(liveSessions.id, session.id), eq(liveSessions.recordingChunks, seq + 1)));
      throw err;
    }
    return { received: seq + 1 };
  });

  // POST /v1/live/:id/recording/finish — the host stops recording; what was received becomes the lesson's recording
  app.post('/live/:id/recording/finish', { schema: { body: finishSchema }, preHandler: [app.authenticate] }, async (request) => {
    const entered = await hosting(request);
    if ('error' in entered) return entered.error;
    const { session } = entered;
    if (session.recordingStatus !== 'recording') return serialize(session);
    const finished = await finalizeRecording(db, session, (request.body as z.infer<typeof finishSchema>).durationMs);
    if (finished.recordingStatus === 'recording') return request.server.httpErrors.serviceUnavailable('The recording could not be saved yet');
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'session.recording.finished', targetType: 'section', targetId: session.sectionId,
      metadata: { sessionId: session.id, status: finished.recordingStatus, bytes: finished.recordingBytes },
    });
    return serialize(finished);
  });

  // GET /v1/live/recordings — recorded lessons of the caller's halaqat, newest first
  app.get('/live/recordings', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user;
    const sectionIds = isStaff(user)
      ? (await db.select({ id: sections.id }).from(sections)
        .where(isTenantAdmin(user)
          ? eq(sections.tenantId, user.facultyId!)
          : and(eq(sections.tenantId, user.facultyId!), eq(sections.teacherId, user.sub)))).map((s) => s.id)
      : (await db.select({ id: sectionEnrollments.sectionId }).from(sectionEnrollments)
        .where(and(eq(sectionEnrollments.studentId, user.sub), isNull(sectionEnrollments.droppedAt)))).map((s) => s.id);
    if (sectionIds.length === 0) return [];
    const rows = await db.select({ session: liveSessions, sectionName: sections.nameAr, teacherName: users.displayNameAr })
      .from(liveSessions)
      .innerJoin(sections, eq(liveSessions.sectionId, sections.id))
      .leftJoin(users, eq(liveSessions.teacherId, users.id))
      .where(and(inArray(liveSessions.sectionId, sectionIds), eq(liveSessions.recordingStatus, 'ready')))
      .orderBy(desc(liveSessions.startedAt)).limit(MAX_LISTED);
    return rows.map((r) => ({ ...serialize(r.session), sectionName: r.sectionName, teacherName: r.teacherName }));
  });

  // GET /v1/live/:id/recording-link — short-lived link, for the halaqa's students and whoever manages it (not guardians)
  app.get('/live/:id/recording-link', { preHandler: [app.authenticate] }, async (request) => {
    const entered = await enter(request);
    if ('error' in entered) return entered.error;
    const { session } = entered;
    if (session.recordingStatus !== 'ready') return request.server.httpErrors.notFound('This lesson has no recording');
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'session.recording.viewed', targetType: 'section', targetId: session.sectionId,
      metadata: { sessionId: session.id },
    });
    const token = generateToken({ sub: session.id, role: 'audio', purpose: 'session-recording' }, RECORDING_LINK_TTL);
    return { url: `/v1/live/${session.id}/recording?token=${encodeURIComponent(token)}`, contentType: recordingContentType(session.recordingKey!) };
  });

  // GET /v1/live/:id/recording?token= — the recording itself; the link is the permission
  app.get('/live/:id/recording', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { token } = request.query as { token?: string };
    if (!validLinkToken(token, 'session-recording', id)) return request.server.httpErrors.unauthorized('Link expired');
    const session = await find(id);
    if (!session?.recordingKey) return request.server.httpErrors.notFound('This lesson has no recording');
    return streamAudio(request, reply, session.recordingKey, session.recordingBytes, recordingContentType(session.recordingKey));
  });

  // DELETE /v1/live/:id/recording — whoever manages the halaqa removes the recording; the lesson's record stays
  app.delete('/live/:id/recording', { preHandler: [app.authenticate] }, async (request) => {
    const session = await find((request.params as { id: string }).id);
    if (!session || !(await loadManagedSection(db, request.user, session.sectionId))) {
      return request.server.httpErrors.notFound('Session not found');
    }
    if (session.recordingStatus !== 'ready') return request.server.httpErrors.notFound('This lesson has no recording');
    const updated = await deleteRecording(db, session);
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'session.recording.deleted', targetType: 'section', targetId: session.sectionId,
      metadata: { sessionId: session.id },
    });
    return serialize(updated);
  });

  // GET /v1/live/:id/attendance — who of the halaqa came, to fill the attendance sheet from
  app.get('/live/:id/attendance', { preHandler: [app.authenticate] }, async (request) => {
    const session = await find((request.params as { id: string }).id);
    if (!session || !(await loadManagedSection(db, request.user, session.sectionId))) {
      return request.server.httpErrors.notFound('Session not found');
    }
    const roster = await db.select({ studentId: sectionEnrollments.studentId, name: users.displayNameAr })
      .from(sectionEnrollments).innerJoin(users, eq(sectionEnrollments.studentId, users.id))
      .where(and(eq(sectionEnrollments.sectionId, session.sectionId), isNull(sectionEnrollments.droppedAt)))
      .orderBy(asc(users.displayNameAr));
    const came = new Set((await db.select({ userId: sessionParticipants.userId }).from(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, session.id))).map((p) => p.userId));
    return { session: serialize(session), records: roster.map((r) => ({ ...r, present: came.has(r.studentId) })) };
  });
}
