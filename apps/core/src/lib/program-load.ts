/** Loading a program and where a halaqa is in it, shared by the admin screens, the halaqa's screens and the period tests. */
import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db';
import { hifzPeriodResults, hifzProgramPeriods, hifzPrograms, sections } from '../db/schema';
import { localDate } from './dates';
import { measureRange, planPeriods, positionOn, programWarnings, type Measure, type PeriodConfig } from './hifz-program';

export type Program = typeof hifzPrograms.$inferSelect;
export type PeriodRow = typeof hifzProgramPeriods.$inferSelect;

export const toConfig = (p: PeriodRow): PeriodConfig => ({
  id: p.id, nameAr: p.nameAr, goalAr: p.goalAr, startRef: p.startRef, endRef: p.endRef,
  pagesPerDay: p.pagesPerDay, extraPct: p.extraPct, fixedWeeks: p.fixedWeeks,
});

export const measureAll = (periods: PeriodConfig[]): (Measure | null)[] =>
  periods.map((p) => (p.startRef && p.endRef ? measureRange(p.startRef, p.endRef) : null));

/** A program as the admin sees it: its settings, its periods with their weeks, and what to look at. */
export async function programView(db: Database, program: Program) {
  const rows = await db.select().from(hifzProgramPeriods).where(eq(hifzProgramPeriods.programId, program.id)).orderBy(asc(hifzProgramPeriods.sortOrder));
  const configs = rows.map(toConfig);
  const periods = planPeriods(configs, program.hifzDaysPerWeek, measureAll(configs));
  const [used] = await db.select({ n: sections.id }).from(sections).where(eq(sections.hifzProgramId, program.id)).limit(1);
  const [tested] = await db.select({ n: hifzPeriodResults.id }).from(hifzPeriodResults).where(eq(hifzPeriodResults.programId, program.id)).limit(1);
  return {
    id: program.id, nameAr: program.nameAr, active: program.active, hifzDaysPerWeek: program.hifzDaysPerWeek,
    weights: { hifz: program.weightHifz, tajweed: program.weightTajweed, review: program.weightReview, retention: program.weightRetention },
    passScore: program.passScore, minCriterionPct: program.minCriterionPct,
    periods,
    totals: {
      pages: Math.round(periods.reduce((n, p) => n + p.pages, 0) * 10) / 10,
      weeks: periods.reduce((n, p) => n + p.weeks, 0),
      hifzWeeks: periods.reduce((n, p) => n + p.hifzWeeks, 0),
    },
    warnings: programWarnings(periods),
    inUse: Boolean(used),
    /** Students have been tested on it: it can be archived but not deleted. */
    hasResults: Boolean(tested),
  };
}

export type ProgramView = Awaited<ReturnType<typeof programView>>;

/** The halaqa's program and where the halaqa is in it today, or null when it follows none (or the program has no periods). */
export async function sectionStanding(db: Database, section: typeof sections.$inferSelect, today = localDate()) {
  if (!section.hifzProgramId || !section.hifzProgramStart) return null;
  const [program] = await db.select().from(hifzPrograms).where(eq(hifzPrograms.id, section.hifzProgramId)).limit(1);
  if (!program) return null;
  const full = await programView(db, program);
  if (full.periods.length === 0) return null;
  return { full, position: positionOn(full.periods, section.hifzProgramStart, today), program };
}
