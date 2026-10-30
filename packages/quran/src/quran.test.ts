import { describe, expect, it } from 'vitest';
import { AYAH_COUNTS, AYAH_TOTAL, SURA_COUNT, compareRefs, countAyat, normalizeArabic, parseRef, splitWords } from './index';

describe('normalizeArabic', () => {
  it('removes vowel marks and shadda', () => {
    expect(normalizeArabic('مَدْرَسَةٌ')).toBe('مدرسه');
    expect(normalizeArabic('مُحَمَّد')).toBe('محمد');
  });

  it('removes the dagger alef and Quranic annotation marks', () => {
    expect(normalizeArabic('ذَٰلِكَ')).toBe('ذلك');
    expect(normalizeArabic('رَيۡبَۛ')).toBe('ريب');
    // rub el hizb (U+06DE) and sajdah (U+06E9) signs sit inside the text
    expect(normalizeArabic('\u{06DE}كتاب')).toBe('كتاب');
    expect(normalizeArabic('كتاب\u{06E9}')).toBe('كتاب');
  });

  it('unifies alef, yaa, waw and taa marbuta forms', () => {
    expect(normalizeArabic('أحمد')).toBe('احمد');
    expect(normalizeArabic('إسلام')).toBe('اسلام');
    expect(normalizeArabic('آمن')).toBe('امن');
    expect(normalizeArabic('ٱلكتاب')).toBe('الكتاب');
    expect(normalizeArabic('على')).toBe('علي');
    expect(normalizeArabic('مؤمن')).toBe('مومن');
    expect(normalizeArabic('مدرسة')).toBe('مدرسه');
  });

  it('drops tatweel and stand-alone hamza', () => {
    expect(normalizeArabic('كـــتاب')).toBe('كتاب');
    expect(normalizeArabic('جزء')).toBe('جز');
  });

  it('collapses whitespace and leaves other scripts alone', () => {
    expect(normalizeArabic('  كتاب   جديد ')).toBe('كتاب جديد');
    expect(normalizeArabic('abc 123')).toBe('abc 123');
    expect(normalizeArabic('')).toBe('');
  });

  it('is idempotent', () => {
    const once = normalizeArabic('أَحْمَدُ ٱلْمُعَلِّمَةُ');
    expect(normalizeArabic(once)).toBe(once);
  });
});

describe('splitWords', () => {
  it('splits on any whitespace and keeps the original forms', () => {
    expect(splitWords(' مَدْرَسَةٌ \n جَدِيدَةٌ ')).toEqual(['مَدْرَسَةٌ', 'جَدِيدَةٌ']);
    expect(splitWords('')).toEqual([]);
  });
});

describe('references', () => {
  it('has the standard Hafs totals', () => {
    expect(SURA_COUNT).toBe(114);
    expect(AYAH_TOTAL).toBe(6236);
    expect(AYAH_COUNTS[0]).toBe(7);
    expect(AYAH_COUNTS[1]).toBe(286);
    expect(AYAH_COUNTS[113]).toBe(6);
  });

  it('parses valid references and rejects invalid ones', () => {
    expect(parseRef('2:255')).toEqual([2, 255]);
    expect(parseRef('114:6')).toEqual([114, 6]);
    for (const bad of ['2:287', '115:1', '0:1', '1:0', '2', '2:', 'a:b', '2:1:1', '1:8']) {
      expect(parseRef(bad), bad).toBeNull();
    }
  });

  it('orders references in mushaf order', () => {
    expect(compareRefs([1, 7], [2, 1])).toBeLessThan(0);
    expect(compareRefs([2, 10], [2, 9])).toBeGreaterThan(0);
    expect(compareRefs([3, 3], [3, 3])).toBe(0);
  });
});

describe('countAyat', () => {
  it('counts within a sura, across suras and for a single ayah', () => {
    expect(countAyat([2, 1], [2, 5])).toBe(5);
    expect(countAyat([2, 255], [2, 255])).toBe(1);
    expect(countAyat([1, 6], [2, 2])).toBe(2 + 2); // 1:6, 1:7, 2:1, 2:2
    expect(countAyat([1, 1], [3, 200])).toBe(7 + 286 + 200);
    expect(countAyat([113, 5], [114, 2])).toBe(3);
  });

  it('is 0 when the end comes before the start', () => {
    expect(countAyat([2, 5], [2, 1])).toBe(0);
    expect(countAyat([3, 1], [2, 1])).toBe(0);
  });
});
