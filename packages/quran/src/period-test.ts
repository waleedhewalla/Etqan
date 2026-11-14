/**
 * How a period of a memorization program is passed. A period is assessed on four criteria, each scored out of its weight
 * (the weights add up to 100): memorization, tajweed, revision of earlier periods and retention a week later. It is
 * passed when the total reaches the pass mark and no criterion falls below the least share of its weight.
 * Shared by the server, which decides, and the screen, which shows the outcome as the teacher types.
 */

export const CRITERIA = ['hifz', 'tajweed', 'review', 'retention'] as const;
export type Criterion = typeof CRITERIA[number];
export type Weights = Record<Criterion, number>;
export type Scores = Record<Criterion, number>;

export interface AssessmentRules {
  weights: Weights;
  /** The total needed, out of 100. */
  passScore: number;
  /** The least any one criterion may reach, as a share of its weight. */
  minCriterionPct: number;
}

export type FailedRule = { rule: 'total' } | { rule: 'criterion'; criterion: Criterion };

export interface Assessment {
  /** The weights the scores were measured against. */
  weights: Weights;
  total: number;
  outcome: 'passed' | 'repeat';
  failed: FailedRule[];
  /** The criterion furthest below its weight; null when every criterion has a weight of zero. */
  weakest: Criterion | null;
}

const EPSILON = 1e-9;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The weights in effect. The first period has no earlier period to revise, so the weight of revision is shared out
 * among the other criteria in proportion, and the total is still out of 100.
 */
export function effectiveWeights(weights: Weights, reviewApplies: boolean): Weights {
  if (reviewApplies) return { ...weights };
  const rest = weights.hifz + weights.tajweed + weights.retention;
  if (rest <= 0) return { hifz: 0, tajweed: 0, review: 0, retention: 0 };
  const scale = 100 / rest;
  return { hifz: round1(weights.hifz * scale), tajweed: round1(weights.tajweed * scale), review: 0, retention: round1(100 - round1(weights.hifz * scale) - round1(weights.tajweed * scale)) };
}

/** Whether scores fit the weights: each between 0 and the weight of its criterion. Returns the first that does not. */
export function scoreProblem(scores: Scores, weights: Weights): Criterion | null {
  for (const c of CRITERIA) {
    const v = scores[c];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > weights[c] + EPSILON) return c;
  }
  return null;
}

/** Scores the four criteria against the rules, and says whether the period is passed and, if not, which rule it missed. */
export function assess(scores: Scores, rules: AssessmentRules, reviewApplies = true): Assessment {
  const weights = effectiveWeights(rules.weights, reviewApplies);
  const used: Scores = { ...scores, review: reviewApplies ? scores.review : 0 };
  const total = round1(CRITERIA.reduce((n, c) => n + Math.min(Math.max(used[c], 0), weights[c]), 0));
  const failed: FailedRule[] = [];
  if (total + EPSILON < rules.passScore) failed.push({ rule: 'total' });
  for (const c of CRITERIA) {
    if (weights[c] > 0 && used[c] + EPSILON < (weights[c] * rules.minCriterionPct) / 100) failed.push({ rule: 'criterion', criterion: c });
  }
  let weakest: Criterion | null = null;
  let lowest = Infinity;
  for (const c of CRITERIA) {
    if (weights[c] <= 0) continue;
    const share = used[c] / weights[c];
    if (share < lowest) { lowest = share; weakest = c; }
  }
  return { weights, total, outcome: failed.length === 0 ? 'passed' : 'repeat', failed, weakest };
}

export interface Attempt { periodIndex: number; outcome: 'passed' | 'repeat' }

export interface Standing {
  /** Periods passed, in order. */
  passed: number;
  /** Index of the period she is on: the first she has not passed. */
  current: number;
  finished: boolean;
  /** Attempts she has failed at the period she is on. */
  failures: number;
  /** For each period passed, how many attempts she failed before passing it. */
  failuresBefore: number[];
}

/**
 * Where a student stands, from her attempts in the order they were made. Only an attempt at the period she is on counts;
 * passing it moves her to the next, and failing it keeps her there.
 */
export function standingFrom(attempts: Attempt[], periodCount: number): Standing {
  let current = 0;
  let failures = 0;
  const failuresBefore: number[] = [];
  for (const a of attempts) {
    if (current >= periodCount || a.periodIndex !== current) continue;
    if (a.outcome === 'passed') { failuresBefore.push(failures); current += 1; failures = 0; } else failures += 1;
  }
  return { passed: current, current, finished: current >= periodCount, failures, failuresBefore };
}

/** A slower pace by one step (a quarter page a day), never below a quarter. */
export const slowerPace = (pagesPerDay: number) => Math.max(0.25, Math.round((pagesPerDay - 0.25) * 4) / 4);

/** After a period needed two or more failed attempts before it was passed, the next one is worked at a slower pace. */
export const SLOWDOWN_AFTER_FAILURES = 2;
/** Days a student is given between a failed attempt and the next. */
export const RETEST_AFTER_DAYS = 5;
