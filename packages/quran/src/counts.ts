/** Number of ayat in each sura (Hafs numbering), index 0 = sura 1. */
export const AYAH_COUNTS: readonly number[] = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109,
  123, 111, 43, 52, 99, 128, 111, 110, 98, 135,
  112, 78, 118, 64, 77, 227, 93, 88, 69, 60,
  34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
  54, 53, 89, 59, 37, 35, 38, 29, 18, 45,
  60, 49, 62, 55, 78, 96, 29, 22, 24, 13,
  14, 11, 11, 18, 12, 12, 30, 52, 52, 44,
  28, 28, 20, 56, 40, 31, 50, 40, 46, 42,
  29, 19, 36, 25, 22, 17, 19, 26, 30, 20,
  15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
  11, 8, 3, 9, 5, 4, 7, 3, 6, 3,
  5, 4, 5, 6,
];

export const SURA_COUNT = AYAH_COUNTS.length;
export const AYAH_TOTAL = AYAH_COUNTS.reduce((a, b) => a + b, 0);

/** "2:255" → [2, 255], or null if it is not a valid reference. */
export function parseRef(ref: string): [number, number] | null {
  const m = /^(\d{1,3}):(\d{1,3})$/.exec(ref);
  if (!m) return null;
  const sura = Number(m[1]);
  const ayah = Number(m[2]);
  if (sura < 1 || sura > SURA_COUNT || ayah < 1 || ayah > AYAH_COUNTS[sura - 1]) return null;
  return [sura, ayah];
}

/** Orders two references in mushaf order: negative if a comes first. */
export function compareRefs(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

/** Number of ayat from `start` to `end` inclusive (mushaf order), or 0 if end comes before start. */
export function countAyat(start: [number, number], end: [number, number]): number {
  if (compareRefs(start, end) > 0) return 0;
  if (start[0] === end[0]) return end[1] - start[1] + 1;
  let total = AYAH_COUNTS[start[0] - 1] - start[1] + 1;
  for (let sura = start[0] + 1; sura < end[0]; sura++) total += AYAH_COUNTS[sura - 1];
  return total + end[1];
}
