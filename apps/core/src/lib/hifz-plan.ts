import { and, eq, inArray } from 'drizzle-orm';
import { AYAH_COUNTS, parseRef, compareRefs } from '@itqan/quran';
import type { Database } from '../db';
import { studentCards, users } from '../db/schema';
import { ayatBetween } from './grading';

/** The most ayat a teacher can add in one step: about a juz and a half. */
export const MAX_PLAN_AYAT = 300;
/** How many already-memorized ayat come up for first revision per day, unless the teacher says otherwise. */
export const DEFAULT_REVISION_PER_DAY = 20;
/** New ayat a student is offered per day unless her teacher sets another pace. */
export const DEFAULT_NEW_PER_DAY = 10;
export const MAX_NEW_PER_DAY = 50;
/** Starting memory strength, in days, for an ayah the student memorized before joining. */
const MEMORIZED_STABILITY = 3;

export type PlanStatus = 'memorized' | 'new';

export class PlanRangeError extends Error {}

/** The ayat of a range, or a PlanRangeError saying what is wrong with it. */
export function planAyat(startRef: string, endRef: string): string[] {
  const start = parseRef(startRef);
  const end = parseRef(endRef);
  if (!start || !end) throw new PlanRangeError('Unknown ayah reference');
  if (compareRefs(start, end) > 0) throw new PlanRangeError('Range ends before it starts');
  const ayat = ayatBetween(startRef, endRef, AYAH_COUNTS);
  if (ayat.length > MAX_PLAN_AYAT) throw new PlanRangeError(`At most ${MAX_PLAN_AYAT} ayat at a time`);
  return ayat;
}

/**
 * Gives the student a revision card for every ayah in the range she does not have one for yet.
 * `memorized` ayat enter revision straight away, spread `perDay` a day from `now` so a whole juz is
 * not due at once; `new` ayat wait in her new-memorization queue. Existing cards are left untouched.
 */
export async function addToPlan(
  db: Database,
  studentId: string,
  ayat: string[],
  status: PlanStatus,
  { perDay = DEFAULT_REVISION_PER_DAY, now = new Date() }: { perDay?: number; now?: Date } = {},
): Promise<{ added: number; skipped: number }> {
  if (ayat.length === 0) return { added: 0, skipped: 0 };
  const existing = await db.select({ ayahRef: studentCards.ayahRef }).from(studentCards)
    .where(and(eq(studentCards.studentId, studentId), inArray(studentCards.ayahRef, ayat)));
  const have = new Set(existing.map((r) => r.ayahRef));
  const fresh = ayat.filter((ref) => !have.has(ref));
  if (fresh.length === 0) return { added: 0, skipped: ayat.length };

  const rows = fresh.map((ayahRef, i) => status === 'memorized'
    ? {
        studentId, ayahRef, state: 'review' as const,
        stability: MEMORIZED_STABILITY, difficulty: 5,
        dueAt: new Date(now.getTime() + Math.floor(i / perDay) * 86_400_000),
      }
    : { studentId, ayahRef, state: 'new' as const, dueAt: null });
  const inserted = await db.insert(studentCards).values(rows).onConflictDoNothing().returning({ id: studentCards.id });
  return { added: inserted.length, skipped: ayat.length - inserted.length };
}

/** Removes the cards of a range the student has never reviewed. Reviewed cards hold her history and stay. */
export async function removeFromPlan(db: Database, studentId: string, ayat: string[]): Promise<{ removed: number; kept: number }> {
  if (ayat.length === 0) return { removed: 0, kept: 0 };
  const inRange = and(eq(studentCards.studentId, studentId), inArray(studentCards.ayahRef, ayat));
  const before = await db.select({ id: studentCards.id, reps: studentCards.reps }).from(studentCards).where(inRange);
  const untouched = before.filter((c) => c.reps === 0).map((c) => c.id);
  if (untouched.length > 0) {
    await db.delete(studentCards).where(and(inArray(studentCards.id, untouched), eq(studentCards.reps, 0)));
  }
  return { removed: untouched.length, kept: before.length - untouched.length };
}

export interface PlanRange { startRef: string; endRef: string; count: number; status: PlanStatus }

/** Follows `ref` directly in the mushaf? */
function follows(prev: [number, number], ref: [number, number]): boolean {
  if (ref[0] === prev[0]) return ref[1] === prev[1] + 1;
  return ref[0] === prev[0] + 1 && ref[1] === 1 && prev[1] === AYAH_COUNTS[prev[0] - 1];
}

/** The student's cards as mushaf-ordered runs: what she is revising and what is waiting to be memorized. */
export async function loadPlan(db: Database, studentId: string) {
  const cards = await db.select({ ayahRef: studentCards.ayahRef, state: studentCards.state })
    .from(studentCards).where(eq(studentCards.studentId, studentId));
  const parsed = cards
    .map((c) => ({ ref: parseRef(c.ayahRef), ayahRef: c.ayahRef, status: (c.state === 'new' ? 'new' : 'memorized') as PlanStatus }))
    .filter((c): c is { ref: [number, number]; ayahRef: string; status: PlanStatus } => c.ref !== null)
    .sort((a, b) => compareRefs(a.ref, b.ref));

  const ranges: PlanRange[] = [];
  let prev: { ref: [number, number]; status: PlanStatus } | null = null;
  for (const c of parsed) {
    const last = ranges[ranges.length - 1];
    if (last && prev && prev.status === c.status && follows(prev.ref, c.ref)) {
      last.endRef = c.ayahRef;
      last.count += 1;
    } else {
      ranges.push({ startRef: c.ayahRef, endRef: c.ayahRef, count: 1, status: c.status });
    }
    prev = c;
  }
  const memorized = parsed.filter((c) => c.status === 'memorized').length;
  return { total: parsed.length, memorized, new: parsed.length - memorized, newPerDay: await newPerDay(db, studentId), ranges };
}

/** How many new ayat the student is offered per day. */
export async function newPerDay(db: Database, studentId: string): Promise<number> {
  const [row] = await db.select({ pace: users.newAyatPerDay }).from(users).where(eq(users.id, studentId)).limit(1);
  return row?.pace ?? DEFAULT_NEW_PER_DAY;
}

export async function setNewPerDay(db: Database, studentId: string, pace: number): Promise<void> {
  await db.update(users).set({ newAyatPerDay: pace, updatedAt: new Date() }).where(eq(users.id, studentId));
}
