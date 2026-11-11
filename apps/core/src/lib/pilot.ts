import { addDays } from './dates';

/** A student revising on at least this many days in a week counts as "regular". */
export const REGULAR_DAYS = 4;

export interface PilotInput {
  /** First day (YYYY-MM-DD, a Saturday) of each week, oldest first. */
  weekStarts: string[];
  /** Today's local date: a week that has not ended yet is marked partial. */
  today: string;
  /** Students currently in a halaqa of the institution. */
  enrolled: string[];
  /** One row per student per local day she revised. */
  activity: { studentId: string; day: string; reviews: number }[];
  /** Recitations submitted in the window, with local submission day. */
  recitations: { day: string; submittedAt: Date; reviewedAt: Date | null }[];
  /** Each time a guardian opened a weekly report, with local day. */
  reportOpens: { guardianId: string; day: string }[];
  /** Guardians linked to an enrolled student. */
  guardiansLinked: number;
}

export interface PilotWeek {
  start: string;
  end: string;
  /** The week is still running, so its numbers will keep rising. */
  partial: boolean;
  enrolled: number;
  /** Revised at least once. */
  active: number;
  /** Revised on REGULAR_DAYS or more days. */
  regular: number;
  reviews: number;
  recitations: { submitted: number; reviewed: number; medianHoursToReview: number | null };
  guardians: { linked: number; opened: number };
}

export interface PilotReport {
  regularDays: number;
  weeks: PilotWeek[];
  /** Of the students active in the first week, how many were still active in the last. Null with fewer than two weeks. */
  retention: { cohort: number; retained: number; fromWeek: string; toWeek: string } | null;
}

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 10) / 10;
};

/**
 * The pilot's four questions, week by week: are students revising regularly, how fast do teachers review
 * recitations, do guardians open the report, and do students stay. Only students currently enrolled are counted.
 */
export function buildPilotReport(input: PilotInput): PilotReport {
  const enrolled = new Set(input.enrolled);
  const inWeek = (day: string, start: string) => day >= start && day <= addDays(start, 6);
  const activeByWeek: Set<string>[] = [];

  const weeks = input.weekStarts.map((start): PilotWeek => {
    const end = addDays(start, 6);
    const days = new Map<string, Set<string>>();
    let reviews = 0;
    for (const a of input.activity) {
      if (!enrolled.has(a.studentId) || !inWeek(a.day, start)) continue;
      reviews += a.reviews;
      if (!days.has(a.studentId)) days.set(a.studentId, new Set());
      days.get(a.studentId)!.add(a.day);
    }
    activeByWeek.push(new Set(days.keys()));

    const submitted = input.recitations.filter((r) => inWeek(r.day, start));
    const reviewed = submitted.filter((r) => r.reviewedAt);
    const opened = new Set(input.reportOpens.filter((o) => inWeek(o.day, start)).map((o) => o.guardianId));

    return {
      start, end, partial: input.today <= end,
      enrolled: enrolled.size,
      active: days.size,
      regular: [...days.values()].filter((d) => d.size >= REGULAR_DAYS).length,
      reviews,
      recitations: {
        submitted: submitted.length, reviewed: reviewed.length,
        medianHoursToReview: median(reviewed.map((r) => (r.reviewedAt!.getTime() - r.submittedAt.getTime()) / 3_600_000)),
      },
      guardians: { linked: input.guardiansLinked, opened: opened.size },
    };
  });

  const first = activeByWeek[0];
  const last = activeByWeek[activeByWeek.length - 1];
  return {
    regularDays: REGULAR_DAYS,
    weeks,
    retention: weeks.length >= 2
      ? { cohort: first.size, retained: [...first].filter((id) => last.has(id)).length, fromWeek: weeks[0].start, toWeek: weeks[weeks.length - 1].start }
      : null,
  };
}
