import { toArabicDigits } from '@/lib/quran';

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];

/** How a program week is spent: the first days memorizing new verses, the rest for the weekly test and revision. */
export function weekRhythm(hifzDays: number): string {
  const span = (days: string[]) => (days.length === 1 ? days[0] : `${days[0]} إلى ${days[days.length - 1]}`);
  const hifz = DAYS.slice(0, hifzDays);
  const rest = DAYS.slice(hifzDays);
  return rest.length ? `${span(hifz)}: حفظ جديد · ${span(rest)}: تسميع ومراجعة` : `${span(hifz)}: حفظ جديد`;
}

export const PHASE_LABEL = {
  hifz: 'أسبوع حفظ',
  assessment: 'أسبوع الاختبار والتثبيت',
  consolidation: 'فترة تثبيت',
} as const;

/** «الأحد ٤ يناير» from a YYYY-MM-DD date. */
export const programDay = (date: string) =>
  new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export const pagesLabel = (pages: number) => `${toArabicDigits(pages)} صفحة`;
export const PACE_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
export const paceLabel = (p: number) => (p === 1 ? 'صفحة يومياً' : p === 0.5 ? 'نصف صفحة يومياً' : p === 0.25 ? 'ربع صفحة يومياً' : p === 0.75 ? 'ثلاثة أرباع صفحة يومياً' : `${toArabicDigits(p)} صفحة يومياً`);

/** «أسبوع», «أسبوعان», «٣ أسابيع», «١١ أسبوعاً»: a number of weeks, in correct Arabic. */
export function weeksText(n: number): string {
  if (n === 1) return 'أسبوع';
  if (n === 2) return 'أسبوعان';
  return `${toArabicDigits(n)} ${n <= 10 ? 'أسابيع' : 'أسبوعاً'}`;
}

/** «طالبة», «طالبتان», «٣ طالبات», «١١ طالبة»; `of` is the form after «إلى» and «من». */
export function studentsText(n: number, of = false): string {
  if (n === 1) return 'طالبة';
  if (n === 2) return of ? 'طالبتين' : 'طالبتان';
  return `${toArabicDigits(n)} ${n <= 10 ? 'طالبات' : 'طالبة'}`;
}

export const CRITERION_LABEL = { hifz: 'الحفظ', tajweed: 'التجويد', review: 'المراجعة', retention: 'التثبيت' } as const;
export const CRITERIA = ['hifz', 'tajweed', 'review', 'retention'] as const;
