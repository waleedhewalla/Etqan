/**
 * Removing a person's data, and giving it to her. Two ways to remove it:
 *
 * - anonymize (the default): her account stays, as a stopped account with no name, no contact and no sign-in, and the records
 *   the institution must keep stay with it: the scores and verdicts of her recitations and period tests, her attendance and
 *   her place in a halaqa. Everything that describes her, or only she needs, goes: recordings, the teacher's written remarks,
 *   her learning history, notifications, consents and the links to her guardians.
 * - erase: the account and everything attached to it go, grades included.
 *
 * A member of staff can only be anonymized (what she wrote and graded belongs to the institution), and only once she leads no
 * halaqa. The audit trail is kept; it carries ids, not names.
 */
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../db';
import {
  assignments, attendance, auditLogs, authSessions, consents, dataRequests, guardianLinks, hifzPeriodResults, mutashabihatDrills, notifications, sections, sessionParticipants,
  sessionQuestions, sessions, streakFreezes, streaks, studentBadges, studentCards, studentMonthlyAppraisals, tasmiSubmissions, userRoles, users,
} from '../db/schema';
import { auditLog } from '../modules/audit/service';
import { forgetStopped } from './active-users';
import { getStorage } from './storage';

export type DeletionMode = 'anonymize' | 'erase';
/** Roles whose accounts may be erased; the others (staff) can only be anonymized. */
export const ERASABLE_ROLES = ['student', 'mahram', 'alumna'] as const;
export const isErasable = (role: string) => (ERASABLE_ROLES as readonly string[]).includes(role);
export const DELETED_NAME = 'مستخدم محذوف';

/** Active halaqat she leads: while she leads any, her account cannot go. */
export async function activeHalaqatLed(db: Database, userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(sections).where(and(eq(sections.teacherId, userId), eq(sections.active, true)));
  return row?.n ?? 0;
}

/** Deletes the recordings of her recitations, and of the replies teachers recorded to them. Throws if one cannot be removed, so the whole job is tried again. */
async function removeRecordings(db: Database, userId: string): Promise<number> {
  const rows = await db.select({ audio: tasmiSubmissions.audioKey, reply: tasmiSubmissions.replyAudioKey }).from(tasmiSubmissions).where(eq(tasmiSubmissions.studentId, userId));
  const keys = rows.flatMap((r) => [r.audio, r.reply]).filter((k): k is string => Boolean(k));
  for (const key of keys) await getStorage().delete(key);
  return keys.length;
}

export async function anonymizeUser(db: Database, userId: string) {
  const recordings = await removeRecordings(db, userId);
  return db.transaction(async (tx) => {
    const counts: Record<string, number> = { recordings };
    const gone = async (name: string, q: Promise<unknown[]>) => { counts[name] = (await q).length; };
    await tx.update(tasmiSubmissions).set({
      audioKey: null, audioUrl: null, audioContentType: null, audioBytes: null, audioDeletedAt: new Date(),
      replyAudioKey: null, replyAudioContentType: null, replyAudioBytes: null, replyDurationMs: null,
      aiFlaggedErrors: [], aiError: null, reviewNotes: null,
    }).where(eq(tasmiSubmissions.studentId, userId));
    await tx.update(hifzPeriodResults).set({ note: null, proposals: null }).where(eq(hifzPeriodResults.studentId, userId));
    await tx.update(studentMonthlyAppraisals).set({ note: '' }).where(eq(studentMonthlyAppraisals.studentId, userId));
    await gone('cards', tx.delete(studentCards).where(eq(studentCards.studentId, userId)).returning({ id: studentCards.id }));
    await gone('notifications', tx.delete(notifications).where(eq(notifications.userId, userId)).returning({ id: notifications.id }));
    await gone('consents', tx.delete(consents).where(eq(consents.userId, userId)).returning({ id: consents.id }));
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
    await gone('guardianLinks', tx.delete(guardianLinks).where(sql`${guardianLinks.studentId} = ${userId} or ${guardianLinks.guardianId} = ${userId}`).returning({ id: guardianLinks.id }));
    await tx.delete(mutashabihatDrills).where(eq(mutashabihatDrills.studentId, userId));
    await tx.delete(sessions).where(eq(sessions.studentId, userId));
    await tx.delete(assignments).where(eq(assignments.studentId, userId));
    await tx.delete(streaks).where(eq(streaks.studentId, userId));
    await tx.delete(streakFreezes).where(eq(streakFreezes.studentId, userId));
    await tx.delete(studentBadges).where(eq(studentBadges.studentId, userId));
    await tx.delete(sessionQuestions).where(eq(sessionQuestions.userId, userId));
    await tx.delete(sessionParticipants).where(eq(sessionParticipants.userId, userId));
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    await tx.update(users).set({
      displayNameAr: DELETED_NAME, displayNameEn: null, email: null, whatsappE164: null, nationalIdHash: null, avatarUrl: null,
      newAyatPerDay: null, active: false, updatedAt: new Date(),
    }).where(eq(users.id, userId));
    return counts;
  }).finally(() => forgetStopped(userId));
}

export async function eraseUser(db: Database, userId: string) {
  const recordings = await removeRecordings(db, userId);
  return db.transaction(async (tx) => {
    // The audit trail stays, without her id; everything else that points at her goes with the account.
    await tx.update(auditLogs).set({ userId: null }).where(eq(auditLogs.userId, userId));
    const [{ n: submissions }] = await tx.select({ n: sql<number>`count(*)::int` }).from(tasmiSubmissions).where(eq(tasmiSubmissions.studentId, userId));
    await tx.delete(users).where(eq(users.id, userId));
    return { recordings, recitations: submissions };
  }).finally(() => forgetStopped(userId));
}

/**
 * Carries out the requests whose grace period is over. A request that cannot be carried out now (a recording that would not
 * delete, a teacher who has since been given a halaqa) stays scheduled, with the reason in its summary, and is tried again.
 */
export async function executeDueDeletions(db: Database, now = new Date()) {
  const due = await db.select().from(dataRequests).where(and(eq(dataRequests.status, 'scheduled'), lte(dataRequests.scheduledFor, now)));
  let done = 0;
  for (const request of due) {
    try {
      if (!request.mode) continue;
      if (request.mode === 'erase' && !isErasable(request.subjectRole)) throw new Error('This account cannot be erased');
      if (await activeHalaqatLed(db, request.userId)) throw new Error('She leads a halaqa');
      const summary = request.mode === 'erase' ? await eraseUser(db, request.userId) : await anonymizeUser(db, request.userId);
      await db.update(dataRequests).set({ status: 'done', completedAt: now, subjectName: null, summary: { mode: request.mode, ...summary } })
        .where(and(eq(dataRequests.id, request.id), eq(dataRequests.status, 'scheduled')));
      await auditLog({
        actorRole: 'system', tenantId: request.tenantId, action: 'data.deletion.completed', targetType: 'data_request', targetId: request.id,
        metadata: { mode: request.mode, role: request.subjectRole },
      });
      done += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error('[PRIVACY] could not carry out request', request.id, reason);
      await db.update(dataRequests).set({ summary: { ...(request.summary ?? {}), error: reason, triedAt: now.toISOString() } }).where(eq(dataRequests.id, request.id));
    }
  }
  return done;
}

/** Everything the app keeps about a person, to give her: a plain file, no recordings (those are deleted on their own schedule). */
export async function buildExport(db: Database, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const limit = 20_000;
  const rows = async <T>(q: Promise<T[]>) => q;
  const [cards, recitations, periodTests, appraisals, mine, links, badges, attendanceRows, consentRows] = await Promise.all([
    rows(db.select({ ayah: studentCards.ayahRef, state: studentCards.state, reps: studentCards.reps, lapses: studentCards.lapses, due: studentCards.dueAt }).from(studentCards).where(eq(studentCards.studentId, userId)).limit(limit)),
    rows(db.select({
      startRef: tasmiSubmissions.startRef, endRef: tasmiSubmissions.endRef, submittedAt: tasmiSubmissions.submittedAt, attempt: tasmiSubmissions.attempt,
      verdict: tasmiSubmissions.reviewVerdict, hifz: tasmiSubmissions.reviewHifzScore, tajweed: tasmiSubmissions.reviewTajweedScore, fluency: tasmiSubmissions.reviewFluencyScore,
      total: tasmiSubmissions.reviewWeightedTotal, teacherNote: tasmiSubmissions.reviewNotes, reviewedAt: tasmiSubmissions.reviewedAt,
    }).from(tasmiSubmissions).where(eq(tasmiSubmissions.studentId, userId)).limit(limit)),
    rows(db.select({
      period: hifzPeriodResults.periodName, attempt: hifzPeriodResults.attempt, outcome: hifzPeriodResults.outcome, total: hifzPeriodResults.total,
      hifz: hifzPeriodResults.scoreHifz, tajweed: hifzPeriodResults.scoreTajweed, review: hifzPeriodResults.scoreReview, retention: hifzPeriodResults.scoreRetention,
      note: hifzPeriodResults.note, at: hifzPeriodResults.createdAt,
    }).from(hifzPeriodResults).where(and(eq(hifzPeriodResults.studentId, userId), sql`${hifzPeriodResults.voidedAt} is null`)).limit(limit)),
    rows(db.select({ month: studentMonthlyAppraisals.month, note: studentMonthlyAppraisals.note }).from(studentMonthlyAppraisals).where(eq(studentMonthlyAppraisals.studentId, userId)).limit(limit)),
    rows(db.select({ title: notifications.titleAr, body: notifications.bodyAr, sentAt: notifications.sentAt, readAt: notifications.readAt }).from(notifications).where(eq(notifications.userId, userId)).limit(limit)),
    rows(db.select({ student: guardianLinks.studentId, guardian: guardianLinks.guardianId }).from(guardianLinks).where(sql`${guardianLinks.studentId} = ${userId} or ${guardianLinks.guardianId} = ${userId}`).limit(limit)),
    rows(db.select({ badge: studentBadges.badgeId, earnedAt: studentBadges.earnedAt }).from(studentBadges).where(eq(studentBadges.studentId, userId)).limit(limit)),
    rows(db.select().from(attendance).where(eq(attendance.studentId, userId)).limit(limit)),
    rows(db.select({ purpose: consents.purpose, grantedAt: consents.grantedAt, withdrawnAt: consents.withdrawnAt }).from(consents).where(eq(consents.userId, userId)).limit(limit)),
  ]);
  const people = links.length ? await db.select({ id: users.id, name: users.displayNameAr, whatsapp: users.whatsappE164 }).from(users).where(inArray(users.id, [...new Set(links.flatMap((l) => [l.student, l.guardian]))])) : [];
  const nameOf = new Map(people.map((p) => [p.id, p]));
  return {
    exportedAt: new Date().toISOString(),
    note: 'بياناتكِ كما تحتفظ بها منصة إتقان. لا تتضمن التسجيلات الصوتية: تُحذف تلقائياً بعد مراجعتها.',
    profile: { id: user.id, name: user.displayNameAr, role: user.role, email: user.email, whatsapp: user.whatsappE164, createdAt: user.createdAt, newAyatPerDay: user.newAyatPerDay },
    consents: consentRows,
    guardianLinks: links.map((l) => ({
      ...(l.student === userId ? { guardian: { name: nameOf.get(l.guardian)?.name, whatsapp: nameOf.get(l.guardian)?.whatsapp } } : { student: { name: nameOf.get(l.student)?.name } }),
    })),
    revisionCards: cards,
    recitations,
    periodTests,
    monthlyAppraisals: appraisals,
    attendance: attendanceRows.map((a) => ({ date: a.date, present: a.present })),
    badges,
    notifications: mine,
  };
}
