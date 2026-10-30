import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, gte, lt, lte, count, sql, desc, avg, isNull, or, gt } from 'drizzle-orm';
import { getDb, type Database } from '../../db';
import {
  studentCards, reviewLogs, sessions, attendance, assignments, guardianLinks,
  sectionEnrollments, sections, tasmiSubmissions, streaks, users,
} from '../../db/schema';
import { canViewStudent, loadManagedSection, GUARDIAN_ROLE } from '../../lib/access';
import { addDays, localDate, startOfLocalDay, weekStart } from '../../lib/dates';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const weeklyQuerySchema = z.object({ week: isoDate.optional() });
const rangeQuerySchema = z.object({ from: isoDate.optional(), to: isoDate.optional() });

/**
 * One student's week (Saturday to Friday, institution time zone):
 * attendance, revision activity, tasmi' results and assignments.
 */
export async function buildWeeklyReport(db: Database, studentId: string, anyDayInWeek: string) {
  const start = weekStart(anyDayInWeek);
  const end = addDays(start, 6);
  const from = startOfLocalDay(start);
  const to = startOfLocalDay(addDays(start, 7));

  const [student] = await db.select({ id: users.id, displayNameAr: users.displayNameAr })
    .from(users).where(eq(users.id, studentId)).limit(1);
  if (!student) return null;

  const studentSections = await db.select({ id: sections.id, nameAr: sections.nameAr })
    .from(sectionEnrollments)
    .innerJoin(sections, eq(sectionEnrollments.sectionId, sections.id))
    .where(and(eq(sectionEnrollments.studentId, studentId), isNull(sectionEnrollments.droppedAt)));

  const attendanceRows = await db.select({
    date: attendance.date, present: attendance.present, notes: attendance.notes, sectionId: attendance.sectionId,
  }).from(attendance)
    .where(and(eq(attendance.studentId, studentId), gte(attendance.date, start), lte(attendance.date, end)))
    .orderBy(attendance.date);

  const reviews = await db.select({ reviewedAt: reviewLogs.reviewedAt, wasCorrect: reviewLogs.wasCorrect })
    .from(reviewLogs)
    .innerJoin(studentCards, eq(reviewLogs.cardId, studentCards.id))
    .where(and(eq(studentCards.studentId, studentId), gte(reviewLogs.reviewedAt, from), lt(reviewLogs.reviewedAt, to)));

  const activeDays = [...new Set(reviews.map((r) => localDate(new Date(r.reviewedAt))))].sort();

  const [cards] = await db.select({
    total: count(),
    settled: sql<number>`count(*) filter (where ${studentCards.state} in ('review','mastered'))`.mapWith(Number),
    due: sql<number>`count(*) filter (where ${studentCards.dueAt} <= now())`.mapWith(Number),
  }).from(studentCards).where(eq(studentCards.studentId, studentId));

  const tasmi = await db.select({
    id: tasmiSubmissions.id,
    startRef: tasmiSubmissions.startRef,
    endRef: tasmiSubmissions.endRef,
    submittedAt: tasmiSubmissions.submittedAt,
    verdict: tasmiSubmissions.reviewVerdict,
    score: tasmiSubmissions.reviewWeightedTotal,
    notes: tasmiSubmissions.reviewNotes,
  }).from(tasmiSubmissions)
    .where(and(
      eq(tasmiSubmissions.studentId, studentId),
      gte(tasmiSubmissions.submittedAt, from),
      lt(tasmiSubmissions.submittedAt, to),
    ))
    .orderBy(tasmiSubmissions.submittedAt);

  const weekAssignments = await db.select({
    id: assignments.id, type: assignments.type, startRef: assignments.startRef, endRef: assignments.endRef,
    dueDate: assignments.dueDate, completedAt: assignments.completedAt, score: assignments.score,
  }).from(assignments)
    .where(and(eq(assignments.studentId, studentId), gte(assignments.dueDate, start), lte(assignments.dueDate, end)))
    .orderBy(assignments.dueDate);

  const [streakRow] = await db.select().from(streaks).where(eq(streaks.studentId, studentId)).limit(1);

  const correct = reviews.filter((r) => r.wasCorrect).length;
  return {
    student,
    sections: studentSections,
    week: { start, end },
    attendance: {
      present: attendanceRows.filter((a) => a.present).length,
      absent: attendanceRows.filter((a) => !a.present).length,
      days: attendanceRows,
    },
    revision: {
      reviews: reviews.length,
      correctPercent: reviews.length ? Math.round((correct / reviews.length) * 100) : null,
      activeDays,
    },
    progress: {
      masteryPercent: cards?.total ? Math.round((cards.settled / cards.total) * 100) : 0,
      cardsTotal: cards?.total ?? 0,
      cardsDue: cards?.due ?? 0,
    },
    streak: {
      current: streakRow?.currentStreak ?? 0,
      longest: streakRow?.longestStreak ?? 0,
    },
    tasmi,
    assignments: weekAssignments,
  };
}

export async function reportingRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /v1/reports/student/:studentId — overall progress summary
  app.get('/reports/student/:studentId', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { studentId } = request.params as { studentId: string };
    if (!(await canViewStudent(db, request.user, studentId))) {
      return request.server.httpErrors.notFound('Student not found');
    }

    const [totalCards] = await db.select({ count: count() })
      .from(studentCards).where(eq(studentCards.studentId, studentId));

    const [masteredCards] = await db.select({ count: count() })
      .from(studentCards).where(and(
        eq(studentCards.studentId, studentId),
        eq(studentCards.state, 'mastered'),
      ));

    const [totalReviews] = await db.select({ count: count() })
      .from(reviewLogs)
      .innerJoin(studentCards, eq(reviewLogs.cardId, studentCards.id))
      .where(eq(studentCards.studentId, studentId));

    const [completedSessions] = await db.select({ count: count() })
      .from(sessions).where(and(
        eq(sessions.studentId, studentId),
        eq(sessions.status, 'completed'),
      ));

    const [avgDuration] = await db.select({ avg: avg(sessions.totalDurationMs) })
      .from(sessions).where(and(
        eq(sessions.studentId, studentId),
        eq(sessions.status, 'completed'),
      ));

    const [streakRow] = await db.select()
      .from(streaks).where(eq(streaks.studentId, studentId)).limit(1);

    return {
      studentId,
      totalCards: totalCards?.count ?? 0,
      masteredCards: masteredCards?.count ?? 0,
      masteryPercent: totalCards?.count
        ? Math.round(((masteredCards?.count ?? 0) / totalCards.count) * 100) : 0,
      totalReviews: totalReviews?.count ?? 0,
      completedSessions: completedSessions?.count ?? 0,
      avgSessionDurationMs: avgDuration?.avg ? Math.round(Number(avgDuration.avg)) : 0,
      streak: streakRow ?? { currentStreak: 0, longestStreak: 0 },
    };
  });

  // GET /v1/reports/student/:studentId/weekly?week=YYYY-MM-DD — printable weekly report
  app.get('/reports/student/:studentId/weekly', {
    schema: { querystring: weeklyQuerySchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const { studentId } = request.params as { studentId: string };
    const { week } = request.query as z.infer<typeof weeklyQuerySchema>;
    if (!(await canViewStudent(db, request.user, studentId))) {
      return request.server.httpErrors.notFound('Student not found');
    }
    const report = await buildWeeklyReport(db, studentId, week ?? localDate());
    if (!report) return request.server.httpErrors.notFound('Student not found');
    return report;
  });

  // GET /v1/reports/section/:sectionId — section overview for the teacher
  app.get('/reports/section/:sectionId', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { sectionId } = request.params as { sectionId: string };
    const section = await loadManagedSection(db, request.user, sectionId);
    if (!section) return request.server.httpErrors.notFound('Section not found');

    const enrollments = await db.select()
      .from(sectionEnrollments)
      .where(and(eq(sectionEnrollments.sectionId, sectionId), isNull(sectionEnrollments.droppedAt)));

    const tasmiStats = await db.select({
      count: count(),
      avgScore: avg(tasmiSubmissions.reviewWeightedTotal),
      pending: sql<number>`count(*) filter (where ${tasmiSubmissions.reviewVerdict} is null)`.mapWith(Number),
    })
      .from(tasmiSubmissions)
      .where(eq(tasmiSubmissions.sectionId, sectionId));

    return {
      sectionId,
      totalStudents: enrollments.length,
      tasmiSubmissions: tasmiStats[0]?.count ?? 0,
      pendingReviews: tasmiStats[0]?.pending ?? 0,
      avgTasmiScore: tasmiStats[0]?.avgScore ? Math.round(Number(tasmiStats[0].avgScore)) : null,
    };
  });

  // GET /v1/reports/attendance/:sectionId?from=&to= — attendance records
  app.get('/reports/attendance/:sectionId', {
    schema: { querystring: rangeQuerySchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const { sectionId } = request.params as { sectionId: string };
    const section = await loadManagedSection(db, request.user, sectionId);
    if (!section) return request.server.httpErrors.notFound('Section not found');
    const { from, to } = request.query as z.infer<typeof rangeQuerySchema>;

    const filters = [eq(attendance.sectionId, sectionId)];
    if (from) filters.push(gte(attendance.date, from));
    if (to) filters.push(lte(attendance.date, to));

    return db.select().from(attendance).where(and(...filters)).orderBy(desc(attendance.date));
  });

  // GET /v1/guardian/students — the guardian's linked students with this week's report
  app.get('/guardian/students', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const user = request.user;
    if (user.role !== GUARDIAN_ROLE) return request.server.httpErrors.forbidden('Guardians only');

    const links = await db.select({ studentId: guardianLinks.studentId })
      .from(guardianLinks)
      .where(and(
        eq(guardianLinks.guardianId, user.sub),
        or(isNull(guardianLinks.expiresAt), gt(guardianLinks.expiresAt, new Date())),
      ));

    const today = localDate();
    const reports = [];
    for (const { studentId } of links) {
      const report = await buildWeeklyReport(db, studentId, today);
      if (report) reports.push(report);
    }
    return { students: reports };
  });
}
