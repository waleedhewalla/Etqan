'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { Shuffle } from 'lucide-react';
import { api, errorMessage, queryKeys, type QueueItem } from '@/lib/api';
import { SURAH_NAMES, toArabicDigits } from '@/lib/quran';

const COUNTS = [5, 10, 20];

/**
 * «اختبريني»: random verses from what she has already memorized, on any day, with the verse before it as the cue.
 * Her answers are ordinary reviews, so they also move the schedule. Shown once she has something memorized.
 */
export function SelfTestCard({ onStart }: { onStart: (items: QueueItem[]) => void }) {
  const map = useQuery({ queryKey: queryKeys.memorizationMap, queryFn: () => api.getMemorizationMap().then((r) => r.data.surahs) });
  const [sura, setSura] = useState('');
  const [count, setCount] = useState(10);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const memorizedSuras = (map.data ?? []).filter((s) => s.memorized > 0);
  if (memorizedSuras.length === 0) return null;

  const start = async () => {
    setStarting(true);
    setError('');
    try {
      const { data } = await api.getSelfTest({ sura: sura ? Number(sura) : undefined, count });
      if (data.items.length === 0) setError('لا آيات محفوظة في هذه السورة بعد.');
      else onStart(data.items);
    } catch (err) {
      setError(errorMessage(err, 'تعذّر بدء الاختبار. حاولي مرة أخرى.'));
    } finally {
      setStarting(false);
    }
  };

  const field = 'rounded-xl border border-divider bg-surface-elevated px-3 py-2';
  return (
    <Card className="mb-5" data-testid="self-test">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Shuffle className="w-5 h-5 text-brand-primary" /> اختبريني</CardTitle>
        <CardDescription>آيات عشوائية مما حفظتِ، في أي يوم: تُعطين أول الآية ثم تكملين من حفظكِ. تقييمكِ يضبط موعد مراجعتها.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-text-secondary mb-1">من</span>
          <select aria-label="نطاق الاختبار" value={sura} onChange={(e) => setSura(e.target.value)} className={field}>
            <option value="">كل محفوظي</option>
            {memorizedSuras.map((s) => <option key={s.sura} value={s.sura}>سورة {SURAH_NAMES[s.sura - 1]} ({toArabicDigits(s.memorized)})</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary mb-1">عدد الآيات</span>
          <select aria-label="عدد الآيات" value={count} onChange={(e) => setCount(Number(e.target.value))} className={field}>
            {COUNTS.map((n) => <option key={n} value={n}>{toArabicDigits(n)}</option>)}
          </select>
        </label>
        <Button onClick={start} loading={starting}>ابدئي الاختبار</Button>
        {error && <p role="alert" className="w-full text-sm text-red-800">{error}</p>}
      </CardContent>
    </Card>
  );
}
