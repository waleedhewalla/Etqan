/** Where each sura of a student's plan stands: how many verses, how many memorized, solid (mastered) and due. */
import { count, eq, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { studentCards } from '../db/schema';

export interface SurahProgress { sura: number; total: number; memorized: number; mastered: number; due: number }

const suraOf = sql`split_part(${studentCards.ayahRef}, ':', 1)::int`;

/** Suras that are in her plan, in mushaf order. Memorized means in review or mastered; due excludes verses not yet learned. */
export async function loadSurahMap(db: Database, studentId: string): Promise<SurahProgress[]> {
  return db.select({
    sura: sql<number>`${suraOf}`.mapWith(Number),
    total: count(),
    memorized: sql<number>`count(*) filter (where ${studentCards.state} in ('review', 'mastered'))`.mapWith(Number),
    mastered: sql<number>`count(*) filter (where ${studentCards.state} = 'mastered')`.mapWith(Number),
    due: sql<number>`count(*) filter (where ${studentCards.state} <> 'new' and ${studentCards.dueAt} <= now())`.mapWith(Number),
  }).from(studentCards)
    .where(eq(studentCards.studentId, studentId))
    .groupBy(suraOf)
    .orderBy(suraOf);
}
