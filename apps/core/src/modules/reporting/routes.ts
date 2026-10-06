import { FastifyInstance } from 'fastify';
import { eq, and, gte, lte, count, sql, desc, avg } from 'drizzle-orm';
import { getDb } from '../../db';
import {
  studentCards, reviewLogs, sessions, attendance,
  sectionEnrollments, tasmiSubmissions, streaks,
} from '../../db/schema';

export async function reportingRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /v1/reports/student/:studentId — Student progress summary
  app.get('/reports/student/:studentId', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { studentId } = request.params as { studentId: string };

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

  // GET /v1/reports/section/:sectionId — Section overview for teacher
  app.get('/reports/section/:sectionId', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { sectionId } = request.params as { sectionId: string };

    const enrollments = await db.select()
      .from(sectionEnrollments)
      .where(eq(sectionEnrollments.sectionId, sectionId));

    const studentIds = enrollments.map(e => e.studentId);

    const tasmiStats = await db.select({
      count: count(),
      avgScore: avg(tasmiSubmissions.reviewWeightedTotal),
    })
    .from(tasmiSubmissions)
    .where(eq(tasmiSubmissions.sectionId, sectionId));

    return {
      sectionId,
      totalStudents: studentIds.length,
      tasmiSubmissions: tasmiStats[0]?.count ?? 0,
      avgTasmiScore: tasmiStats[0]?.avgScore ? Math.round(Number(tasmiStats[0].avgScore)) : null,
    };
  });

  // GET /v1/reports/attendance/:sectionId — Attendance report
  app.get('/reports/attendance/:sectionId', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { sectionId } = request.params as { sectionId: string };
    const { from, to } = request.query as { from?: string; to?: string };

    let query = db.select()
      .from(attendance)
      .where(eq(attendance.sectionId, sectionId))
      .orderBy(desc(attendance.date));

    if (from && to) {
      query = db.select()
        .from(attendance)
        .where(and(
          eq(attendance.sectionId, sectionId),
          gte(attendance.date, from),
          lte(attendance.date, to),
        ))
        .orderBy(desc(attendance.date));
    }

    return query;
  });
}
