import { describe, expect, it } from 'vitest';
import { RETEST_AFTER_DAYS, assess, effectiveWeights, scoreProblem, slowerPace, standingFrom, type AssessmentRules } from './index';

const rules: AssessmentRules = { weights: { hifz: 40, tajweed: 25, review: 20, retention: 15 }, passScore: 85, minCriterionPct: 70 };

describe('assessing a period', () => {
  it('passes when the total reaches the pass mark and no criterion is too low', () => {
    const a = assess({ hifz: 38, tajweed: 23, review: 18, retention: 13 }, rules);
    expect(a).toMatchObject({ total: 92, outcome: 'passed', failed: [] });
    expect(assess({ hifz: 40, tajweed: 25, review: 20, retention: 15 }, rules).total).toBe(100);
  });

  it('is exact at the pass mark', () => {
    expect(assess({ hifz: 34, tajweed: 22, review: 17, retention: 12 }, rules)).toMatchObject({ total: 85, outcome: 'passed' });
    expect(assess({ hifz: 34, tajweed: 22, review: 17, retention: 11.9 }, rules)).toMatchObject({ total: 84.9, outcome: 'repeat', failed: [{ rule: 'total' }] });
  });

  it('fails on the total alone', () => {
    const a = assess({ hifz: 32, tajweed: 20, review: 16, retention: 12 }, rules);
    expect(a.outcome).toBe('repeat');
    expect(a.failed).toEqual([{ rule: 'total' }]);
  });

  it('fails when one criterion is below its least share, even if the total is enough', () => {
    // retention 9 of 15 is 60%, under the 70% minimum
    const a = assess({ hifz: 40, tajweed: 25, review: 20, retention: 9 }, rules);
    expect(a.total).toBe(94);
    expect(a).toMatchObject({ outcome: 'repeat', failed: [{ rule: 'criterion', criterion: 'retention' }], weakest: 'retention' });
    // exactly 70% is enough
    expect(assess({ hifz: 40, tajweed: 25, review: 20, retention: 10.5 }, rules).outcome).toBe('passed');
  });

  it('names every rule that is missed, and the weakest criterion', () => {
    const a = assess({ hifz: 20, tajweed: 25, review: 20, retention: 14 }, rules);
    expect(a.failed).toEqual([{ rule: 'total' }, { rule: 'criterion', criterion: 'hifz' }]);
    expect(a.weakest).toBe('hifz');
  });

  it('shares the weight of revision out when there is no earlier period, so the total is still out of 100', () => {
    const w = effectiveWeights(rules.weights, false);
    expect(w.review).toBe(0);
    expect(w.hifz + w.tajweed + w.retention).toBeCloseTo(100, 5);
    expect(w.hifz).toBe(50);
    const a = assess({ hifz: 50, tajweed: 31.3, review: 99, retention: 18.7 }, rules, false);
    expect(a.total).toBe(100); // a revision score is ignored
    expect(a.weights.review).toBe(0);
    expect(effectiveWeights(rules.weights, true)).toEqual(rules.weights);
  });

  it('ignores a criterion whose weight is zero', () => {
    const r: AssessmentRules = { ...rules, weights: { hifz: 60, tajweed: 40, review: 0, retention: 0 } };
    expect(assess({ hifz: 55, tajweed: 36, review: 0, retention: 0 }, r)).toMatchObject({ total: 91, outcome: 'passed' });
  });

  it('checks that scores fit the weights', () => {
    expect(scoreProblem({ hifz: 40, tajweed: 25, review: 20, retention: 15 }, rules.weights)).toBeNull();
    expect(scoreProblem({ hifz: 41, tajweed: 25, review: 20, retention: 15 }, rules.weights)).toBe('hifz');
    expect(scoreProblem({ hifz: 40, tajweed: -1, review: 20, retention: 15 }, rules.weights)).toBe('tajweed');
    expect(scoreProblem({ hifz: 40, tajweed: 25, review: NaN, retention: 15 }, rules.weights)).toBe('review');
  });
});

describe('where a student stands', () => {
  const at = (periodIndex: number, outcome: 'passed' | 'repeat') => ({ periodIndex, outcome });

  it('moves on when she passes and stays when she does not', () => {
    expect(standingFrom([], 3)).toMatchObject({ passed: 0, current: 0, finished: false, failures: 0 });
    expect(standingFrom([at(0, 'repeat')], 3)).toMatchObject({ current: 0, failures: 1 });
    expect(standingFrom([at(0, 'repeat'), at(0, 'passed')], 3)).toMatchObject({ current: 1, failures: 0, failuresBefore: [1] });
    expect(standingFrom([at(0, 'passed'), at(1, 'repeat'), at(1, 'repeat'), at(1, 'passed'), at(2, 'passed')], 3))
      .toMatchObject({ passed: 3, finished: true, failuresBefore: [0, 2, 0] });
  });

  it('ignores an attempt at a period she is not on', () => {
    expect(standingFrom([at(1, 'passed')], 3)).toMatchObject({ current: 0 });
    expect(standingFrom([at(0, 'passed'), at(0, 'passed')], 3)).toMatchObject({ current: 1 });
    expect(standingFrom([at(0, 'passed'), at(5, 'passed')], 1)).toMatchObject({ finished: true, current: 1 });
  });

  it('slows the pace one step, never below a quarter of a page', () => {
    expect(slowerPace(0.75)).toBe(0.5);
    expect(slowerPace(1)).toBe(0.75);
    expect(slowerPace(0.25)).toBe(0.25);
    expect(RETEST_AFTER_DAYS).toBe(5);
  });
});
