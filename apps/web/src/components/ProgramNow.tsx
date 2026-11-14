'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@itqan/ui';
import { BookOpenCheck } from 'lucide-react';
import { api, errorMessage, queryKeys } from '@/lib/api';
import { formatAyahRange, toArabicDigits } from '@/lib/quran';
import { CRITERION_LABEL, PHASE_LABEL, paceLabel, programDay, weekRhythm, weeksText, studentsText } from '@/lib/program';

/**
 * What the halaqa must memorize in the period it is in, from the program its institution set. A teacher can put
 * the period's verses in every student's plan; a student sees what is asked of her and how the period is assessed.
 */
export function ProgramNow({ sectionId, sectionName }: { sectionId: string; sectionName?: string }) {
  const queryClient = useQueryClient();
  const now = useQuery({ queryKey: queryKeys.sectionProgram(sectionId), queryFn: () => api.getSectionProgram(sectionId).then((r) => r.data) });
  const [notice, setNotice] = useState('');
  const apply = useMutation({
    mutationFn: () => api.applySectionProgram(sectionId).then((r) => r.data),
    onSuccess: (r) => {
      setNotice(r.added === 0
        ? 'آيات هذه الفترة موجودة في خطط الطالبات كلها، فلم يُضف شيء.'
        : `وُضعت آيات الفترة (${toArabicDigits(r.ayat)} آية) في خطط ${studentsText(r.students, true)}: أُضيف ${toArabicDigits(r.added)} بطاقة جديدة. ما كان في خطة طالبة من قبل لم يتكرر.${r.skipped ? ` ولم تُضف لـ ${studentsText(r.skipped, true)} لم تجتز فترتها السابقة بعد.` : ''}`);
      queryClient.invalidateQueries({ queryKey: ['sections', sectionId] });
    },
  });

  if (!now.data || now.data.program === null) return null; // the halaqa follows no program
  const n = now.data;
  const p = n.period;
  const w = n.program.weights;

  return (
    <Card data-testid="program-now">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <BookOpenCheck className="w-5 h-5 text-brand-primary" />مقرّر الحفظ{sectionName ? ` — ${sectionName}` : ''}
          {n.status === 'running' && <Badge variant={n.phase === 'hifz' ? 'green' : 'gold'} size="sm">{PHASE_LABEL[n.phase]}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {n.status === 'not_started' && <p>يبدأ برنامج «{n.program.nameAr}» يوم {programDay(n.startsOn)}.</p>}
        {n.status === 'finished' && <p>انتهى برنامج «{n.program.nameAr}» ({weeksText(n.totalWeeks)}). بارك الله فيكنّ.</p>}
        {n.status !== 'finished' && (
          <>
            <p className="text-text-secondary">
              {n.program.nameAr} · الفترة {toArabicDigits(n.periodNumber)} من {toArabicDigits(n.periodCount)}: <span className="font-medium text-text-primary">{p.nameAr}</span>
              {n.status === 'running' && <> · الأسبوع {toArabicDigits(n.weekInPeriod)} من {toArabicDigits(p.weeks)}</>}
            </p>
            {p.startRef && p.endRef ? (
              <div className="rounded-xl bg-surface-canvas p-3 space-y-1">
                <p className="font-medium text-text-primary text-base" data-testid="program-required">{formatAyahRange(p.startRef, p.endRef)}</p>
                <p className="text-text-secondary">
                  نحو {toArabicDigits(p.pages)} صفحة ({toArabicDigits(p.ayat)} آية) · {paceLabel(p.pagesPerDay)} ({toArabicDigits(p.pagesPerWeek)} صفحة أسبوعياً)
                </p>
              </div>
            ) : (
              <p className="rounded-xl bg-surface-canvas p-3">لا حفظ جديد في هذه الفترة: راجعي ما حفظتِه وثبّتيه.</p>
            )}
            {p.goalAr && <p><span className="text-text-secondary">الهدف: </span>{p.goalAr}</p>}
            <p className="text-text-secondary">{weekRhythm(n.program.hifzDaysPerWeek)}.</p>
            <p className="text-text-secondary">تمتد الفترة من {programDay(n.startsOn)} إلى {programDay(n.endsOn)}.</p>
            <p className="text-text-secondary">
              الانتقال للفترة التالية: مجموع {toArabicDigits(n.program.passScore)} فأكثر، ولا يقل أي معيار عن {toArabicDigits(n.program.minCriterionPct)}٪ من درجته
              (الحفظ {toArabicDigits(w.hifz)}، التجويد {toArabicDigits(w.tajweed)}، المراجعة {toArabicDigits(w.review)}، التثبيت {toArabicDigits(w.retention)}).
            </p>
            {n.next && <p className="text-text-secondary">التالية: {n.next.nameAr}{n.next.startRef && n.next.endRef ? ` — ${formatAyahRange(n.next.startRef, n.next.endRef)}` : ''}.</p>}
          </>
        )}
        {n.mine && <MyStanding mine={n.mine} />}
        {n.canApply && (
          <div className="pt-1 space-y-2">
            <Button size="sm" loading={apply.isPending}
              onClick={() => { setNotice(''); if (window.confirm('إضافة آيات هذه الفترة إلى خطط جميع طالبات الحلقة كحفظ جديد؟')) apply.mutate(); }}>
              أضيفي آيات الفترة إلى خطط الطالبات
            </Button>
            {notice && <p role="status" className="text-text-primary">{notice}</p>}
            {apply.isError && <p role="alert" className="text-red-800">{errorMessage(apply.error, 'تعذّرت الإضافة.')}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The student's own view: the program of each halaqa she is in. */
export function StudentProgram() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: () => api.getMe().then((r) => r.data) });
  const sections = me.data?.sections ?? [];
  return <>{sections.map((s) => <ProgramNow key={s.id} sectionId={s.id} sectionName={sections.length > 1 ? s.nameAr : undefined} />)}</>;
}

/** Where the student stands: the periods she has passed, the one she is on (which may be behind her halaqa's), her last result and what to do next. */
function MyStanding({ mine }: { mine: NonNullable<Extract<import('@/lib/api').SectionProgram, { mine: unknown }>['mine']> }) {
  const on = mine.current;
  return (
    <div className="rounded-xl border border-divider p-3 space-y-2" data-testid="my-standing">
      <p className="font-medium text-text-primary">
        {mine.finished ? 'أتممتِ فترات البرنامج كلها. بارك الله فيكِ.' : `أنهيتِ ${toArabicDigits(mine.passed)} من ${toArabicDigits(mine.periodCount)} فترات.`}
      </p>
      {mine.behind && on && (
        <div className="rounded-lg bg-amber-50 text-amber-900 px-3 py-2 space-y-1" data-testid="behind">
          <p>حلقتكِ انتقلت، وأنتِ لا تزالين في «<b>{on.nameAr}</b>». أكملي فترتكِ ثم تُختبرين فيها.</p>
          {on.startRef && on.endRef && <p>المطلوب: {formatAyahRange(on.startRef, on.endRef)} · {paceLabel(on.pagesPerDay)}.</p>}
          <p className="text-xs">لا تُضاف آيات الفترة التالية إلى خطتكِ قبل أن تجتازي «{on.nameAr}».</p>
        </div>
      )}
      {mine.last && (
        <p data-testid="my-last-result">
          آخر نتيجة: «{mine.last.periodName}» — <b>{mine.last.outcome === 'passed' ? 'نجاح' : 'إعادة'}</b> بمجموع {toArabicDigits(mine.last.total)} من ١٠٠
          {mine.last.weakest && <> · الأولى بالعناية: {CRITERION_LABEL[mine.last.weakest]}</>}.
        </p>
      )}
      {mine.failures > 0 && !mine.finished && (
        <p>{mine.retestWaiting && mine.retestOn ? `أسبوع علاج بلا حفظ جديد: يُعاد الاختبار من ${programDay(mine.retestOn)}.` : 'يمكن إعادة اختبارك الآن: كلّمي معلمتكِ.'}</p>
      )}
      {mine.slowdown && on && <p className="text-xs text-text-secondary">خُفّضت وتيرتكِ في «{on.nameAr}» درجة واحدة ({paceLabel(on.pagesPerDay)}) لأن الفترة السابقة احتاجت أكثر من محاولة.</p>}
    </div>
  );
}
