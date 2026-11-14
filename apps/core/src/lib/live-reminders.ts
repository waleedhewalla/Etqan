/**
 * Reminders for scheduled live lessons: one the day before and one shortly before the start, to the halaqa's students
 * (and the teacher, for the second), and to their guardians unless the student withdrew guardian access. Each goes in the app's notifications and, when the deployment has WhatsApp and the
 * student agreed to messages («whatsapp_notifications»), over WhatsApp. A lesson nobody started is closed three hours
 * after its time. Safe to run every minute: a reminder is claimed in the database before it is sent, so it goes once.
 */
import { and, eq, gt, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { consents, guardianLinks, liveSessions, notifications, sectionEnrollments, sections, users } from '../db/schema';
import { config } from '../config';
import { moduleOn } from './modules';
import { sendWhatsApp } from './whatsapp';

const MINUTE = 60_000;
export const DAY_BEFORE_MS = 24 * 60 * MINUTE;
export const SHORTLY_BEFORE_MS = 15 * MINUTE;
export const MISSED_AFTER_MS = 3 * 60 * MINUTE;

/** «الأحد ١٥ نوفمبر، ٨:٠٠ م» in the institution's time zone. */
export const whenAr = (at: Date) => new Intl.DateTimeFormat('ar-EG', {
  weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: config.DEFAULT_TIMEZONE,
}).format(at);

/**
 * The guardians of these students, each once with the names of her daughters in the halaqa. Students who withdrew
 * guardian access («mahram_access») are left out, as for absence alerts.
 */
async function guardiansOf(db: Database, students: { id: string; name: string }[]) {
  if (students.length === 0) return [];
  const ids = students.map((s) => s.id);
  const withdrawn = new Set((await db.select({ userId: consents.userId }).from(consents)
    .where(and(inArray(consents.userId, ids), eq(consents.purpose, 'mahram_access'), isNotNull(consents.withdrawnAt)))).map((c) => c.userId));
  const names = new Map(students.map((s) => [s.id, s.name]));
  const links = await db.select({ studentId: guardianLinks.studentId, id: users.id, number: users.whatsappE164 }).from(guardianLinks)
    .innerJoin(users, eq(guardianLinks.guardianId, users.id))
    .where(and(inArray(guardianLinks.studentId, ids), eq(users.active, true)));
  const byGuardian = new Map<string, { id: string; number: string | null; children: string[] }>();
  for (const l of links) {
    if (withdrawn.has(l.studentId)) continue;
    const g = byGuardian.get(l.id) ?? { id: l.id, number: l.number, children: [] };
    g.children.push(names.get(l.studentId) ?? '');
    byGuardian.set(l.id, g);
  }
  return [...byGuardian.values()];
}

export interface ReminderSummary { dayBefore: number; shortlyBefore: number; missed: number; whatsapp: number }

export async function sendDueReminders(db: Database, now = new Date()): Promise<ReminderSummary> {
  const summary: ReminderSummary = { dayBefore: 0, shortlyBefore: 0, missed: 0, whatsapp: 0 };

  const missed = await db.update(liveSessions).set({ status: 'cancelled', endedAt: now })
    .where(and(eq(liveSessions.status, 'scheduled'), lt(liveSessions.scheduledAt, new Date(now.getTime() - MISSED_AFTER_MS))))
    .returning({ id: liveSessions.id });
  summary.missed = missed.length;

  const due = await db.select({ session: liveSessions, halaqa: sections.nameAr, tenantId: sections.tenantId, active: sections.active })
    .from(liveSessions).innerJoin(sections, eq(liveSessions.sectionId, sections.id))
    .where(and(eq(liveSessions.status, 'scheduled'), lt(liveSessions.remindersSent, 2), gt(liveSessions.scheduledAt, now)));

  for (const { session, halaqa, tenantId, active } of due) {
    const at = session.scheduledAt!;
    const untilStart = at.getTime() - now.getTime();
    const stage: 1 | 2 | null = untilStart <= SHORTLY_BEFORE_MS ? 2 : untilStart <= DAY_BEFORE_MS && session.remindersSent === 0 ? 1 : null;
    if (!stage || !active || !(await moduleOn(tenantId, 'live'))) continue;

    // Claimed first, so a second run (or a second server) does not send it again.
    const [claimed] = await db.update(liveSessions).set({ remindersSent: stage })
      .where(and(eq(liveSessions.id, session.id), lt(liveSessions.remindersSent, stage))).returning({ id: liveSessions.id });
    if (!claimed) continue;
    // A lesson made less than a day ahead has no "day before" reminder; the next one covers it.
    if (stage === 1 && session.startedAt.getTime() > at.getTime() - DAY_BEFORE_MS) continue;

    const enrolled = await db.select({ id: sectionEnrollments.studentId, name: users.displayNameAr }).from(sectionEnrollments)
      .innerJoin(users, eq(sectionEnrollments.studentId, users.id))
      .where(and(eq(sectionEnrollments.sectionId, session.sectionId), isNull(sectionEnrollments.droppedAt), eq(users.active, true)));
    const students = enrolled.map((r) => r.id);
    const recipients = stage === 2 && session.teacherId ? [...students, session.teacherId] : students;
    const guardians = await guardiansOf(db, enrolled);
    if (recipients.length === 0 && guardians.length === 0) continue;

    const when = whenAr(at);
    const titleAr = stage === 1 ? 'درس مباشر غداً' : 'درس مباشر بعد قليل';
    const bodyAr = `${stage === 1 ? 'غداً' : 'بعد قليل'}: درس «${session.title}» في ${halaqa}، ${when}.`;
    const guardianBody = (names: string[]) =>
      `${stage === 1 ? 'غداً' : 'بعد قليل'}: درس «${session.title}» في ${halaqa}، ${when}، لـ${names.join('، ')}.`;
    if (await moduleOn(tenantId, 'notifications')) {
      const rows = [
        ...recipients.map((userId) => ({ userId, titleAr, bodyAr, data: { type: 'live_reminder', sessionId: session.id, stage } })),
        // A guardian cannot join the lesson, so hers carries no link to it.
        ...guardians.map((g) => ({ userId: g.id, titleAr, bodyAr: guardianBody(g.children), data: { type: 'live_reminder_guardian', sessionId: session.id, stage } })),
      ];
      if (rows.length) await db.insert(notifications).values(rows);
    }

    // Over WhatsApp only to those who agreed to messages.
    const agreed = new Set((await db.select({ userId: consents.userId }).from(consents)
      .where(and(inArray(consents.userId, recipients), eq(consents.purpose, 'whatsapp_notifications'), isNull(consents.withdrawnAt)))).map((c) => c.userId));
    const numbers = agreed.size === 0 ? [] : await db.select({ id: users.id, number: users.whatsappE164 }).from(users)
      .where(and(inArray(users.id, [...agreed]), sql`${users.whatsappE164} is not null`));
    // A guardian's number was given to reach her about her daughter, so (as for absence alerts) it is used without a second consent.
    const guardianNumbers = guardians.filter((g) => g.number).map((g) => ({ number: g.number }));
    for (const { number } of [...numbers, ...guardianNumbers]) {
      const result = await sendWhatsApp({ to: number!, template: 'live_reminder', params: [session.title, when, halaqa] });
      if (result.status === 'sent') summary.whatsapp += 1;
    }
    if (stage === 1) summary.dayBefore += 1; else summary.shortlyBefore += 1;
  }
  return summary;
}
