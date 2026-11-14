'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { ClipboardCheck } from 'lucide-react';
import { assess, scoreProblem, type Scores } from '@itqan/quran';
import { api, errorMessage, queryKeys, type Criterion, type PeriodStandingRow, type PeriodTestForm } from '@/lib/api';
import { toArabicDigits } from '@/lib/quran';
import { CRITERIA, CRITERION_LABEL, PHASE_LABEL, programDay } from '@/lib/program';
import { LoadError, Spinner } from '@/components/LoadState';

const field = 'rounded-xl border border-divider bg-surface-elevated px-3 py-2 text-sm';
const STATUS: Record<PeriodStandingRow['status'], { label: string; tone: 'green' | 'gold' | 'neutral' | 'info' }> = {
  ready: { label: 'جاهزة للاختبار', tone: 'green' },
  retest_due: { label: 'إعادة الاختبار مستحقة', tone: 'gold' },
  retest_waiting: { label: 'أسبوع علاج', tone: 'info' },
  working: { label: 'تعمل على الفترة', tone: 'neutral' },
  finished: { label: 'أتمّت البرنامج', tone: 'green' },
};
const REASON: Record<string, string> = {
  not_started: 'لم يبدأ البرنامج بعد.',
  not_reached: 'لم تصل الحلقة إلى اختبار هذه الفترة بعد.',
  finished: 'أتمّت الطالبة فترات البرنامج كلها.',
  retest_waiting: 'أسبوع علاج: لا يُعاد الاختبار قبل مضي خمسة أيام على المحاولة السابقة.',
};

/** The halaqa's period tests: where each student stands, and the form that records a test and shows at once what the rules decide. */
export function PeriodTests({ sectionId }: { sectionId: string }) {
  const standings = useQuery({ queryKey: queryKeys.periodStandings(sectionId), queryFn: () => api.getPeriodStandings(sectionId).then((r) => r.data) });
  const [open, setOpen] = useState<string | null>(null);
  if (standings.isLoading) return <Spinner />;
  if (standings.isError || !standings.data) return <LoadError onRetry={() => standings.refetch()} />;
  const { position, students, periods } = standings.data;

  return (
    <Card data-testid="period-tests">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-brand-primary" />اختبارات الفترات</CardTitle>
        <CardDescription>
          {position.status === 'not_started' ? 'لم يبدأ البرنامج بعد.' : position.status === 'finished' ? 'انتهت مدة البرنامج.'
            : <>الحلقة الآن في «{position.periodName}» ({PHASE_LABEL[position.phase]}). تُختبر الطالبة في فترتها عند وصول الحلقة إلى أسبوع اختبارها، وتنتقل إلى التالية إن نجحت.</>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {students.length === 0 ? <p className="text-sm text-text-secondary">لا طالبات في الحلقة.</p> : (
          <ul className="divide-y divide-divider" data-testid="period-students">
            {students.map((s) => (
              <li key={s.studentId} className="py-3 space-y-2" data-testid={`period-student-${s.studentId}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text-primary flex items-center gap-2 flex-wrap">
                      {s.name}
                      <Badge variant={STATUS[s.status].tone} size="sm">{STATUS[s.status].label}</Badge>
                      {s.behind && <Badge variant="gold" size="sm">متأخرة عن الحلقة</Badge>}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {s.status === 'finished' ? `أنهت ${toArabicDigits(periods.length)} فترات` : <>أنهت {toArabicDigits(s.passed)} من {toArabicDigits(periods.length)} · فترتها: {s.currentName}</>}
                      {s.failures > 0 && <> · محاولات لم تنجح: {toArabicDigits(s.failures)}</>}
                      {s.last && <> · آخر نتيجة: {s.last.outcome === 'passed' ? 'نجاح' : 'إعادة'} ({toArabicDigits(s.last.total)})</>}
                      {s.retestOn && s.status === 'retest_waiting' && <> · الإعادة من {programDay(s.retestOn)}</>}
                      {s.slowdown && <> · وتيرتها في فترتها أبطأ بدرجة</>}
                    </p>
                  </div>
                  <Button size="sm" variant={s.canTest ? 'primary' : 'outline'} aria-expanded={open === s.studentId} onClick={() => setOpen(open === s.studentId ? null : s.studentId)}>
                    {s.canTest ? 'تسجيل الاختبار' : 'التفاصيل'}
                  </Button>
                </div>
                {open === s.studentId && <TestPanel sectionId={sectionId} studentId={s.studentId} onDone={() => setOpen(null)} />}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TestPanel({ sectionId, studentId, onDone }: { sectionId: string; studentId: string; onDone: () => void }) {
  const form = useQuery({ queryKey: queryKeys.periodTestForm(sectionId, studentId), queryFn: () => api.getPeriodTestForm(sectionId, studentId).then((r) => r.data), staleTime: 0 });
  if (form.isLoading) return <Spinner />;
  if (form.isError || !form.data) return <LoadError onRetry={() => form.refetch()} />;
  return <TestForm sectionId={sectionId} studentId={studentId} form={form.data} onDone={onDone} />;
}

function TestForm({ sectionId, studentId, form, onDone }: { sectionId: string; studentId: string; form: PeriodTestForm; onDone: () => void }) {
  const queryClient = useQueryClient();
  const criteria = CRITERIA.filter((c) => c !== 'review' || form.reviewApplies);
  const [values, setValues] = useState<Record<Criterion, string>>({ hifz: '', tajweed: '', review: '', retention: '' });
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.periodStandings(sectionId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.periodTestForm(sectionId, studentId) });
    queryClient.invalidateQueries({ queryKey: ['sections', sectionId, 'program'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.notificationCount });
  };

  const numbers = useMemo(() => Object.fromEntries(criteria.map((c) => [c, values[c].trim() === '' ? NaN : Number(values[c])])) as Record<Criterion, number>, [criteria, values]);
  const scores: Scores = { hifz: numbers.hifz, tajweed: numbers.tajweed, review: form.reviewApplies ? numbers.review : 0, retention: numbers.retention };
  const problem = scoreProblem(scores, form.weights);
  const preview = problem === null ? assess(scores, { weights: { ...form.weights, ...(form.reviewApplies ? {} : { review: 0 }) }, passScore: form.passScore, minCriterionPct: form.minCriterionPct }, true) : null;

  const save = useMutation({
    mutationFn: () => api.recordPeriodTest(sectionId, studentId, {
      periodIndex: form.period.index, note: note.trim() || undefined,
      scores: { hifz: numbers.hifz, tajweed: numbers.tajweed, retention: numbers.retention, ...(form.reviewApplies ? { review: numbers.review } : {}) },
    }).then((r) => r.data),
    onSuccess: (r) => {
      setNotice(r.result.outcome === 'passed'
        ? `نجحت: ${toArabicDigits(r.result.total)} من ١٠٠. ${r.standing.next ? `انتقلت إلى «${r.standing.next}».` : 'أتمّت البرنامج.'}`
        : `لم تنجح: ${toArabicDigits(r.result.total)} من ١٠٠. أسبوع علاج ثم إعادة الاختبار من ${programDay(r.standing.retestOn!)}.${r.standing.slowdown ? ' وتخفَّض وتيرتها في الفترة التالية.' : ''}`);
      refresh();
    },
  });
  const undo = useMutation({
    mutationFn: (id: string) => api.voidPeriodTest(sectionId, studentId, id, 'تصحيح خطأ في الإدخال'),
    onSuccess: () => { setNotice('تُراجع آخر نتيجة، ويمكنكِ تسجيلها من جديد.'); refresh(); },
  });
  const ruleText = (f: NonNullable<typeof preview>['failed'][number]) => f.rule === 'total'
    ? `المجموع أقل من ${toArabicDigits(form.passScore)}`
    : `${CRITERION_LABEL[f.criterion]} أقل من الحد الأدنى (${toArabicDigits(Math.round((form.weights[f.criterion] * form.minCriterionPct) / 10) / 10)})`;

  return (
    <div className="rounded-2xl bg-surface-canvas p-4 space-y-4" data-testid="period-test-form">
      <p className="text-sm text-text-primary">
        اختبار «<b>{form.period.nameAr}</b>»{form.attempts.length > 0 && <> — المحاولة {toArabicDigits(form.attempts.length + 1)}</>}
      </p>

      {!form.canTest ? (
        <p className="text-sm text-text-secondary" data-testid="period-test-blocked">
          {REASON[form.reason ?? 'not_reached']}{form.reason === 'retest_waiting' && form.retestOn && <> الإعادة من {programDay(form.retestOn)}.</>}
        </p>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setNotice(''); if (preview) save.mutate(); }}>
          <div className="grid sm:grid-cols-2 gap-3">
            {criteria.map((c) => {
              const proposal = form.proposals?.[c];
              return (
                <label key={c} className="text-sm space-y-1 block">
                  <span className="block text-text-primary">{CRITERION_LABEL[c]} <span className="text-text-secondary">(من {toArabicDigits(form.weights[c])})</span></span>
                  <input type="number" inputMode="decimal" min={0} max={form.weights[c]} step={0.5} className={`${field} w-28`} aria-label={`درجة ${CRITERION_LABEL[c]}`}
                    value={values[c]} onChange={(e) => setValues({ ...values, [c]: e.target.value })} required />
                  {proposal && (
                    <button type="button" className="block text-xs text-brand-primary underline" onClick={() => setValues({ ...values, [c]: String(proposal.score) })}>
                      المقترح {toArabicDigits(proposal.score)} ({proposal.basis.kind === 'recitations' ? `من ${toArabicDigits(proposal.basis.n)} تسميعات` : `من ${toArabicDigits(proposal.basis.n)} مراجعات`}) — استخدميه
                    </button>
                  )}
                </label>
              );
            })}
          </div>
          {!form.reviewApplies && <p className="text-xs text-text-secondary">لا فترة سابقة لتُراجَع، فتوزَّع درجة المراجعة على بقية المعايير.</p>}
          <label className="text-sm block">
            <span className="block text-text-secondary mb-1">ملاحظة (اختيارية)</span>
            <textarea className={`${field} w-full`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          <div className="rounded-xl border border-divider bg-surface-elevated p-3 text-sm space-y-1" aria-live="polite" data-testid="period-preview">
            {preview ? (
              <>
                <p>المجموع: <b>{toArabicDigits(preview.total)}</b> من ١٠٠ — شرط الانتقال {toArabicDigits(form.passScore)}، ولا معيار دون {toArabicDigits(form.minCriterionPct)}٪ من درجته.</p>
                <p className={preview.outcome === 'passed' ? 'text-state-positive font-medium' : 'text-red-800 font-medium'}>
                  {preview.outcome === 'passed' ? 'ناجحة: تنتقل إلى الفترة التالية.' : `إعادة: ${preview.failed.map(ruleText).join('، ')}.`}
                </p>
              </>
            ) : <p className="text-text-secondary">أدخلي الدرجات الأربع لترين النتيجة{problem ? ` (درجة ${CRITERION_LABEL[problem]} بين ٠ و${toArabicDigits(form.weights[problem])})` : ''}.</p>}
          </div>
          <Button type="submit" loading={save.isPending} disabled={!preview}>حفظ النتيجة</Button>
        </form>
      )}

      {form.attempts.length > 0 && (
        <ul className="text-sm space-y-1" data-testid="period-attempts">
          {form.attempts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2">
              <Badge variant={a.outcome === 'passed' ? 'green' : 'gold'} size="sm">{a.outcome === 'passed' ? 'نجاح' : 'إعادة'}</Badge>
              محاولة {toArabicDigits(a.attempt)}: {toArabicDigits(a.total)}
              <span className="text-text-secondary">({CRITERIA.filter((c) => a.scores[c] !== null).map((c) => `${CRITERION_LABEL[c]} ${toArabicDigits(a.scores[c]!)}`).join('، ')})</span>
              {a.note && <span className="text-text-secondary">— {a.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {form.latest && (
        <Button size="sm" variant="ghost" loading={undo.isPending}
          onClick={() => { if (window.confirm(`التراجع عن آخر نتيجة (${form.latest!.periodName}، ${toArabicDigits(form.latest!.total)})؟ تبقى محفوظة في السجل وتُحتسب كأنها لم تكن.`)) undo.mutate(form.latest!.id); }}>
          التراجع عن آخر نتيجة
        </Button>
      )}
      {notice && <p role="status" className="text-sm text-text-primary" data-testid="period-notice">{notice} <button type="button" className="underline text-brand-primary" onClick={onDone}>إغلاق</button></p>}
      {(save.isError || undo.isError) && <p role="alert" className="text-sm text-red-800">{errorMessage(save.error ?? undo.error, 'تعذّر الحفظ.')}</p>}
    </div>
  );
}
