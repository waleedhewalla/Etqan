'use client';

import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/lib/api';
import { toArabicDigits } from '@/lib/quran';
import { LoadError, Spinner } from '@/components/LoadState';

const MARK_OPEN = '\u{FD3F}';
const MARK_CLOSE = '\u{FD3E}';

type Source = { refs: string[] } | { start: string; end: string };

/** Verse text in Uthmani script, with a numbered end-of-ayah marker after each verse. */
export function VerseText(props: Source & { className?: string }) {
  const key = 'refs' in props ? props.refs.join(',') : `${props.start}-${props.end}`;
  const query = useQuery({
    queryKey: queryKeys.ayat(key),
    queryFn: () => ('refs' in props ? api.getAyat(props.refs) : api.getAyatRange(props.start, props.end)).then((r) => r.data),
    staleTime: 24 * 60 * 60 * 1000, // the text does not change
  });

  if (query.isLoading) return <Spinner label="جارٍ تحميل الآيات" />;
  if (query.isError || !query.data) return <LoadError message="تعذّر تحميل نص الآيات." onRetry={() => query.refetch()} />;

  const { ayat, complete } = query.data;
  return (
    <div className={props.className}>
      {ayat.length > 0 && (
        <p lang="ar" dir="rtl" className="font-quran text-mushaf text-text-primary">
          {ayat.map((a) => (
            <span key={a.ref}>
              {a.textUthmani}{' '}
              <span className="text-brand-accent text-xl" aria-label={`آية ${a.ayah}`}>
                {MARK_OPEN}{toArabicDigits(a.ayah)}{MARK_CLOSE}
              </span>{' '}
            </span>
          ))}
        </p>
      )}
      {!complete && (
        <p role="note" className="mt-2 text-sm text-state-attention">
          {ayat.length === 0 ? 'نص هذه الآيات غير محمّل على الخادم بعد.' : 'بعض الآيات غير محمّلة على الخادم بعد.'}
        </p>
      )}
    </div>
  );
}
