import { and, eq, gt, gte, lt, lte, or } from 'drizzle-orm';
import { quranAyat } from '../db/schema';

/** SQL condition for the ayat from `start` to `end` inclusive, each as [sura, ayah]. */
export function ayatInRange(start: [number, number], end: [number, number]) {
  return and(
    or(gt(quranAyat.sura, start[0]), and(eq(quranAyat.sura, start[0]), gte(quranAyat.ayah, start[1]))),
    or(lt(quranAyat.sura, end[0]), and(eq(quranAyat.sura, end[0]), lte(quranAyat.ayah, end[1]))),
  );
}
