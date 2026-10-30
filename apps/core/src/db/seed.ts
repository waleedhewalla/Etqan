/**
 * Seeds a demo pilot tenant for local development and staging.
 *
 *   pnpm --filter @itqan/core db:seed
 *
 * Sign in as:
 *   teacher  teacher@itqan.local       (magic link is printed in the API log)
 *   dean     dean@itqan.local
 *   student  +201000000101 … +201000000104  (OTP is printed in the API log)
 *   guardian +201000000201  (linked to the first student)
 *   new student: join code AZH001 with any other number
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from './index';
import {
  tenants, users, sections, sectionEnrollments, guardianLinks, syllabi, syllabusPassages,
  studentCards, reviewLogs, streaks, attendance, tasmiSubmissions, assignments,
} from './schema';
import { addDays, localDate, startOfLocalDay } from '../lib/dates';

const TENANT_SLUG = 'azhar-girls-pilot';
export const SEED_JOIN_CODE = 'AZH001';

const STUDENTS = [
  { name: 'مريم علي', whatsapp: '+201000000101', reviewed: 18, lastActiveDaysAgo: 0, absentDaysAgo: [] as number[] },
  { name: 'عائشة محمد', whatsapp: '+201000000102', reviewed: 9, lastActiveDaysAgo: 4, absentDaysAgo: [1, 2] },
  { name: 'خديجة حسن', whatsapp: '+201000000103', reviewed: 14, lastActiveDaysAgo: 1, absentDaysAgo: [3] },
  { name: 'زينب عمر', whatsapp: '+201000000104', reviewed: 6, lastActiveDaysAgo: 0, absentDaysAgo: [] },
];

const AYAH_COUNT = 25; // al-Baqarah 1–25

export async function seed() {
  const [existing] = await getDb().select().from(tenants).where(eq(tenants.slug, TENANT_SLUG)).limit(1);
  if (existing) {
    console.log(`Tenant "${TENANT_SLUG}" already exists — nothing to do.`);
    return;
  }

  // One transaction, so a failure never leaves a half-seeded tenant behind.
  await getDb().transaction(async (db) => {

    const today = localDate();

    const [tenant] = await db.insert(tenants).values({
      slug: TENANT_SLUG,
      nameAr: 'كلية الأزهر للبنات — نسخة تجريبية',
      nameEn: 'Al-Azhar Girls College (pilot)',
      planTier: 'madrasa_pro',
      planMaxStudents: 200,
    }).returning();

    const [teacher] = await db.insert(users).values({
      tenantId: tenant.id, role: 'lecturer', displayNameAr: 'أ. فاطمة الزهراء',
      email: 'teacher@itqan.local', whatsappE164: '+201000000001',
    }).returning();

    await db.insert(users).values({
      tenantId: tenant.id, role: 'dean', displayNameAr: 'د. عميدة الكلية', email: 'dean@itqan.local',
  });

  const [section] = await db.insert(sections).values({
    tenantId: tenant.id, nameAr: 'حلقة سورة البقرة — أ', joinCode: SEED_JOIN_CODE, teacherId: teacher.id,
  }).returning();

  const [syllabus] = await db.insert(syllabi).values({
    tenantId: tenant.id, nameAr: 'سورة البقرة — الجزء الأول', createdBy: teacher.id,
  }).returning();
  await db.insert(syllabusPassages).values([
    { syllabusId: syllabus.id, nameAr: 'البقرة ١–١٠', startRef: '2:1', endRef: '2:10', sortOrder: 1 },
    { syllabusId: syllabus.id, nameAr: 'البقرة ١١–٢٥', startRef: '2:11', endRef: '2:25', sortOrder: 2 },
  ]);

  const createdStudents: (typeof users.$inferSelect)[] = [];
  for (const s of STUDENTS) {
    const [student] = await db.insert(users).values({
      tenantId: tenant.id, role: 'student', displayNameAr: s.name, whatsappE164: s.whatsapp,
    }).returning();
    createdStudents.push(student);
    await db.insert(sectionEnrollments).values({ sectionId: section.id, studentId: student.id });

    // Cards: the first `reviewed` ayat have been learned; a few are due today or overdue.
    for (let i = 1; i <= AYAH_COUNT; i++) {
      const learned = i <= s.reviewed;
      const dueOffset = learned ? (i % 5) - 2 : null; // -2..2 days from today
      const [card] = await db.insert(studentCards).values({
        studentId: student.id,
        ayahRef: `2:${i}`,
        state: learned ? (i % 4 === 0 ? 'mastered' : 'review') : 'new',
        stability: learned ? 3 + (i % 7) : 0,
        difficulty: learned ? 4 + (i % 3) : 5,
        reps: learned ? 2 + (i % 3) : 0,
        dueAt: dueOffset === null ? null : startOfLocalDay(addDays(today, dueOffset)),
        lastReviewedAt: learned ? startOfLocalDay(addDays(today, -(s.lastActiveDaysAgo + (i % 3)))) : null,
      }).returning();

      if (learned) {
        await db.insert(reviewLogs).values({
          cardId: card.id,
          rating: i % 6 === 0 ? 'hard' : 'good',
          wasCorrect: true,
          reviewedAt: new Date(startOfLocalDay(addDays(today, -s.lastActiveDaysAgo)).getTime() + (9 + (i % 8)) * 3_600_000),
        });
      }
    }

    await db.insert(streaks).values({
      studentId: student.id,
      currentStreak: s.lastActiveDaysAgo <= 1 ? 5 + Math.floor(s.reviewed / 3) : 0,
      longestStreak: 12,
      lastActiveDate: addDays(today, -s.lastActiveDaysAgo),
    });

    for (let d = 1; d <= 5; d++) {
      await db.insert(attendance).values({
        sectionId: section.id, studentId: student.id, date: addDays(today, -d),
        present: !s.absentDaysAgo.includes(d), markedBy: teacher.id,
      });
    }
  }

  const [guardian] = await db.insert(users).values({
    tenantId: tenant.id, role: 'mahram', displayNameAr: 'أبو مريم', whatsappE164: '+201000000201',
  }).returning();
  await db.insert(guardianLinks).values({ studentId: createdStudents[0].id, guardianId: guardian.id });

  await db.insert(tasmiSubmissions).values([
    {
      studentId: createdStudents[1].id, sectionId: section.id, startRef: '2:1', endRef: '2:5',
      audioUrl: 'https://storage.itqan.local/tasmi/demo-1.webm', durationMs: 95_000,
    },
    {
      studentId: createdStudents[2].id, sectionId: section.id, startRef: '2:6', endRef: '2:10',
      audioUrl: 'https://storage.itqan.local/tasmi/demo-2.webm', durationMs: 110_000,
    },
  ]);

  await db.insert(assignments).values(createdStudents.map((s) => ({
    sectionId: section.id, studentId: s.id, assignedBy: teacher.id,
    type: 'sabaq' as const, startRef: '2:21', endRef: '2:25', dueDate: addDays(today, 2),
  })));

  console.log(`Seeded tenant "${tenant.nameAr}" with ${STUDENTS.length} students. Join code: ${SEED_JOIN_CODE}`);
  });
}

// Run directly: `tsx src/db/seed.ts`
if (process.argv[1]?.endsWith('seed.ts')) {
  seed()
    .then(() => closeDb())
    .catch(async (err) => {
      console.error('Seed failed:', err);
      await closeDb();
      process.exit(1);
    });
}
