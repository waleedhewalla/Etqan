'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@itqan/ui';
import { Plus, Trash2 } from 'lucide-react';
import { AYAH_COUNTS } from '@itqan/quran';
import { api, errorMessage, queryKeys, type HifzPlan, type PlanRange, type PlanStatus } from '@/lib/api';
import { ayatCount, formatAyahRange, SURAH_NAMES, toArabicDigits } from '@/lib/quran';
import { LoadError, Spinner } from '@/components/LoadState';

/** The most ayat the server takes in one step. */
const MAX_AYAT = 300;
const field = 'rounded-xl border border-divider bg-surface-elevated px-3 py-2';

/** Where a teacher says what a student has memorized and what she memorizes next. Without it her revision queue is empty. */
export function HifzPlanCard({ sectionId, studentId }: { sectionId: string; studentId: string }) {
  const queryClient = useQueryClient();
  const key = queryKeys.plan(sectionId, studentId);
  const planQuery = useQuery({ queryKey: key, queryFn: () => api.getPlan(sectionId, studentId).then((r) => r.data) });

  const [sura, setSura] = useState(114);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(AYAH_COUNTS[113]);
  const [status, setStatus] = useState<PlanStatus>('memorized');
  const [notice, setNotice] = useState('');
  const count = AYAH_COUNTS[sura - 1];
  const valid = from >= 1 && to <= count && from <= to && to - from + 1 <= MAX_AYAT;

  const settle = (plan: HifzPlan, message: string) => {
    queryClient.setQueryData(key, plan);
    queryClient.invalidateQueries({ queryKey: queryKeys.sectionStudents(sectionId) });
    setNotice(message);
  };
  const add = useMutation({
    mutationFn: () => api.addToPlan(sectionId, studentId, { startRef: `${sura}:${from}`, endRef: `${sura}:${to}`, status }).then((r) => r.data),
    onSuccess: ({ added, skipped, plan }) => settle(plan, added === 0
      ? 'هذه الآيات موجودة في خطتها من قبل.'
      : `أُضيفت ${ayatCount(added)}${skipped ? `، و${ayatCount(skipped)} كانت موجودة من قبل` : ''}.`),
  });
  const remove = useMutation({
    mutationFn: (range: PlanRange) => api.removeFromPlan(sectionId, studentId, { startRef: range.startRef, endRef: range.endRef }).then((r) => r.data),
    onSuccess: ({ removed, kept, plan }) => settle(plan, kept
      ? `حُذفت ${ayatCount(removed)}، وبقيت ${ayatCount(kept)} راجعتها الطالبة فلا تُحذف.`
      : `حُذفت ${ayatCount(removed)}.`),
  });
  /** Removes a run a piece at a time: the server takes at most MAX_AYAT ayat per request. */
  const confirmRemove = (range: PlanRange) => {
    if (range.count > MAX_AYAT) { setNotice('هذا النطاق كبير؛ احذفيه سورةً سورة.'); return; }
    if (window.confirm(`حذف ${formatAyahRange(range.startRef, range.endRef)} من خطة الطالبة؟ الآيات التي راجعتها تبقى.`)) remove.mutate(range);
  };
  const setNumber = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { set(Number(e.target.value)); setNotice(''); };
  const plan = planQuery.data;

  return (
    <Card>
      <CardHeader><CardTitle>خطة الحفظ</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {planQuery.isLoading ? <Spinner /> : !plan ? <LoadError onRetry={() => planQuery.refetch()} /> : plan.total === 0 ? (
          <p className="text-sm text-text-secondary">
            لم تُحدَّد خطة لهذه الطالبة بعد، فلن يظهر لها شيء في مراجعة اليوم. أضيفي ما تحفظه وما ستحفظه.
          </p>
        ) : (
          <>
            <p className="text-sm text-text-secondary">
              في المراجعة: {ayatCount(plan.memorized)} · حفظ جديد: {ayatCount(plan.new)}
            </p>
            <ul id="plan-ranges" className="divide-y divide-divider text-sm max-h-64 overflow-y-auto">
              {plan.ranges.map((r) => (
                <li key={`${r.startRef}-${r.status}`} className="py-2 flex items-center justify-between gap-3">
                  <span className="font-medium">{formatAyahRange(r.startRef, r.endRef)}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-text-secondary">{ayatCount(r.count)}</span>
                    <Badge variant={r.status === 'new' ? 'amber' : 'green'}>{r.status === 'new' ? 'جديد' : 'مراجعة'}</Badge>
                    <button type="button" onClick={() => confirmRemove(r)} disabled={remove.isPending}
                      className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-elevated hover:text-red-800"
                      aria-label={`حذف ${formatAyahRange(r.startRef, r.endRef)}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) add.mutate(); }}>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="block text-text-secondary mb-1">السورة</span>
              <select id="plan-sura" value={sura} className={`${field} min-w-[10rem]`}
                onChange={(e) => { const n = Number(e.target.value); setSura(n); setFrom(1); setTo(AYAH_COUNTS[n - 1]); setNotice(''); }}>
                {SURAH_NAMES.map((name, i) => <option key={name} value={i + 1}>{toArabicDigits(i + 1)}. {name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-text-secondary mb-1">من الآية</span>
              <input id="plan-from" type="number" min={1} max={count} value={from} onChange={setNumber(setFrom)} className={`${field} w-20`} />
            </label>
            <label className="text-sm">
              <span className="block text-text-secondary mb-1">إلى الآية</span>
              <input id="plan-to" type="number" min={1} max={count} value={to} onChange={setNumber(setTo)} className={`${field} w-20`} />
            </label>
          </div>
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <legend className="sr-only">حالة الآيات</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="plan-status" checked={status === 'memorized'} onChange={() => setStatus('memorized')} />
              محفوظة من قبل — تدخل المراجعة
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="plan-status" checked={status === 'new'} onChange={() => setStatus('new')} />
              حفظ جديد
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={add.isPending} disabled={!valid}><Plus className="w-4 h-4 ml-1" /> إضافة إلى الخطة</Button>
            {!valid && <span className="text-sm text-red-800">تحققي من أرقام الآيات: السورة {ayatCount(count)}، وحتى {ayatCount(MAX_AYAT)} في المرة.</span>}
          </div>
          {status === 'memorized' && (
            <p className="text-xs text-text-secondary">تُوزَّع الآيات المحفوظة على الأيام القادمة، نحو عشرين آية في اليوم، حتى لا تتراكم كلها في يوم واحد.</p>
          )}
        </form>
        {notice && <p role="status" className="text-sm text-text-primary">{notice}</p>}
        {(add.isError || remove.isError) && (
          <p role="alert" className="text-sm text-red-800">{errorMessage(add.error ?? remove.error, 'تعذّر تحديث الخطة. حاولي مرة أخرى.')}</p>
        )}
      </CardContent>
    </Card>
  );
}
