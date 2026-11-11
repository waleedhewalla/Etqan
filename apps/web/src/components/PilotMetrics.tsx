'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@itqan/ui';
import { LineChart } from 'lucide-react';
import { api, queryKeys, type PilotWeek } from '@/lib/api';
import { toArabicDigits } from '@/lib/quran';
import { LoadError, Spinner } from '@/components/LoadState';

const day = (iso: string) => new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const share = (n: number, of: number) => (of === 0 ? '—' : `${toArabicDigits(Math.round((n / of) * 100))}٪`);
const hours = (h: number | null) => (h === null ? '—' : h < 48 ? `${toArabicDigits(Math.round(h))} ساعة` : `${toArabicDigits(Math.round(h / 24))} يوم`);

/**
 * The pilot's four questions, week by week: are students revising regularly, how fast are recitations reviewed,
 * do guardians open the report, and do students stay.
 */
export function PilotMetrics({ tenantId }: { tenantId?: string }) {
  const q = useQuery({ queryKey: queryKeys.pilot(tenantId), queryFn: () => api.getPilotReport(tenantId).then((r) => r.data) });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><LineChart className="w-5 h-5 text-brand-primary" />مؤشرات التجربة — آخر ٤ أسابيع</CardTitle>
        <p className="text-sm text-text-secondary">
          الأسبوع يبدأ السبت. «منتظمة» = راجعت {toArabicDigits(q.data?.regularDays ?? 4)} أيام أو أكثر في الأسبوع. تُحتسب الطالبات المسجّلات حالياً في حلقة.
        </p>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <Spinner /> : q.isError || !q.data ? <LoadError onRetry={() => q.refetch()} /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="pilot-table">
                <thead>
                  <tr className="text-text-secondary text-right border-b border-divider">
                    <th scope="col" className="py-2 pe-3 font-medium">الأسبوع</th>
                    <th scope="col" className="py-2 pe-3 font-medium">منتظمات</th>
                    <th scope="col" className="py-2 pe-3 font-medium">نشيطات</th>
                    <th scope="col" className="py-2 pe-3 font-medium">المراجعات</th>
                    <th scope="col" className="py-2 pe-3 font-medium">تسميعات روجعت</th>
                    <th scope="col" className="py-2 pe-3 font-medium">وسيط زمن المراجعة</th>
                    <th scope="col" className="py-2 font-medium">أولياء فتحوا التقرير</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.weeks.map((w: PilotWeek) => (
                    <tr key={w.start} className="border-b border-divider/60">
                      <th scope="row" className="py-2 pe-3 font-normal whitespace-nowrap">
                        {day(w.start)} – {day(w.end)}
                        {w.partial && <span className="text-xs text-state-attention"> (جارٍ)</span>}
                      </th>
                      <td className="py-2 pe-3 tabular-nums"><b>{share(w.regular, w.enrolled)}</b> <span className="text-text-secondary">({toArabicDigits(w.regular)}/{toArabicDigits(w.enrolled)})</span></td>
                      <td className="py-2 pe-3 tabular-nums">{toArabicDigits(w.active)}</td>
                      <td className="py-2 pe-3 tabular-nums">{toArabicDigits(w.reviews)}</td>
                      <td className="py-2 pe-3 tabular-nums">{toArabicDigits(w.recitations.reviewed)}/{toArabicDigits(w.recitations.submitted)}</td>
                      <td className="py-2 pe-3 tabular-nums">{hours(w.recitations.medianHoursToReview)}</td>
                      <td className="py-2 tabular-nums">{toArabicDigits(w.guardians.opened)}/{toArabicDigits(w.guardians.linked)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {q.data.retention && (
              <p className="mt-3 text-sm" data-testid="pilot-retention">
                الاستمرار: من <b>{toArabicDigits(q.data.retention.cohort)}</b> طالبة نشيطة في أسبوع {day(q.data.retention.fromWeek)}،
                {' '}<b>{toArabicDigits(q.data.retention.retained)}</b> ما زلن نشيطات في أسبوع {day(q.data.retention.toWeek)}
                {q.data.retention.cohort > 0 && <> ({share(q.data.retention.retained, q.data.retention.cohort)})</>}.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
