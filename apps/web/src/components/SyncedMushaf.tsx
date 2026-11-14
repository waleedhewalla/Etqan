'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@itqan/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AYAH_COUNTS, parseRef } from '@itqan/quran';
import { api, queryKeys } from '@/lib/api';
import { formatAyahRef, SURAH_NAMES, toArabicDigits } from '@/lib/quran';

const field = 'rounded-xl border border-divider bg-surface-elevated px-3 py-2 text-sm';
const BEFORE = 2;
const AFTER = 6;
const MARK_OPEN = '\u{FD3F}';
const MARK_CLOSE = '\u{FD3E}';

const step = ([sura, ayah]: [number, number], by: 1 | -1): [number, number] => {
  if (by === 1) return ayah < AYAH_COUNTS[sura - 1] ? [sura, ayah + 1] : sura < 114 ? [sura + 1, 1] : [sura, ayah];
  return ayah > 1 ? [sura, ayah - 1] : sura > 1 ? [sura - 1, AYAH_COUNTS[sura - 2]] : [sura, ayah];
};

/**
 * The room's own mushaf: the verses around the one the teacher is on, with that verse marked. The room follows her;
 * only a few lines of text cross the network, so it stays sharp and light on a phone however she shares her screen.
 * The host moves it with the arrows or by choosing a verse.
 */
export function SyncedMushaf({ sessionId, focusRef, startRef, isHost }: { sessionId: string; focusRef: string | null; startRef: string | null; isHost: boolean }) {
  const [mine, setMine] = useState<string | null>(null);
  const current = isHost ? (mine ?? focusRef ?? startRef) : (focusRef ?? startRef);
  const at = current ? parseRef(current) : null;
  const move = useMutation({ mutationFn: (ref: string | null) => api.setLiveFocus(sessionId, ref) });
  const go = (to: [number, number]) => { const ref = `${to[0]}:${to[1]}`; setMine(ref); move.mutate(ref); };

  const from = at ? `${at[0]}:${Math.max(1, at[1] - BEFORE)}` : '';
  const to = at ? `${at[0]}:${Math.min(AYAH_COUNTS[at[0] - 1], at[1] + AFTER)}` : '';
  const verses = useQuery({
    queryKey: queryKeys.ayat(`${from}-${to}`),
    queryFn: () => api.getAyatRange(from, to).then((r) => r.data),
    enabled: Boolean(at),
    staleTime: 24 * 60 * 60 * 1000,
  });

  const box = useRef<HTMLDivElement>(null);
  const marked = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = marked.current; const c = box.current;
    if (el && c) c.scrollTo({ top: Math.max(0, el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2), behavior: 'smooth' });
  }, [current, verses.data]);

  const [sura, setSura] = useState(at?.[0] ?? 1);
  const [ayah, setAyah] = useState(at?.[1] ?? 1);
  if (!at && !isHost) return null;

  return (
    <section className="rounded-2xl border border-divider bg-surface-elevated p-3 space-y-3" aria-label="المصحف المتزامن" data-testid="synced-mushaf">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-text-primary">
          المصحف المتزامن{current && <span className="font-normal text-text-secondary"> — {formatAyahRef(current)}</span>}
        </p>
        {isHost && at && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" aria-label="الآية السابقة" onClick={() => go(step(at, -1))}><ChevronRight className="w-4 h-4" /></Button>
            <Button size="sm" variant="outline" aria-label="الآية التالية" onClick={() => go(step(at, 1))}><ChevronLeft className="w-4 h-4" /></Button>
          </div>
        )}
      </div>

      {at && (
        <div ref={box} className="relative max-h-64 overflow-y-auto rounded-xl bg-surface-canvas p-4" data-testid="synced-verses" data-focus={current}>
          {verses.isLoading ? <p className="text-sm text-text-secondary">جارٍ تحميل الآيات…</p> : verses.data?.ayat.length ? (
            <p lang="ar" dir="rtl" className="font-quran text-text-primary text-2xl leading-loose">
              {verses.data.ayat.map((v) => {
                const on = v.ref === current;
                return (
                  <span key={v.ref} ref={on ? marked : undefined} data-ayah={v.ref} aria-current={on ? 'true' : undefined}
                    className={on ? 'rounded-lg bg-brand-accent/25 px-1 box-decoration-clone' : ''}>
                    {v.textUthmani}{' '}
                    <span className="text-brand-accent text-lg">{MARK_OPEN}{toArabicDigits(v.ayah)}{MARK_CLOSE}</span>{' '}
                  </span>
                );
              })}
            </p>
          ) : <p className="text-sm text-text-secondary">نص هذه الآيات غير محمّل على الخادم بعد.</p>}
        </div>
      )}

      {isHost && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (parseRef(`${sura}:${ayah}`)) go([sura, ayah]); }}>
          <label className="text-sm">
            <span className="block text-text-secondary mb-1">{at ? 'انتقال إلى' : 'ابدئي من'}: السورة</span>
            <select className={`${field} min-w-[9rem]`} value={sura} aria-label="السورة"
              onChange={(e) => { const n = Number(e.target.value); setSura(n); setAyah(Math.min(ayah, AYAH_COUNTS[n - 1])); }}>
              {SURAH_NAMES.map((n, i) => <option key={n} value={i + 1}>{toArabicDigits(i + 1)}. {n}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-text-secondary mb-1">الآية</span>
            <input type="number" min={1} max={AYAH_COUNTS[sura - 1]} className={`${field} w-20`} value={ayah} aria-label="الآية" onChange={(e) => setAyah(Math.floor(Number(e.target.value)))} />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={!parseRef(`${sura}:${ayah}`)} loading={move.isPending}>انتقال</Button>
        </form>
      )}
      {!isHost && <p className="text-xs text-text-secondary">يتبع موضع المعلمة تلقائياً.</p>}
    </section>
  );
}
