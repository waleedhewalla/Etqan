import { describe, expect, it } from 'vitest';
import { BLANK, buildChoice, buildCloze, distinctAyat, shuffle, singleSwap } from '../lib/mutashabihat';

// Placeholder words, not Quran text.
const a = { ref: '1:1', text: 'كَلِمَةٌ أُولَى هُنَا وَهُنَاكَ' };
const b = { ref: '2:1', text: 'كَلِمَةٌ ثَانِيَةٌ هُنَا وَهُنَاكَ' };
const c = { ref: '3:1', text: 'كَلِمَةٌ ثَالِثَةٌ هُنَا وَهُنَاكَ' };
const noRng = () => 0;

describe('singleSwap', () => {
  it('finds a swapped word and where it sits', () => {
    expect(singleSwap(a.text, b.text)).toEqual({ index: 1, mine: 'أُولَى', theirs: 'ثَانِيَةٌ' });
  });
  it('ignores a skipped or extra word, and spelling-only differences', () => {
    expect(singleSwap('ا ب ج', 'ا ج')).toBeNull();
    expect(singleSwap('ا ب', 'ا ب س')).toBeNull();
    expect(singleSwap('كَلِمَةٌ', 'كلمة')).toBeNull();
    expect(singleSwap('ا ب ج د', 'ا س ص د')).toBeNull(); // two swaps are ambiguous
  });
});

describe('buildCloze', () => {
  it('blanks the swapped word and offers what each verse uses there', () => {
    const d = buildCloze(a, [b, c], noRng)!;
    expect(d.question).toBe(`كَلِمَةٌ ${BLANK} هُنَا وَهُنَاكَ`);
    expect(d.correctAnswer).toBe('أُولَى');
    expect([...d.options].sort()).toEqual(['أُولَى', 'ثَالِثَةٌ', 'ثَانِيَةٌ'].sort());
    expect(d.targetRef).toBe('1:1');
  });
  it('has no question when the verses never swap a word', () => {
    expect(buildCloze(a, [{ ref: '9:9', text: 'كلمة اولى هنا' }], noRng)).toBeNull();
    expect(buildCloze(a, [], noRng)).toBeNull();
  });
  it('does not offer the same word twice', () => {
    const d = buildCloze(a, [b, { ref: '4:1', text: 'كَلِمَةٌ ثَانِيَةٌ هُنَا وَهُنَاكَ' }], noRng)!;
    expect(d.options).toHaveLength(2);
  });
});

describe('buildChoice', () => {
  it('shows the whole verse and offers every reference', () => {
    const d = buildChoice(b, [a, b, c], noRng);
    expect(d).toMatchObject({ question: b.text, correctAnswer: '2:1', targetRef: '2:1' });
    expect([...d!.options].sort()).toEqual(['1:1', '2:1', '3:1']);
  });

  it('refuses to ask about a verse another verse of the cluster repeats word for word', () => {
    const same = { ref: '5:1', text: a.text };
    expect(buildChoice(a, [a, same, b], noRng)).toBeNull();
    expect(buildChoice(b, [a, same, b], noRng)).not.toBeNull();
    expect(distinctAyat([a, same, b]).map((x) => x.ref)).toEqual(['2:1']);
  });
});

describe('shuffle', () => {
  it('keeps every item and does not change the input', () => {
    const input = [1, 2, 3, 4, 5];
    expect([...shuffle(input)].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});
