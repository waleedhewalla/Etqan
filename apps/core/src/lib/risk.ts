import { and, count, gte, inArray, max, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { attendance, reviewLogs, streaks, studentCards } from '../db/schema';
import { addDays, localDate, startOfLocalDay } from './dates';

/** A student with no review for this many days is flagged for follow-up. */
export const INACTIVE_DAYS_AT_RISK = 3;
/** Attendance below this share over the last 30 days is flagged. */
export const ATTENDANCE_AT_RISK = 0.7;
/** Inactive this long (or never started) is a high risk on its own. */
export const INACTIVE_DAYS_HIGH_RISK = 14;

export type RiskReason = 'inactive' | 'attendance';

export interface StudentSignals {
  studentId: string;
  masteryPercent: number;
  cardsTotal: number;
  cardsDue: number;
  reviewsToday: number;
  lastActiveAt: Date | null;
  /** Whole days since her last review; null = she has never reviewed. */
  inactiveDays: number | null;
  /** Share of marked days she attended over the last 30 days; null = nothing marked. */
  attendanceRate: number | null;
  currentStreak: number;
}

/**
 * What the dashboards know about each student: progress, last activity, attendance and streak.
 * `sectionId` limits attendance to one halaqa (a teacher's view); without it, every halaqa counts.
 */
export async function loadStudentSignals(
  db: Database, studentIds: string[], options: { sectionId?: string; now?: Date } = {},
) {
  const signals = new Map<string, StudentSignals>();
  if (studentIds.length === 0) return signals;

  const now = options.now ?? new Date();
  const today = localDate(now);
  const since30 = addDays(today, -29);

  const cardStats = await db.select({
    studentId: studentCards.studentId,
    total: count(),
    settled: sql<number>`count(*) filter (where ${studentCards.state} in ('review','mastered'))`.mapWith(Number),
    due: sql<number>`count(*) filter (where ${studentCards.dueAt} <= ${now.toISOString()}::timestamptz)`.mapWith(Number),
  }).from(studentCards).where(inArray(studentCards.studentId, studentIds)).groupBy(studentCards.studentId);

  const lastReview = await db.select({
    studentId: studentCards.studentId,
    last: max(reviewLogs.reviewedAt),
    reviewsToday: sql<number>`count(*) filter (where ${reviewLogs.reviewedAt} >= ${startOfLocalDay(today).toISOString()}::timestamptz)`.mapWith(Number),
  }).from(reviewLogs)
    .innerJoin(studentCards, sql`${reviewLogs.cardId} = ${studentCards.id}`)
    .where(inArray(studentCards.studentId, studentIds))
    .groupBy(studentCards.studentId);

  const attendanceStats = await db.select({
    studentId: attendance.studentId,
    marked: count(),
    present: sql<number>`count(*) filter (where ${attendance.present})`.mapWith(Number),
  }).from(attendance)
    .where(and(
      inArray(attendance.studentId, studentIds), gte(attendance.date, since30),
      ...(options.sectionId ? [sql`${attendance.sectionId} = ${options.sectionId}`] : []),
    ))
    .groupBy(attendance.studentId);

  const streakRows = await db.select().from(streaks).where(inArray(streaks.studentId, studentIds));

  const by = <T extends { studentId: string }>(rows: T[]) => new Map(rows.map((r) => [r.studentId, r]));
  const cardsBy = by(cardStats);
  const reviewsBy = by(lastReview);
  const attendanceBy = by(attendanceStats);
  const streakBy = by(streakRows);

  for (const id of studentIds) {
    const cards = cardsBy.get(id);
    const reviews = reviewsBy.get(id);
    const att = attendanceBy.get(id);
    const lastActiveAt = reviews?.last ? new Date(reviews.last) : null;
    signals.set(id, {
      studentId: id,
      masteryPercent: cards?.total ? Math.round((cards.settled / cards.total) * 100) : 0,
      cardsTotal: cards?.total ?? 0,
      cardsDue: cards?.due ?? 0,
      reviewsToday: reviews?.reviewsToday ?? 0,
      lastActiveAt,
      inactiveDays: lastActiveAt ? Math.max(0, Math.floor((now.getTime() - lastActiveAt.getTime()) / 86_400_000)) : null,
      attendanceRate: att && att.marked > 0 ? att.present / att.marked : null,
      currentStreak: streakBy.get(id)?.currentStreak ?? 0,
    });
  }
  return signals;
}

export function riskReasons(s: Pick<StudentSignals, 'inactiveDays' | 'attendanceRate'>): RiskReason[] {
  const reasons: RiskReason[] = [];
  if (s.inactiveDays === null || s.inactiveDays >= INACTIVE_DAYS_AT_RISK) reasons.push('inactive');
  if (s.attendanceRate !== null && s.attendanceRate < ATTENDANCE_AT_RISK) reasons.push('attendance');
  return reasons;
}

/**
 * High when both signs are there, or she has been away for two weeks (or never started); otherwise medium.
 * Deliberately a plain rule with stated reasons, not a score: nothing here predicts anything.
 */
export function riskLevel(s: Pick<StudentSignals, 'inactiveDays' | 'attendanceRate'>): 'none' | 'medium' | 'high' {
  const reasons = riskReasons(s);
  if (reasons.length === 0) return 'none';
  if (reasons.length >= 2 || s.inactiveDays === null || s.inactiveDays >= INACTIVE_DAYS_HIGH_RISK) return 'high';
  return 'medium';
}
