'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { api, queryKeys, type SurahProgress } from '@/lib/api';
import { SURAH_NAMES, toArabicDigits } from '@/lib/quran';
import { LoadError, Spinner } from '@/components/LoadState';

/** How a sura looks on the map, from what she has of it: nothing planned, planned, partly memorized, memorized, solid. */
export function surahTone(p: SurahProgress | undefined): 'none' | 'planned' | 'partial' | 'memorized' | 'solid' {
  if (!p || p.total === 0) return 'none';
  if (p.mastered === p.total) return 'solid';
  if (p.memorized === p.total) return 'memorized';
  if (p.memorized > 0) return 'partial';
  return 'planned';
}

const TONE_CLASS = {
  none: 'bg-surface-canvas text-text-muted border-divider',
  planned: 'bg-brand-primary/5 text-text-secondary border-brand-primary/20',
  partial: 'bg-brand-primary/25 text-text-primary border-brand-primary/40',
  memorized: 'bg-brand-primary/60 text-white border-brand-primary',
  solid: 'bg-brand-primary text-white border-brand-primary',
} as const;

const LEGEND: { tone: keyof typeof TONE_CLASS; label: string }[] = [
  { tone: 'none', label: 'ليست في خطتكِ' },
  { tone: 'planned', label: 'في الخطة ولم تُحفظ' },
  { tone: 'partial', label: 'حفظتِ جزءاً منها' },
  { tone: 'memorized', label: 'محفوظة كلها' },
  { tone: 'solid', label: 'متقنة' },
];

const describe = (n: number, p: SurahProgress | undefined) => {
  const name = `سورة ${SURAH_NAMES[n - 1]}`;
  if (!p || p.total === 0) return `${name}: ليست في خطتكِ`;
  const due = p.due > 0 ? `، ${toArabicDigits(p.due)} مستحقة للمراجعة` : '';
  return `${name}: ${toArabicDigits(p.memorized)} من ${toArabicDigits(p.total)} محفوظة، ${toArabicDigits(p.mastered)} متقنة${due}`;
};

/** The 114 suras as tiles, coloured by how much of each she has memorized; a dot marks suras with verses due. */
export function MemorizationMap() {
  const map = useQuery({ queryKey: queryKeys.memorizationMap, queryFn: () => api.getMemorizationMap().then((r) => r.data.surahs) });
  const by = new Map((map.data ?? []).map((s) => [s.sura, s]));
  const memorized = (map.data ?? []).reduce((n, s) => n + s.memorized, 0);
  const total = (map.data ?? []).reduce((n, s) => n + s.total, 0);

  return (
    <Card data-testid="memorization-map">
      <CardHeader>
        <CardTitle>خريطة حفظكِ</CardTitle>
        <CardDescription>
          {map.data && total > 0
            ? `${toArabicDigits(memorized)} آية محفوظة من ${toArabicDigits(total)} في خطتكِ. النقطة الصفراء: سورة فيها آيات حان موعد مراجعتها.`
            : 'تظهر سور خطتكِ هنا ملوّنة بحسب حفظكِ لها.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {map.isLoading ? <Spinner /> : map.isError ? <LoadError message="تعذّر تحميل الخريطة." onRetry={() => map.refetch()} /> : (
          <>
            <ul className="grid grid-cols-8 sm:grid-cols-12 gap-1.5" aria-label="سور المصحف">
              {Array.from({ length: 114 }, (_, i) => i + 1).map((n) => {
                const p = by.get(n);
                return (
                  <li key={n} title={describe(n, p)} aria-label={describe(n, p)} data-sura={n} data-tone={surahTone(p)}
                    className={`relative aspect-square rounded-lg border text-xs flex items-center justify-center ${TONE_CLASS[surahTone(p)]}`}>
                    {toArabicDigits(n)}
                    {p && p.due > 0 && <span className="absolute top-0.5 left-0.5 w-2 h-2 rounded-full bg-state-attention" aria-hidden="true" />}
                  </li>
                );
              })}
            </ul>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
              {LEGEND.map((l) => (
                <li key={l.tone} className="flex items-center gap-1.5">
                  <span className={`inline-block w-3 h-3 rounded border ${TONE_CLASS[l.tone]}`} aria-hidden="true" />{l.label}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
