import { AYAH_COUNTS, compareRefs, parseRef } from './counts';
import { WORDS_PER_AYAH } from './words';

/**
 * Words a Madinah mushaf page holds on average once the heading and basmala of each sura are set aside;
 * with them (a sura's heading takes about two lines of fifteen) the whole Quran comes to 604 pages and
 * Juz' 'Amma to about 22.5.
 */
export const WORDS_PER_PAGE = 131.5;
const SURA_HEADING_PAGES = 2 / 15;

/** Words from `startRef` to `endRef` inclusive; 0 if either is not a verse or the range runs backwards. */
export function wordsBetween(startRef: string, endRef: string): number {
  const start = parseRef(startRef);
  const end = parseRef(endRef);
  if (!start || !end || compareRefs(start, end) > 0) return 0;
  let words = 0;
  for (let sura = start[0]; sura <= end[0]; sura++) {
    const from = sura === start[0] ? start[1] : 1;
    const to = sura === end[0] ? end[1] : AYAH_COUNTS[sura - 1];
    const ayat = WORDS_PER_AYAH[sura - 1];
    for (let ayah = from; ayah <= to; ayah++) words += ayat[ayah - 1];
  }
  return words;
}

/** Mushaf pages a range of verses takes, to one decimal: an estimate, good to about half a page. */
export function estimatePages(startRef: string, endRef: string): number {
  const start = parseRef(startRef);
  const end = parseRef(endRef);
  if (!start || !end || compareRefs(start, end) > 0) return 0;
  // A sura begun inside the range brings its heading with it.
  const headings = end[0] - start[0] + 1 - (start[1] > 1 ? 1 : 0);
  return Math.round((wordsBetween(startRef, endRef) / WORDS_PER_PAGE + headings * SURA_HEADING_PAGES) * 10) / 10;
}

/** Weeks of memorization a number of pages needs at a pace, never fewer than one. */
export function hifzWeeksFor(pages: number, pagesPerDay: number, extraPct: number, hifzDaysPerWeek: number): number {
  const needed = (pages * (1 + extraPct / 100)) / (hifzDaysPerWeek * pagesPerDay);
  return Math.max(1, Math.ceil(Number(needed.toFixed(6))));
}
