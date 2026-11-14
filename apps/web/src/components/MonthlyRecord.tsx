'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@itqan/ui';
import { ClipboardList, Mic } from 'lucide-react';
import { api, errorMessage, queryKeys, type MonthlyGrade, type MonthlyIssue, type MonthlyRecord as Record_ } from '@/lib/api';
import { formatAyahRange, formatAyahRef, toArabicDigits } from '@/lib/quran';
import { LoadError, Spinner } from '@/components/LoadState';

const GRADE: Record<MonthlyGrade, { label: string; tone: 'green' | 'info' | 'amber' | 'red' }> = {
  excellent: { label: 'ممتاز', tone: 'green' },
  very_good: { label: 'جيد جداً', tone: 'green' },
  good: { label: 'جيد', tone: 'info' },
  pass: { label: 'مقبول', tone: 'amber' },
  weak: { label: 'ضعيف', tone: 'red' },
};
const SKILL = { hifz: 'الحفظ', tajweed: 'التجويد', fluency: 'الطلاقة' } as const;
const VERDICT = { approved: 'مقبول', redo: 'يُعاد', flagged: 'عند الشيخة' } as const;

const num = (n: number) => toArabicDigits(Number.isInteger(n) ? n : n.toFixed(1));
const day = (iso: string) => new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const monthName = (month: string) => new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));

/** This month and the five before it, newest first, as YYYY-MM. */
function recentMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function issueText(issue: MonthlyIssue): string {
  switch (issue.kind) {
    case 'no_recitations': return 'لم تُرسل أي تسميع هذا الشهر.';
    case 'redo': return `تسميع يُعاد (${toArabicDigits(issue.count)}): ${issue.ranges.map((r) => formatAyahRange(r.startRef, r.endRef)).join('، ')}`;
    case 'mistakes': {
      const parts = [
        issue.byType.wrong && `${toArabicDigits(issue.byType.wrong)} خطأ في كلمة`,
        issue.byType.missing && `${toArabicDigits(issue.byType.missing)} كلمة ساقطة`,
        issue.byType.added && `${toArabicDigits(issue.byType.added)} كلمة زائدة`,
      ].filter(Boolean).join('، ');
      return `أخطاء أكّدتها المعلمة (${toArabicDigits(issue.count)}): ${parts} — في ${issue.ayat.map(formatAyahRef).join('، ')}`;
    }
    case 'weak_skill': return `${SKILL[issue.skill]} يحتاج إلى عناية: متوسطه ${num(issue.average)} من ١٠٠`;
    case 'absence': return `غياب ${dayCount(issue.count)}: ${issue.dates.map(day).join('، ')}`;
  }
}

/**
 * A student's monthly record: her issues, the total appraisal of her recitations and the degree.
 * With `editable`, her teacher writes the month's appraisal here.
 */
export function MonthlyRecord({ studentId, editable = false }: { studentId: string; editable?: boolean }) {
  const queryClient = useQueryClient();
  const months = recentMonths();
  const [month, setMonth] = useState(months[0]);
  const key = queryKeys.monthly(studentId, month);
  const query = useQuery({ queryKey: key, queryFn: () => api.getMonthlyRecord(studentId, month).then((r) => r.data) });
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (note: string) => api.saveMonthlyAppraisal(studentId, month, note).then((r) => r.data),
    onSuccess: (record) => { queryClient.setQueryData(key, record); setDraft(null); },
  });

  const r: Record_ | undefined = query.data;
  const note = draft ?? r?.appraisal?.note ?? '';

  return (
    <Card data-testid="monthly-record">
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2"><ClipboardList className="w-5 h-5 text-brand-primary" />السجل الشهري</CardTitle>
          <select aria-label="الشهر" value={month} onChange={(e) => { setMonth(e.target.value); setDraft(null); save.reset(); }}
            className="rounded-xl border border-divider bg-surface-elevated px-3 py-2 text-sm">
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? <Spinner /> : !r ? <LoadError onRetry={() => query.refetch()} /> : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-canvas p-3" data-testid="monthly-degree">
                <p className="text-xs text-text-secondary">الدرجة</p>
                {r.degree.score === null ? (
                  <p className="mt-1 text-sm text-text-secondary">لا درجة بعد</p>
                ) : (
                  <p className="mt-1 flex items-center gap-2 flex-wrap">
                    <span className="font-heading text-2xl font-bold tabular-nums text-text-primary">{num(r.degree.score)}</span>
                    <span className="text-sm text-text-secondary">/ {num(r.degree.outOf)}</span>
                    {r.degree.grade && <Badge variant={GRADE[r.degree.grade].tone} size="sm">{GRADE[r.degree.grade].label}</Badge>}
                  </p>
                )}
              </div>
              <div className="rounded-xl bg-surface-canvas p-3" data-testid="monthly-total">
                <p className="text-xs text-text-secondary">مجموع التقييم</p>
                {r.totalAppraisal.average === null ? (
                  <p className="mt-1 text-sm text-text-secondary">لا تسميع مقيَّم</p>
                ) : (
                  <>
                    <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-text-primary">{num(r.totalAppraisal.average)}</p>
                    <p className="text-xs text-text-secondary">متوسط {recitationCount(r.recitations.counted)}</p>
                  </>
                )}
              </div>
            </div>

            {r.totalAppraisal.average !== null && (
              <p className="text-sm text-text-secondary">
                الحفظ {num(r.totalAppraisal.hifz ?? 0)} · التجويد {num(r.totalAppraisal.tajweed ?? 0)} · الطلاقة {num(r.totalAppraisal.fluency ?? 0)}
                {r.recitations.awaiting > 0 && <> · {toArabicDigits(r.recitations.awaiting)} بانتظار التقييم</>}
              </p>
            )}
            <p className="text-xs text-text-secondary">
              الدرجة هي متوسط درجات التسميع المقيَّم في الشهر (الحفظ ٥٠٪، التجويد ٣٠٪، الطلاقة ٢٠٪). ما لم يُقيَّم بعد لا يدخل فيها.
            </p>

            <div>
              <h4 className="text-sm font-medium text-text-primary mb-1.5">ما يحتاج إلى عناية</h4>
              {r.issues.length === 0 ? (
                <p className="text-sm text-text-secondary">لا ملاحظات هذا الشهر.</p>
              ) : (
                <ul className="list-disc ps-5 space-y-1 text-sm text-text-primary" data-testid="monthly-issues">
                  {r.issues.map((issue, i) => <li key={i}>{issueText(issue)}</li>)}
                </ul>
              )}
            </div>

            {r.items.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-brand-primary">تسميع الشهر ({recitationCount(r.items.length)})</summary>
                <ul className="mt-2 divide-y divide-divider">
                  {r.items.map((item) => (
                    <li key={item.id} className="py-2 space-y-1">
                      <p className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-medium">{formatAyahRange(item.startRef, item.endRef)} <span className="text-text-secondary font-normal">· {day(item.submittedAt)}</span></span>
                        <span className="flex items-center gap-2 text-text-secondary">
                          {item.hasVoiceReply && <Mic className="w-3.5 h-3.5" aria-label="ردّ صوتي" />}
                          {item.verdict ? VERDICT[item.verdict] : 'لم يُقيَّم'}
                          {item.total !== null && item.verdict !== 'flagged' && <b className="tabular-nums text-text-primary">{num(item.total)}</b>}
                        </span>
                      </p>
                      {item.notes && <p className="text-text-secondary whitespace-pre-wrap">{item.notes}</p>}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="border-t border-divider pt-4 space-y-2">
              <h4 className="text-sm font-medium text-text-primary">تقييم المعلمة للشهر</h4>
              {editable ? (
                <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) save.mutate(note.trim()); }}>
                  <textarea id="monthly-appraisal" rows={3} maxLength={2000} value={note} onChange={(e) => setDraft(e.target.value)}
                    placeholder="اكتبي تقييمك العام للطالبة هذا الشهر: ما أحسنت فيه وما تحتاج إليه."
                    className="w-full rounded-xl border border-divider bg-surface-elevated px-3 py-2 text-sm" />
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button type="submit" size="sm" loading={save.isPending} disabled={!note.trim() || note.trim() === r.appraisal?.note}>حفظ التقييم</Button>
                    {save.isSuccess && draft === null && <span role="status" className="text-sm text-text-secondary">حُفظ. تراه الطالبة وولي أمرها.</span>}
                  </div>
                  {save.isError && <p role="alert" className="text-sm text-red-800">{errorMessage(save.error, 'لم يُحفظ التقييم.')}</p>}
                </form>
              ) : r.appraisal ? (
                <p className="text-sm whitespace-pre-wrap rounded-lg bg-surface-canvas px-3 py-2">{r.appraisal.note}</p>
              ) : (
                <p className="text-sm text-text-secondary">لم تكتب المعلمة تقييم هذا الشهر بعد.</p>
              )}
              {r.appraisal && (
                <p className="text-xs text-text-secondary">
                  {r.appraisal.teacherName ?? 'المعلمة'} · {day(r.appraisal.updatedAt)}
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** A count of recitations in correct Arabic. */
function recitationCount(n: number): string {
  if (n === 1) return 'تسميع واحد';
  if (n === 2) return 'تسميعين';
  return `${toArabicDigits(n)} ${n % 100 >= 3 && n % 100 <= 10 ? 'تسميعات' : 'تسميعاً'}`;
}

/** A count of days in correct Arabic. */
function dayCount(n: number): string {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  return `${toArabicDigits(n)} ${n % 100 >= 3 && n % 100 <= 10 ? 'أيام' : 'يوماً'}`;
}
