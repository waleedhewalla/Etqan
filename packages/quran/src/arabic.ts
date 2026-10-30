/**
 * Arabic text helpers shared by the API (loader, recitation checker) and the web app.
 *
 * Comparing a recitation with the mushaf text has to ignore things that differ
 * between spellings of the same word: vowel and recitation marks, tatweel, and
 * the many forms of alef, yaa and taa marbuta. Real spelling differences between
 * the Uthmani and everyday spelling (for example the dagger alef) are left to the
 * word aligner, which compares words by similarity.
 *
 * Code points are written as escapes so the source stays readable in review.
 */

// Arabic combining marks (harakat, shadda, sukun, dagger alef U+0670) and the
// Quranic annotation signs U+06D6–U+06ED (waqf signs, rub el hizb, sajdah, …).
const MARKS = /[\u{0610}-\u{061A}\u{064B}-\u{065F}\u{0670}\u{06D6}-\u{06ED}\u{08D3}-\u{08FF}]/gu;
const TATWEEL = /\u{0640}/gu;

const LETTER_MAP: Record<string, string> = {
  '\u{0671}': '\u{0627}', // alef wasla → alef
  '\u{0623}': '\u{0627}', // alef with hamza above → alef
  '\u{0625}': '\u{0627}', // alef with hamza below → alef
  '\u{0622}': '\u{0627}', // alef with madda → alef
  '\u{0649}': '\u{064A}', // alef maqsura → yaa
  '\u{0626}': '\u{064A}', // yaa with hamza → yaa
  '\u{06CC}': '\u{064A}', // Persian yeh → yaa
  '\u{0624}': '\u{0648}', // waw with hamza → waw
  '\u{0629}': '\u{0647}', // taa marbuta → haa
  '\u{06A9}': '\u{0643}', // Persian kaf → kaf
  '\u{0621}': '',         // stand-alone hamza is dropped
};
const LETTERS = new RegExp(`[${Object.keys(LETTER_MAP).join('')}]`, 'gu');

/** Lower-fidelity form of Arabic text used for matching, never for display. */
export function normalizeArabic(input: string): string {
  return input
    .normalize('NFKC')
    .replace(MARKS, '')
    .replace(TATWEEL, '')
    .replace(LETTERS, (c) => LETTER_MAP[c])
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits verse text into words on whitespace. Indexes stay stable so a flagged
 * word can be highlighted in the original text; use normalizeArabic on each word.
 */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}
