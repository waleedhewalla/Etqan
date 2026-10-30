'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '@itqan/ui';
import { splitWords } from '@itqan/quran';
import { api, queryKeys, type FlaggedWord } from '@/lib/api';
import { toArabicDigits } from '@/lib/quran';
import { LoadError, Spinner } from '@/components/LoadState';

type Decision = 'confirmed' | 'dismissed';

const flagText = (f: FlaggedWord) =>
  f.type === 'missing' ? `لم تُقرأ كلمة «${f.expected}»`
    : f.type === 'wrong' ? `قُرئت «${f.heard}» بدل «${f.expected}»`
      : `كلمة زائدة «${f.heard}»`;

const markClass: Record<FlaggedWord['type'], string> = {
  missing: 'bg-red-100 text-red-900 underline decoration-wavy decoration-red-600',
  wrong: 'bg-amber-100 text-amber-900 underline decoration-wavy decoration-amber-600',
  added: 'bg-sky-100 text-sky-900',
};

/**
 * The recited verses with the automatic check's flags marked on the words, and a list of the
 * flags beneath. Teachers confirm or dismiss each one; students can dispute one before review.
 * The marks are only a first look: they are never a grade.
 */
export function FlaggedVerse({ start, end, flags, decisions, onDecide, onDispute, disputeBusy }: {
  start: string;
  end: string;
  flags: FlaggedWord[];
  /** Teacher view: her current call on each flag. */
  decisions?: Record<string, Decision>;
  onDecide?: (flagId: string, decision: Decision) => void;
  /** Student view: dispute a flag. */
  onDispute?: (flagId: string) => void;
  disputeBusy?: boolean;
}) {
  const query = useQuery({
    queryKey: queryKeys.ayat(`${start}-${end}`),
    queryFn: () => api.getAyatRange(start, end).then((r) => r.data),
    staleTime: 24 * 60 * 60 * 1000,
  });

  if (query.isLoading) return <Spinner label="جارٍ تحميل الآيات" />;
  if (query.isError || !query.data) return <LoadError message="تعذّر تحميل نص الآيات." onRetry={() => query.refetch()} />;

  const decisionOf = (f: FlaggedWord) => decisions?.[f.id] ?? f.decision;
  const byWord = new Map<string, FlaggedWord[]>();
  for (const f of flags) {
    const k = `${f.ayahRef}:${f.position}`;
    byWord.set(k, [...(byWord.get(k) ?? []), f]);
  }
  const ayahOf = (ref: string) => toArabicDigits(ref.split(':')[1]);

  return (
    <div className="space-y-3">
      <p lang="ar" dir="rtl" className="font-quran text-mushaf text-text-primary rounded-xl border border-divider bg-surface-canvas p-4 max-h-56 overflow-y-auto">
        {query.data.ayat.map((a) => (
          <span key={a.ref}>
            {splitWords(a.textUthmani).map((word, i) => {
              const here = byWord.get(`${a.ref}:${i}`) ?? [];
              const marks = here.filter((f) => f.type !== 'added' && decisionOf(f) !== 'dismissed');
              const added = here.filter((f) => f.type === 'added' && decisionOf(f) !== 'dismissed');
              return (
                <span key={i}>
                  <span
                    data-flag={marks[0]?.type}
                    className={`rounded px-0.5 ${marks[0] ? markClass[marks[0].type] : ''}`}
                    title={marks[0] ? flagText(marks[0]) : undefined}
                  >{word}</span>
                  {added.map((f) => (
                    <span key={f.id} data-flag="added" className={`mx-0.5 rounded px-1 text-sm ${markClass.added}`} title={flagText(f)}>＋ {f.heard}</span>
                  ))}{' '}
                </span>
              );
            })}
            <span className="text-brand-accent text-xl">{'\u{FD3F}'}{toArabicDigits(a.ayah)}{'\u{FD3E}'}</span>{' '}
          </span>
        ))}
      </p>

      {flags.length > 0 && (
        <ul className="space-y-2" aria-label="ملاحظات الفحص الآلي">
          {flags.map((f) => {
            const decision = decisionOf(f);
            return (
              <li key={f.id} data-testid="ai-flag" className="flex items-center justify-between gap-2 flex-wrap rounded-lg border border-divider px-3 py-2 text-sm">
                <span className={decision === 'dismissed' ? 'line-through text-text-secondary' : ''}>
                  <span className="text-text-secondary">آية {ayahOf(f.ayahRef)}:</span> {flagText(f)}
                </span>
                <span className="flex items-center gap-2">
                  {f.disputed && <Badge className="bg-amber-50 text-amber-900">اعترضت الطالبة</Badge>}
                  {onDecide && (
                    <>
                      <Button type="button" size="sm" variant={decision === 'confirmed' ? 'primary' : 'outline'} onClick={() => onDecide(f.id, 'confirmed')}>تأكيد</Button>
                      <Button type="button" size="sm" variant={decision === 'dismissed' ? 'primary' : 'outline'} onClick={() => onDecide(f.id, 'dismissed')}>استبعاد</Button>
                    </>
                  )}
                  {!onDecide && decision && (
                    <Badge>{decision === 'confirmed' ? 'أكّدته المعلمة' : 'استبعدته المعلمة'}</Badge>
                  )}
                  {onDispute && !f.disputed && !decision && (
                    <Button type="button" size="sm" variant="outline" disabled={disputeBusy} onClick={() => onDispute(f.id)}>أعترض</Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
