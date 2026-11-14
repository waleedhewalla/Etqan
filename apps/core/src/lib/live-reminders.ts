/**
 * Reminders for scheduled live lessons: one the day before and one shortly before the start, to the halaqa's students
 * (and the teacher, for the second). Each goes in the app's notifications and, when the deployment has WhatsApp and the
 * student agreed to messages («whatsapp_notifications»), over WhatsApp. A lesson nobody started is closed three hours
 * after its time. Safe to run every minute: a reminder is claimed in the database before it is sent, so it goes once.
 */
import { and, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { consents, liveSessions, notifications, sectionEnrollments, sections, users } from '../db/schema';
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

    const students = (await db.select({ id: sectionEnrollments.studentId }).from(sectionEnrollments)
      .innerJoin(users, eq(sectionEnrollments.studentId, users.id))
      .where(and(eq(sectionEnrollments.sectionId, session.sectionId), isNull(sectionEnrollments.droppedAt), eq(users.active, true)))).map((r) => r.id);
    const recipients = stage === 2 && session.teacherId ? [...students, session.teacherId] : students;
    if (recipients.length === 0) continue;

    const when = whenAr(at);
    const titleAr = stage === 1 ? 'درس مباشر غداً' : 'درس مباشر بعد قليل';
    const bodyAr = `${stage === 1 ? 'غداً' : 'بعد قليل'}: درس «${session.title}» في ${halaqa}، ${when}.`;
    if (await moduleOn(tenantId, 'notifications')) {
      await db.insert(notifications).values(recipients.map((userId) => ({
        userId, titleAr, bodyAr, data: { type: 'live_reminder', sessionId: session.id, stage },
      })));
    }

    // Over WhatsApp only to those who agreed to messages.
    const agreed = new Set((await db.select({ userId: consents.userId }).from(consents)
      .where(and(inArray(consents.userId, recipients), eq(consents.purpose, 'whatsapp_notifications'), isNull(consents.withdrawnAt)))).map((c) => c.userId));
    const numbers = await db.select({ id: users.id, number: users.whatsappE164 }).from(users)
      .where(and(inArray(users.id, [...agreed]), sql`${users.whatsappE164} is not null`));
    for (const { number } of numbers) {
      const result = await sendWhatsApp({ to: number!, template: 'live_reminder', params: [session.title, when, halaqa] });
      if (result.status === 'sent') summary.whatsapp += 1;
    }
    if (stage === 1) summary.dayBefore += 1; else summary.shortlyBefore += 1;
  }
  return summary;
}
