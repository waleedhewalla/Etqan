import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Database } from '../../db';
import { consents, guardianLinks, notifications, sections, users } from '../../db/schema';
import { sendWhatsApp } from '../../lib/whatsapp';

export interface AbsenceAlertSummary {
  sent: number;
  skipped: number;
  failed: number;
  noGuardian: number;
}

/**
 * Tells each linked guardian that a student was marked absent.
 * Every alert is also stored as an in-app notification so the guardian portal
 * shows it even when WhatsApp delivery is off or fails.
 * Students who withdrew guardian access (`mahram_access`) are skipped.
 */
export async function notifyGuardiansOfAbsence(
  db: Database,
  input: { section: typeof sections.$inferSelect; date: string; studentIds: string[] },
): Promise<AbsenceAlertSummary> {
  const summary: AbsenceAlertSummary = { sent: 0, skipped: 0, failed: 0, noGuardian: 0 };

  const withdrawn = await db.select({ userId: consents.userId }).from(consents)
    .where(and(
      inArray(consents.userId, input.studentIds),
      eq(consents.purpose, 'mahram_access'),
      isNotNull(consents.withdrawnAt),
    ));
  const blocked = new Set(withdrawn.map((w) => w.userId));

  const links = await db.select({
    studentId: guardianLinks.studentId,
    guardianId: users.id,
    guardianWhatsapp: users.whatsappE164,
  })
    .from(guardianLinks)
    .innerJoin(users, eq(guardianLinks.guardianId, users.id))
    .where(and(inArray(guardianLinks.studentId, input.studentIds), eq(users.active, true)));

  const students = await db.select({ id: users.id, name: users.displayNameAr }).from(users)
    .where(inArray(users.id, input.studentIds));
  const nameOf = new Map(students.map((s) => [s.id, s.name]));

  for (const studentId of input.studentIds) {
    const guardians = blocked.has(studentId) ? [] : links.filter((l) => l.studentId === studentId);
    if (guardians.length === 0) {
      summary.noGuardian += 1;
      continue;
    }

    const studentName = nameOf.get(studentId) ?? '';
    const titleAr = 'تنبيه غياب';
    const bodyAr = `تغيّبت ${studentName} عن ${input.section.nameAr} يوم ${input.date}.`;

    for (const g of guardians) {
      const result = g.guardianWhatsapp
        ? await sendWhatsApp({
          to: g.guardianWhatsapp,
          template: 'absence_alert',
          params: [studentName, input.section.nameAr, input.date],
        })
        : { status: 'skipped' as const };
      summary[result.status] += 1;

      await db.insert(notifications).values({
        userId: g.guardianId,
        channel: result.status === 'sent' ? 'whatsapp' : 'in_app',
        titleAr,
        bodyAr,
        data: { type: 'absence', studentId, sectionId: input.section.id, date: input.date, delivery: result.status },
      });
    }
  }

  return summary;
}
