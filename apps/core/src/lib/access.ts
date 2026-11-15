import { and, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import type { Database } from '../db';
import { consents, guardianLinks, sectionEnrollments, sections, users } from '../db/schema';
import type { TokenPayload } from './jwt';

/** Roles that teach or review a halaqa. */
export const TEACHER_ROLES = ['lecturer', 'muhaffiza', 'sheikh_reviewer'] as const;
/** Roles with tenant-wide oversight. */
export const ADMIN_ROLES = ['admin', 'advisor', 'operator', 'superadmin'] as const;
export const STAFF_ROLES: readonly string[] = [
  ...TEACHER_ROLES, ...ADMIN_ROLES, 'committee_member', 'sama_committee_member',
];
export const GUARDIAN_ROLE = 'mahram';

export function isStaff(user: TokenPayload) {
  return STAFF_ROLES.includes(user.role);
}

export function isTenantAdmin(user: TokenPayload) {
  return (ADMIN_ROLES as readonly string[]).includes(user.role);
}

type Section = typeof sections.$inferSelect;

/** Teacher of the section, or an admin of its tenant. */
export function canManageSection(user: TokenPayload, section: Section) {
  if (section.tenantId !== user.facultyId) return false;
  return section.teacherId === user.sub || isTenantAdmin(user);
}

export async function loadManagedSection(db: Database, user: TokenPayload, sectionId: string) {
  const [section] = await db.select().from(sections).where(eq(sections.id, sectionId)).limit(1);
  if (!section || !canManageSection(user, section)) return null;
  return section;
}

/**
 * Whether `user` may see a student's progress:
 * the student herself, a linked guardian, her teacher, or a tenant admin.
 */
/**
 * True when the student withdrew guardian access («mahram_access»). Without a record she has not decided,
 * which allows it (a guardian the institution linked for a student who has not joined yet). Absence alerts
 * and live-lesson reminders follow the same rule.
 */
export async function guardianAccessWithdrawn(db: Database, studentId: string): Promise<boolean> {
  const [row] = await db.select({ id: consents.id }).from(consents)
    .where(and(eq(consents.userId, studentId), eq(consents.purpose, 'mahram_access'), isNotNull(consents.withdrawnAt)))
    .limit(1);
  return Boolean(row);
}

export async function canViewStudent(db: Database, user: TokenPayload, studentId: string) {
  if (user.sub === studentId) return true;

  if (user.role === GUARDIAN_ROLE) {
    const [link] = await db.select({ id: guardianLinks.id })
      .from(guardianLinks)
      .where(and(
        eq(guardianLinks.guardianId, user.sub),
        eq(guardianLinks.studentId, studentId),
        or(isNull(guardianLinks.expiresAt), gt(guardianLinks.expiresAt, new Date())),
      ))
      .limit(1);
    return Boolean(link) && !(await guardianAccessWithdrawn(db, studentId));
  }

  if (!isStaff(user)) return false;

  const [student] = await db.select({ tenantId: users.tenantId })
    .from(users).where(eq(users.id, studentId)).limit(1);
  if (!student || student.tenantId !== user.facultyId) return false;
  if (isTenantAdmin(user)) return true;

  const [taught] = await db.select({ id: sectionEnrollments.id })
    .from(sectionEnrollments)
    .innerJoin(sections, eq(sectionEnrollments.sectionId, sections.id))
    .where(and(
      eq(sectionEnrollments.studentId, studentId),
      isNull(sectionEnrollments.droppedAt),
      eq(sections.teacherId, user.sub),
    ))
    .limit(1);
  return Boolean(taught);
}
