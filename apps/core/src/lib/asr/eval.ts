import type { FlaggedWord } from './types';

export interface EvalRow {
  studentId: string;
  aiStatus: string | null;
  flags: FlaggedWord[];
  reviewVerdict: string | null;
  aiReadyForApproval: boolean | null;
}

export interface Tally { confirmed: number; dismissed: number }

export interface EvalReport {
  /** Recitations the automatic check looked at. */
  checked: number;
  /** ...that a teacher has since reviewed. */
  reviewed: number;
  unclear: number;
  failed: number;
  /** Teacher-decided flags only; undecided ones say nothing about accuracy. */
  flags: Tally & { undecided: number; precision: number | null };
  byType: Record<FlaggedWord['type'], Tally>;
  /** Flags the student disputed, and how many of those the teacher dismissed (the student was right). */
  disputes: { total: number; dismissed: number };
  /** "Ready for approval" hints, and how many the teacher did approve. */
  ready: { total: number; approved: number };
  /** Students are numbered S1, S2… so the report can be shared without names. */
  perStudent: { student: string; reviewed: number; decided: number; precision: number | null }[];
}

const precision = (t: Tally) => (t.confirmed + t.dismissed === 0 ? null : Math.round((t.confirmed / (t.confirmed + t.dismissed)) * 1000) / 10);

/**
 * How often the teacher agrees with the automatic flags, overall, by kind of flag and per student.
 * Precision is confirmed ÷ (confirmed + dismissed). It says nothing about mistakes the check missed:
 * that needs a teacher listening to recitations the check passed.
 */
export function summarizeEval(rows: EvalRow[]): EvalReport {
  const report: EvalReport = {
    checked: 0, reviewed: 0, unclear: 0, failed: 0,
    flags: { confirmed: 0, dismissed: 0, undecided: 0, precision: null },
    byType: { missing: { confirmed: 0, dismissed: 0 }, wrong: { confirmed: 0, dismissed: 0 }, added: { confirmed: 0, dismissed: 0 } },
    disputes: { total: 0, dismissed: 0 },
    ready: { total: 0, approved: 0 },
    perStudent: [],
  };
  const students = new Map<string, { n: number; reviewed: number; tally: Tally }>();

  for (const row of rows) {
    if (row.aiStatus === 'unclear') report.unclear++;
    if (row.aiStatus === 'failed') report.failed++;
    if (row.aiStatus !== 'done') continue;

    report.checked++;
    const reviewed = row.reviewVerdict !== null;
    if (reviewed) report.reviewed++;
    if (row.aiReadyForApproval) {
      report.ready.total++;
      if (row.reviewVerdict === 'approved') report.ready.approved++;
    }

    let s = students.get(row.studentId);
    if (!s) students.set(row.studentId, s = { n: students.size + 1, reviewed: 0, tally: { confirmed: 0, dismissed: 0 } });
    if (reviewed) s.reviewed++;

    for (const f of row.flags) {
      if (f.disputed) {
        report.disputes.total++;
        if (f.decision === 'dismissed') report.disputes.dismissed++;
      }
      if (!f.decision) { if (reviewed) report.flags.undecided++; continue; }
      report.flags[f.decision]++;
      report.byType[f.type][f.decision]++;
      s.tally[f.decision]++;
    }
  }

  report.flags.precision = precision(report.flags);
  report.perStudent = [...students.values()].map((s) => ({
    student: `S${s.n}`, reviewed: s.reviewed, decided: s.tally.confirmed + s.tally.dismissed, precision: precision(s.tally),
  }));
  return report;
}
