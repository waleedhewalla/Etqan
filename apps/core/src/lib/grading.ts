import { and, eq, inArray } from 'drizzle-orm';
import { compareRefs, parseRef } from '@itqan/quran';
import type { Rating } from '@itqan/types';
import type { Database } from '../db';
import { studentCards } from '../db/schema';
import { applyRating, recordStudentActivity } from './cards';
import type { FlaggedWord } from './asr/types';

export type Verdict = 'approved' | 'redo' | 'flagged';

export interface GradingInput {
  verdict: Verdict;
  /** The teacher's 0–100 memorization score. */
  hifzScore: number;
  /** Ayat in the recitation, as "sura:ayah". */
  ayat: string[];
  /** Flags with the teacher's decisions applied. */
  flags: FlaggedWord[];
}

/** From this memorization score a clean ayah counts as effortless. */
export const EASY_SCORE = 95;

/**
 * How the teacher's review turns into a revision rating for each ayah recited.
 *
 * - redo: she must recite again, so every ayah comes back soon ("again").
 * - flagged: it is waiting on the sheikha, so nothing is rescheduled yet.
 * - approved: each ayah is rated on its own. A memory error the teacher confirmed (a missing or wrong
 *   word) counts against that ayah: two or more → "again", one → "hard". A clean ayah is "good", or
 *   "easy" when her memorization score is high. Flags she dismissed or did not decide never count,
 *   and neither do added words, which are not memory errors. Tajweed is not used.
 */
export function ratingsFor({ verdict, hifzScore, ayat, flags }: GradingInput): Map<string, Rating> {
  const ratings = new Map<string, Rating>();
  if (verdict === 'flagged') return ratings;

  for (const ref of ayat) {
    if (verdict === 'redo') { ratings.set(ref, 'again'); continue; }
    const errors = flags.filter((f) => f.ayahRef === ref && f.decision === 'confirmed' && f.type !== 'added').length;
    ratings.set(ref, errors >= 2 ? 'again' : errors === 1 ? 'hard' : hifzScore >= EASY_SCORE ? 'easy' : 'good');
  }
  return ratings;
}

/** Every "sura:ayah" from start to end, in order. `counts` are the Hafs ayah counts per sura. */
export function ayatBetween(startRef: string, endRef: string, counts: readonly number[]): string[] {
  const start = parseRef(startRef);
  const end = parseRef(endRef);
  if (!start || !end || compareRefs(start, end) > 0) return [];
  const out: string[] = [];
  for (let sura = start[0]; sura <= end[0]; sura++) {
    const from = sura === start[0] ? start[1] : 1;
    const to = sura === end[0] ? end[1] : counts[sura - 1];
    for (let ayah = from; ayah <= to; ayah++) out.push(`${sura}:${ayah}`);
  }
  return out;
}

/**
 * Reschedules the student's revision cards for the ayat she recited and counts the review as
 * activity for her streak. Only cards she already has are touched. Returns how many were rescheduled.
 */
export async function gradeRecitation(db: Database, studentId: string, input: GradingInput) {
  const ratings = ratingsFor(input);
  if (ratings.size === 0) return 0;

  const cards = await db.select().from(studentCards)
    .where(and(eq(studentCards.studentId, studentId), inArray(studentCards.ayahRef, [...ratings.keys()])));
  for (const card of cards) await applyRating(db, card, ratings.get(card.ayahRef)!);
  if (cards.length) await recordStudentActivity(db, studentId);
  return cards.length;
}
