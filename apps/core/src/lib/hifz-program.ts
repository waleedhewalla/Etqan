/**
 * A memorization program: the periods a halaqa works through, the verses required in each, and the weeks
 * that follow from them. The admin sets the verses and the pace; everything else is worked out here, so
 * changing a period's verses or pace re-draws the whole schedule.
 *
 * - A hifz period lasts as many weeks as its pages need at its pace, plus one week for the period's test.
 * - A consolidation period has no new verses and a number of weeks the admin gives.
 * - Weeks run Sunday to Thursday; Friday and Saturday are outside the program.
 */
import { AYAH_COUNTS, compareRefs, countAyat, estimatePages, hifzWeeksFor, parseRef } from '@itqan/quran';
import { addDays, daysBetween } from './dates';

/** Most verses one period may require (about 145 pages). */
export const MAX_PERIOD_AYAT = 1500;
/** A period shorter or longer than this is flagged, not refused. */
export const GOOD_HIFZ_WEEKS = { min: 3, max: 6 } as const;

export interface PeriodConfig {
  id?: string;
  nameAr: string;
  goalAr: string | null;
  startRef: string | null;
  endRef: string | null;
  pagesPerDay: number;
  extraPct: number;
  fixedWeeks: number | null;
}

export interface Measure { ayat: number; pages: number }

/** The size of a range of verses. */
export function measureRange(startRef: string, endRef: string): Measure {
  return { ayat: countAyat(parseRef(startRef)!, parseRef(endRef)!), pages: estimatePages(startRef, endRef) };
}

export interface PeriodPlan extends PeriodConfig {
  kind: 'hifz' | 'consolidation';
  ayat: number;
  /** Estimated mushaf pages, to one decimal. */
  pages: number;
  /** Weeks of new memorization; 0 for a consolidation period. */
  hifzWeeks: number;
  /** All weeks of the period, its test week included. */
  weeks: number;
  /** Weeks since the program began at which this period starts (0-based). */
  startWeek: number;
}

export type Warning =
  | { type: 'overlap'; a: number; b: number }
  | { type: 'short' | 'long'; period: number; weeks: number };

/** The program's periods in order, each with its size and weeks and the week it starts at. */
export function planPeriods(
  periods: PeriodConfig[], hifzDaysPerWeek: number, measures: (Measure | null)[],
): PeriodPlan[] {
  let startWeek = 0;
  return periods.map((p, i) => {
    const m = measures[i];
    const hifz = p.startRef !== null && m !== null;
    const hifzWeeks = hifz ? hifzWeeksFor(m.pages, p.pagesPerDay, p.extraPct, hifzDaysPerWeek) : 0;
    const weeks = hifz ? hifzWeeks + 1 : (p.fixedWeeks ?? 1);
    const plan: PeriodPlan = {
      ...p, kind: hifz ? 'hifz' : 'consolidation', ayat: m?.ayat ?? 0, pages: m?.pages ?? 0, hifzWeeks, weeks, startWeek,
    };
    startWeek += weeks;
    return plan;
  });
}

/** Things worth the admin's attention: ranges that overlap, and periods too short or too long to assess well. */
export function programWarnings(periods: PeriodPlan[]): Warning[] {
  const out: Warning[] = [];
  const hifz = periods.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === 'hifz');
  for (let x = 0; x < hifz.length; x++) {
    for (let y = x + 1; y < hifz.length; y++) {
      const a = hifz[x].p; const b = hifz[y].p;
      if (compareRefs(parseRef(a.startRef!)!, parseRef(b.endRef!)!) <= 0 && compareRefs(parseRef(b.startRef!)!, parseRef(a.endRef!)!) <= 0) {
        out.push({ type: 'overlap', a: hifz[x].i, b: hifz[y].i });
      }
    }
  }
  for (const { p, i } of hifz) {
    if (p.hifzWeeks < GOOD_HIFZ_WEEKS.min) out.push({ type: 'short', period: i, weeks: p.hifzWeeks });
    if (p.hifzWeeks > GOOD_HIFZ_WEEKS.max) out.push({ type: 'long', period: i, weeks: p.hifzWeeks });
  }
  return out;
}

/** The Sunday that starts the program week containing `date` (YYYY-MM-DD). */
export function sundayOf(date: string): string {
  return addDays(date, -new Date(`${date}T00:00:00Z`).getUTCDay());
}

export type Phase = 'hifz' | 'assessment' | 'consolidation';

export interface Position {
  status: 'not_started' | 'running' | 'finished';
  /** 1-based week of the program; 0 before it starts. */
  week: number;
  totalWeeks: number;
  /** The period now running (the first one before the program starts, the last one after it ends). */
  index: number;
  period: PeriodPlan;
  phase: Phase;
  /** 1-based week within the period. */
  weekInPeriod: number;
  /** First Sunday and last Thursday of the period, as dates. */
  startsOn: string;
  endsOn: string;
}

/** Where a halaqa that began on `start` is on `today`. The program must have at least one period. */
export function positionOn(periods: PeriodPlan[], start: string, today: string): Position {
  const first = sundayOf(start);
  const totalWeeks = periods.reduce((n, p) => n + p.weeks, 0);
  const weekIndex = Math.floor(daysBetween(first, today) / 7);
  const status = weekIndex < 0 ? 'not_started' : weekIndex >= totalWeeks ? 'finished' : 'running';
  const clamped = Math.min(Math.max(weekIndex, 0), totalWeeks - 1);
  let index = periods.findIndex((p) => clamped < p.startWeek + p.weeks);
  if (index < 0) index = periods.length - 1;
  const period = periods[index];
  const weekInPeriod = clamped - period.startWeek + 1;
  const phase: Phase = period.kind === 'consolidation' ? 'consolidation' : weekInPeriod <= period.hifzWeeks ? 'hifz' : 'assessment';
  return {
    status, week: status === 'not_started' ? 0 : Math.min(weekIndex + 1, totalWeeks), totalWeeks, index, period, phase, weekInPeriod,
    startsOn: addDays(first, period.startWeek * 7),
    endsOn: addDays(first, (period.startWeek + period.weeks - 1) * 7 + 4),
  };
}

/** Every "sura:ayah" of a range, in order. */
export function ayatOf(startRef: string, endRef: string): string[] {
  const start = parseRef(startRef)!;
  const end = parseRef(endRef)!;
  const out: string[] = [];
  for (let sura = start[0]; sura <= end[0]; sura++) {
    const from = sura === start[0] ? start[1] : 1;
    const to = sura === end[0] ? end[1] : AYAH_COUNTS[sura - 1];
    for (let ayah = from; ayah <= to; ayah++) out.push(`${sura}:${ayah}`);
  }
  return out;
}

