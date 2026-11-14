import { describe, expect, it } from 'vitest';
import { estimatePages, hifzWeeksFor, wordsBetween } from './index';

describe('mushaf page estimates', () => {
  it('counts every word of the Quran', () => {
    expect(wordsBetween('1:1', '114:6')).toBe(77_429);
    expect(wordsBetween('112:1', '112:4')).toBe(15);
    expect(wordsBetween('2:5', '2:1')).toBe(0);
    expect(wordsBetween('2:300', '2:301')).toBe(0);
  });

  it('comes to about 604 pages for the whole Quran and 22 to 23 for Juz\' \'Amma', () => {
    expect(Math.abs(estimatePages('1:1', '114:6') - 604)).toBeLessThan(5);
    expect(estimatePages('78:1', '114:6')).toBeGreaterThan(21.5);
    expect(estimatePages('78:1', '114:6')).toBeLessThan(23.5);
  });

  it('works out whole weeks of memorization', () => {
    expect(hifzWeeksFor(6, 0.75, 0, 4)).toBe(2);
    expect(hifzWeeksFor(8, 0.75, 0, 4)).toBe(3);
    expect(hifzWeeksFor(0.1, 2, 0, 5)).toBe(1);
  });
});
