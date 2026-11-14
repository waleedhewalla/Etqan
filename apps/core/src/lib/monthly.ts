import { and, asc, eq, gte, lt, lte } from 'drizzle-orm';
import { compareRefs, parseRef } from '@itqan/quran';
import type { Database } from '../db';
import { attendance, studentMonthlyAppraisals, tasmiSubmissions, users } from '../db/schema';
import type { FlaggedWord } from './asr/types';
import { addDays, localDate, startOfLocalDay } from './dates';

/**
 * A student's monthly record: what went wrong (issues), the total appraisal of her recitations,
 * and the degree that follows from it.
 *
 * How the numbers are derived:
 * - Each reviewed recitation already carries a weighted total out of 100 (memorization 50%, tajweed 30%,
 *   fluency 20%), set when the teacher reviews it.
 * - The TOTAL APPRAISAL is the plain average of those totals over the month's recitations whose verdict is
 *   final ("approved" or "redo"). A recitation sent to the sheikha ("flagged") or not reviewed yet does not
 *   count until it is decided.
 * - The DEGREE is that average rounded to a whole number out of 100, with the grade it falls in.
 */

/** Grade bands used by Egyptian universities, highest first. */
export const GRADE_BANDS = [
  { min: 85, grade: 'excellent' },
  { min: 75, grade: 'very_good' },
  { min: 65, grade: 'good' },
  { min: 50, grade: 'pass' },
  { min: 0, grade: 'weak' },
] as const;
export type Grade = typeof GRADE_BANDS[number]['grade'];

/** A skill whose monthly average is under this is listed as an issue. */
export const WEAK_SKILL_BELOW = 70;
const MAX_LISTED_AYAT = 20;

export function gradeFor(score: number): Grade {
  return GRADE_BANDS.find((b) => score >= b.min)!.grade;
}

type Skill = 'hifz' | 'tajweed' | 'fluency';

export interface MonthlyRecitation {
  id: string;
  startRef: string;
  endRef: string;
  submittedAt: Date;
  verdict: 'approved' | 'redo' | 'flagged' | null;
  hifz: number | null;
  tajweed: number | null;
  fluency: number | null;
  total: number | null;
  notes: string | null;
  flags: FlaggedWord[];
  hasVoiceReply: boolean;
}

export interface MonthlyInput {
  month: string;
  recitations: MonthlyRecitation[];
  attendance: { date: string; present: boolean }[];
  appraisal: { note: string; teacherName: string | null; updatedAt: Date } | null;
}

export type MonthlyIssue =
  | { kind: 'no_recitations' }
  | { kind: 'redo'; count: number; ranges: { startRef: string; endRef: string }[] }
  | { kind: 'mistakes'; count: number; byType: Record<FlaggedWord['type'], number>; ayat: string[] }
  | { kind: 'weak_skill'; skill: Skill; average: number }
  | { kind: 'absence'; count: number; dates: string[] };

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function buildMonthlyRecord(input: MonthlyInput) {
  const { recitations } = input;
  // Only a final verdict counts towards the appraisal.
  const counted = recitations.filter((r) => (r.verdict === 'approved' || r.verdict === 'redo') && r.total !== null);
  const average = mean(counted.map((r) => r.total!));
  const skillAverage = (skill: Skill) => mean(counted.map((r) => r[skill]).filter((v): v is number => v !== null));
  const skills: Record<Skill, number | null> = { hifz: skillAverage('hifz'), tajweed: skillAverage('tajweed'), fluency: skillAverage('fluency') };

  const issues: MonthlyIssue[] = [];
  if (recitations.length === 0) issues.push({ kind: 'no_recitations' });

  const redo = recitations.filter((r) => r.verdict === 'redo');
  if (redo.length) issues.push({ kind: 'redo', count: redo.length, ranges: redo.map((r) => ({ startRef: r.startRef, endRef: r.endRef })) });

  // Mistakes the teacher confirmed; flags she dismissed or never decided are not the student's issue.
  const confirmed = recitations.flatMap((r) => r.flags.filter((f) => f.decision === 'confirmed'));
  if (confirmed.length) {
    const byType = { missing: 0, wrong: 0, added: 0 };
    for (const f of confirmed) byType[f.type] += 1;
    const ayat = [...new Set(confirmed.map((f) => f.ayahRef))]
      .sort((a, b) => compareRefs(parseRef(a) ?? [0, 0], parseRef(b) ?? [0, 0]))
      .slice(0, MAX_LISTED_AYAT);
    issues.push({ kind: 'mistakes', count: confirmed.length, byType, ayat });
  }

  for (const skill of ['hifz', 'tajweed', 'fluency'] as const) {
    const value = skills[skill];
    if (value !== null && value < WEAK_SKILL_BELOW) issues.push({ kind: 'weak_skill', skill, average: round1(value) });
  }

  const absent = input.attendance.filter((a) => !a.present).map((a) => a.date).sort();
  if (absent.length) issues.push({ kind: 'absence', count: absent.length, dates: absent });

  const score = average === null ? null : Math.round(average);
  return {
    month: input.month,
    recitations: {
      submitted: recitations.length,
      counted: counted.length,
      approved: recitations.filter((r) => r.verdict === 'approved').length,
      redo: redo.length,
      awaiting: recitations.filter((r) => r.verdict === null || r.verdict === 'flagged').length,
    },
    totalAppraisal: {
      average: average === null ? null : round1(average),
      hifz: skills.hifz === null ? null : round1(skills.hifz),
      tajweed: skills.tajweed === null ? null : round1(skills.tajweed),
      fluency: skills.fluency === null ? null : round1(skills.fluency),
    },
    degree: { score, outOf: 100, grade: score === null ? null : gradeFor(score) },
    issues,
    attendance: { present: input.attendance.length - absent.length, absent: absent.length },
    appraisal: input.appraisal,
    items: recitations.map((r) => ({
      id: r.id, startRef: r.startRef, endRef: r.endRef, submittedAt: r.submittedAt,
      verdict: r.verdict, total: r.total === null ? null : round1(r.total), notes: r.notes, hasVoiceReply: r.hasVoiceReply,
    })),
  };
}

export type MonthlyRecord = ReturnType<typeof buildMonthlyRecord>;

export const isMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
export const currentMonth = (at: Date = new Date()) => localDate(at).slice(0, 7);

/** First day of the month after `month` (YYYY-MM), as YYYY-MM-DD. */
function nextMonthStart(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Loads a student's month from the database and builds her record. Null when she does not exist. */
export async function loadMonthlyRecord(db: Database, studentId: string, month: string) {
  const [student] = await db.select({ id: users.id, displayNameAr: users.displayNameAr })
    .from(users).where(eq(users.id, studentId)).limit(1);
  if (!student) return null;

  const first = `${month}-01`;
  const next = nextMonthStart(month);
  const rows = await db.select().from(tasmiSubmissions)
    .where(and(
      eq(tasmiSubmissions.studentId, studentId),
      gte(tasmiSubmissions.submittedAt, startOfLocalDay(first)),
      lt(tasmiSubmissions.submittedAt, startOfLocalDay(next)),
    ))
    .orderBy(asc(tasmiSubmissions.submittedAt));
  const days = await db.select({ date: attendance.date, present: attendance.present }).from(attendance)
    .where(and(eq(attendance.studentId, studentId), gte(attendance.date, first), lte(attendance.date, addDays(next, -1))));
  const [appraisal] = await db.select({
    note: studentMonthlyAppraisals.note, updatedAt: studentMonthlyAppraisals.updatedAt, teacherName: users.displayNameAr,
  }).from(studentMonthlyAppraisals)
    .leftJoin(users, eq(studentMonthlyAppraisals.teacherId, users.id))
    .where(and(eq(studentMonthlyAppraisals.studentId, studentId), eq(studentMonthlyAppraisals.month, month))).limit(1);

  const record = buildMonthlyRecord({
    month,
    recitations: rows.map((r) => ({
      id: r.id, startRef: r.startRef, endRef: r.endRef, submittedAt: r.submittedAt, verdict: r.reviewVerdict,
      hifz: r.reviewHifzScore, tajweed: r.reviewTajweedScore, fluency: r.reviewFluencyScore, total: r.reviewWeightedTotal,
      notes: r.reviewNotes, flags: (r.aiFlaggedErrors ?? []) as FlaggedWord[], hasVoiceReply: Boolean(r.replyAudioKey),
    })),
    attendance: days,
    appraisal: appraisal ?? null,
  });
  return { student, ...record };
}
