import type { Evaluation } from './evaluate';

export interface BenchRow {
  file: string;
  expectedWords: number;
  heardWords: number;
  seconds: number;
  evaluation: Evaluation;
}

export interface BenchSummary {
  files: number;
  /** Files the check could judge (not "unclear"). */
  judged: number;
  unclear: number;
  /** Mean accuracy over judged files, 0–100. For clean recitations this should be high. */
  meanAccuracy: number | null;
  /** Lowest accuracy among judged files, to spot the one that fails. */
  minAccuracy: number | null;
  meanConfidence: number | null;
  /** Files with no flags at all. */
  clean: number;
  /** Heard words per expected word; far from 1 means the service drops or invents speech. */
  wordRatio: number | null;
}

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, v) => a + v, 0) / xs.length) * 1000) / 1000 : null);

export function summarizeBench(rows: BenchRow[]): BenchSummary {
  const judged = rows.filter((r) => r.evaluation.status === 'done');
  const expected = rows.reduce((a, r) => a + r.expectedWords, 0);
  const accuracies = judged.map((r) => r.evaluation.accuracy);
  return {
    files: rows.length,
    judged: judged.length,
    unclear: rows.length - judged.length,
    meanAccuracy: mean(accuracies),
    minAccuracy: accuracies.length ? Math.min(...accuracies) : null,
    meanConfidence: mean(rows.map((r) => r.evaluation.confidence)),
    clean: judged.filter((r) => r.evaluation.flags.length === 0).length,
    wordRatio: expected ? mean([rows.reduce((a, r) => a + r.heardWords, 0) / expected]) : null,
  };
}
