'use client';

import { useState } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AYAH_COUNTS } from '@itqan/quran';
import { SURAH_NAMES, toArabicDigits } from '@/lib/quran';
import { VerseText } from '@/components/VerseText';

/** How many verses one view shows; the previous / next buttons move by this much. */
const WINDOW = 10;

/** Pick a sura and read it a few verses at a time. */
export function MushafReader() {
  const [sura, setSura] = useState(1);
  const [from, setFrom] = useState(1);
  const count = AYAH_COUNTS[sura - 1];
  const to = Math.min(count, from + WINDOW - 1);

  const changeSura = (next: number) => {
    setSura(next);
    setFrom(1);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>المصحف الشريف</CardTitle>
        <CardDescription>اختاري السورة والآية التي تريدين القراءة منها.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-text-secondary mb-1">السورة</span>
            <select
              id="mushaf-sura"
              value={sura}
              onChange={(e) => changeSura(Number(e.target.value))}
              className="rounded-xl border border-divider bg-surface-elevated px-3 py-2 min-w-[11rem]"
            >
              {SURAH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>{toArabicDigits(i + 1)}. {name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-text-secondary mb-1">من الآية</span>
            <input
              id="mushaf-from"
              type="number"
              min={1}
              max={count}
              value={from}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                if (n >= 1 && n <= count) setFrom(n);
              }}
              className="w-24 rounded-xl border border-divider bg-surface-elevated px-3 py-2"
            />
          </label>
          <p className="text-sm text-text-secondary pb-2">
            عدد آيات السورة: {toArabicDigits(count)}
          </p>
        </div>

        <div className="rounded-xl border border-divider bg-surface-canvas p-4 min-h-[10rem]" aria-live="polite">
          <VerseText start={`${sura}:${from}`} end={`${sura}:${to}`} />
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" onClick={() => setFrom(Math.max(1, from - WINDOW))} disabled={from === 1}>
            <ChevronRight className="w-4 h-4 ml-1" /> السابق
          </Button>
          <span className="text-sm text-text-secondary">
            {SURAH_NAMES[sura - 1]} {toArabicDigits(from)}–{toArabicDigits(to)}
          </span>
          <Button variant="outline" size="sm" onClick={() => setFrom(to + 1)} disabled={to >= count}>
            التالي <ChevronLeft className="w-4 h-4 mr-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
