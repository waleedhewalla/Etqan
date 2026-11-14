/**
 * Period tests: a student's attempts at passing the periods of her halaqa's program, where she stands because of them,
 * and what the app can propose for each criterion from what it already knows (graded recitations and revision results).
 * The teacher always has the last word on every score.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  RETEST_AFTER_DAYS, SLOWDOWN_AFTER_FAILURES, assess, compareRefs, effectiveWeights, hifzWeeksFor, parseRef, slowerPace, standingFrom,
  type Assessment, type Criterion, type Weights,
} from '@itqan/quran';
import type { Database } from '../db';
import { hifzPeriodResults, reviewLogs, studentCards, tasmiSubmissions } from '../db/schema';
import { ayatOf, type PeriodPlan } from './hifz-program';
import { addDays, localDate } from './dates';

export type Result = typeof hifzPeriodResults.$inferSelect;

const DAY = 86_400_000;
/** Fewest revision results that say anything about how she is doing. */
const MIN_REVIEWS = 10;

/** Her attempts at a program, in the order they were made, leaving out those that were voided. */
export async function loadAttempts(db: Database, studentIds: string[], programId: string): Promise<Map<string, Result[]>> {
  const out = new Map<string, Result[]>(studentIds.map((id) => [id, []]));
  if (studentIds.length === 0) return out;
  const rows = await db.select().from(hifzPeriodResults)
    .where(and(inArray(hifzPeriodResults.studentId, studentIds), eq(hifzPeriodResults.programId, programId), isNull(hifzPeriodResults.voidedAt)))
    .orderBy(asc(hifzPeriodResults.createdAt));
  for (const r of rows) out.get(r.studentId)!.push(r);
  return out;
}

/** Whether revision counts in this period: only when an earlier period had verses to revise. */
export const reviewApplies = (periods: PeriodPlan[], index: number) => periods.slice(0, index).some((p) => p.kind === 'hifz');

/** The criterion a result was weakest on, worked out again from what was stored. */
export function weakestOf(r: Result): Criterion | null {
  return assess(
    { hifz: r.scoreHifz, tajweed: r.scoreTajweed, review: r.scoreReview ?? 0, retention: r.scoreRetention },
    { weights: r.weights, passScore: r.passScore, minCriterionPct: r.minCriterionPct },
    r.scoreReview !== null,
  ).weakest;
}

/** What a teacher sees of an attempt: every score and the rules that decided it. */
export function teacherResult(r: Result) {
  return {
    id: r.id, periodIndex: r.periodIndex, periodName: r.periodName, attempt: r.attempt, outcome: r.outcome, total: r.total,
    scores: { hifz: r.scoreHifz, tajweed: r.scoreTajweed, review: r.scoreReview, retention: r.scoreRetention },
    weights: r.weights, passScore: r.passScore, minCriterionPct: r.minCriterionPct, failed: r.failedRules, note: r.note,
    proposals: r.proposals, createdAt: r.createdAt,
  };
}

/** What a student sees: the outcome, the total and the criterion to work on, not every score. */
export function studentResult(r: Result) {
  return { periodIndex: r.periodIndex, periodName: r.periodName, attempt: r.attempt, outcome: r.outcome, total: r.total, weakest: weakestOf(r), createdAt: r.createdAt };
}

/**
 * Where a student stands in a program. After a period took two or more failed attempts, the one that follows is worked at
 * a slower pace (`personal`), one step down, with its weeks worked out again.
 */
export function describeStanding(results: Result[], periods: PeriodPlan[], hifzDaysPerWeek: number, now = new Date()) {
  const st = standingFrom(results.map((r) => ({ periodIndex: r.periodIndex, outcome: r.outcome })), periods.length);
  const last = results[results.length - 1] ?? null;
  const period = periods[st.current] ?? null;
  const slowdown = Boolean(period && st.current > 0 && period.kind === 'hifz' && (st.failuresBefore[st.current - 1] ?? 0) >= SLOWDOWN_AFTER_FAILURES);
  const personal = period && slowdown
    ? (() => {
      const pagesPerDay = slowerPace(period.pagesPerDay);
      const hifzWeeks = hifzWeeksFor(period.pages, pagesPerDay, period.extraPct, hifzDaysPerWeek);
      return { pagesPerDay, hifzWeeks, weeks: hifzWeeks + 1 };
    })()
    : null;
  // A failed attempt is followed by a week of work; the retest is allowed from the date this gives.
  const retestOn = last && last.outcome === 'repeat' && last.periodIndex === st.current ? addDays(localDate(last.createdAt), RETEST_AFTER_DAYS) : null;
  const waiting = retestOn !== null && retestOn > localDate(now);
  return { ...st, last, slowdown, personal, retestOn, retestWaiting: waiting };
}

export interface Proposal { score: number; basis: { kind: 'recitations' | 'reviews'; n: number } }
export type Proposals = Partial<Record<Criterion, Proposal | null>>;

const within = (ref: string, start: string, end: string) => {
  const r = parseRef(ref); const a = parseRef(start); const b = parseRef(end);
  return Boolean(r && a && b && compareRefs(r, a) >= 0 && compareRefs(r, b) <= 0);
};

/** Of her revision results on these verses since `since`, the share she got right, and how many there were. */
async function revisionShare(db: Database, studentId: string, refs: string[], since: Date): Promise<{ share: number; n: number } | null> {
  if (refs.length === 0) return null;
  const [row] = await db.select({ n: sql<number>`count(*)::int`, right: sql<number>`count(*) filter (where ${reviewLogs.wasCorrect})::int` })
    .from(reviewLogs).innerJoin(studentCards, eq(reviewLogs.cardId, studentCards.id))
    .where(and(eq(studentCards.studentId, studentId), inArray(studentCards.ayahRef, refs), gte(reviewLogs.reviewedAt, since)));
  return row && row.n >= MIN_REVIEWS ? { share: row.right / row.n, n: row.n } : null;
}

/**
 * What the app can suggest for each criterion, out of its weight: memorization and tajweed from the grades her teacher gave
 * her recent recitations of this period's verses; revision from how she did on the verses of earlier periods; retention from
 * how she did on this period's verses lately. A criterion with too little to go on has no proposal.
 */
export async function proposalsFor(db: Database, studentId: string, periods: PeriodPlan[], index: number, weights: Weights, now = new Date()): Promise<Proposals> {
  const period = periods[index];
  const out: Proposals = { hifz: null, tajweed: null, review: null, retention: null };
  if (!period || period.kind !== 'hifz' || !period.startRef || !period.endRef) return out;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const graded = await db.select({ end: tasmiSubmissions.endRef, hifz: tasmiSubmissions.reviewHifzScore, tajweed: tasmiSubmissions.reviewTajweedScore })
    .from(tasmiSubmissions)
    .where(and(
      eq(tasmiSubmissions.studentId, studentId), isNotNull(tasmiSubmissions.reviewedAt), inArray(tasmiSubmissions.reviewVerdict, ['approved', 'redo']),
      gte(tasmiSubmissions.reviewedAt, new Date(now.getTime() - 60 * DAY)),
    )).orderBy(desc(tasmiSubmissions.reviewedAt)).limit(50);
  const mine = graded.filter((g) => within(g.end, period.startRef!, period.endRef!)).slice(0, 5);
  const average = (key: 'hifz' | 'tajweed') => {
    const values = mine.map((g) => g[key]).filter((v): v is number => typeof v === 'number');
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const h = average('hifz'); const t = average('tajweed');
  if (h !== null) out.hifz = { score: round1((h / 100) * weights.hifz), basis: { kind: 'recitations', n: mine.length } };
  if (t !== null) out.tajweed = { score: round1((t / 100) * weights.tajweed), basis: { kind: 'recitations', n: mine.length } };

  if (weights.review > 0) {
    const earlier = periods.slice(0, index).filter((p) => p.kind === 'hifz').flatMap((p) => ayatOf(p.startRef!, p.endRef!));
    const r = await revisionShare(db, studentId, earlier, new Date(now.getTime() - 30 * DAY));
    if (r) out.review = { score: round1(r.share * weights.review), basis: { kind: 'reviews', n: r.n } };
  }
  const r = await revisionShare(db, studentId, ayatOf(period.startRef, period.endRef), new Date(now.getTime() - 14 * DAY));
  if (r) out.retention = { score: round1(r.share * weights.retention), basis: { kind: 'reviews', n: r.n } };
  return out;
}
