import { Badge, Card, CardContent, CardHeader, CardTitle } from '@itqan/ui';
import { CalendarCheck, CalendarX, Flame, Mic, Target, BookOpen } from 'lucide-react';
import type { WeeklyReport } from '@/lib/api';
import { formatAyahRange, toArabicDigits } from '@/lib/quran';

const VERDICTS: Record<string, { label: string; variant: 'green' | 'amber' | 'red' | 'info' }> = {
  approved: { label: 'مقبول', variant: 'green' },
  redo: { label: 'يُعاد', variant: 'amber' },
  flagged: { label: 'بحاجة مراجعة', variant: 'red' },
};

const ASSIGNMENT_TYPES = { sabaq: 'سبق', sabqi: 'سبقي', manzil: 'منزل' } as const;

export function formatDateAr(date: string) {
  return new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${date}T12:00:00`));
}

/** One student's week: attendance, revision, tasmi' and assignments. Print-friendly. */
export function WeeklyReportView({ report }: { report: WeeklyReport }) {
  const stats = [
    { label: 'الحضور', value: `${toArabicDigits(report.attendance.present)} / ${toArabicDigits(report.attendance.present + report.attendance.absent)}`, icon: CalendarCheck },
    { label: 'أيام المراجعة', value: `${toArabicDigits(report.revision.activeDays.length)} / ٧`, icon: BookOpen },
    { label: 'الآيات المثبّتة', value: `${toArabicDigits(report.progress.masteryPercent)}٪`, icon: Target },
    { label: 'السلسلة', value: `${toArabicDigits(report.streak.current)} يوم`, icon: Flame },
  ];

  return (
    <div className="space-y-4 print:space-y-3">
      <div>
        <h3 className="font-heading text-xl font-bold text-text-primary">{report.student.displayNameAr}</h3>
        <p className="text-sm text-text-secondary">
          {report.sections.map((s) => s.nameAr).join('، ') || 'بدون حلقة'} • الأسبوع من {formatDateAr(report.week.start)} إلى {formatDateAr(report.week.end)}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.label} variant="metric">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm text-text-secondary">{s.label}</p>
                <p className="mt-1 text-2xl font-bold text-text-primary tabular-nums">{s.value}</p>
              </div>
              <s.icon className="w-5 h-5 text-brand-primary" />
            </div>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>الحضور هذا الأسبوع</CardTitle></CardHeader>
          <CardContent>
            {report.attendance.days.length === 0 ? (
              <p className="text-sm text-text-secondary">لم يُسجَّل حضور بعد هذا الأسبوع.</p>
            ) : (
              <ul className="divide-y divide-divider text-sm">
                {report.attendance.days.map((d) => (
                  <li key={d.date} className="py-2 flex items-center justify-between gap-3">
                    <span>{formatDateAr(d.date)}</span>
                    {d.present ? (
                      <span className="flex items-center gap-1 text-state-positive"><CalendarCheck className="w-4 h-4" /> حاضرة</span>
                    ) : (
                      <span className="flex items-center gap-1 text-state-danger"><CalendarX className="w-4 h-4" /> غائبة</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>المراجعة</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <b className="tabular-nums">{toArabicDigits(report.revision.reviews)}</b> مراجعة هذا الأسبوع
              {report.revision.correctPercent !== null && (
                <> — <b className="tabular-nums">{toArabicDigits(report.revision.correctPercent)}٪</b> منها ثابتة</>
              )}
            </p>
            <p className="text-text-secondary">
              {toArabicDigits(report.progress.cardsDue)} آية مستحقة للمراجعة الآن من أصل {toArabicDigits(report.progress.cardsTotal)}.
            </p>
            <p className="text-text-secondary">أطول سلسلة: {toArabicDigits(report.streak.longest)} يوم.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Mic className="w-5 h-5" /> التسميع</CardTitle></CardHeader>
        <CardContent>
          {report.tasmi.length === 0 ? (
            <p className="text-sm text-text-secondary">لا تسميع هذا الأسبوع.</p>
          ) : (
            <ul className="divide-y divide-divider text-sm">
              {report.tasmi.map((t) => (
                <li key={t.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                  <span className="font-medium">{formatAyahRange(t.startRef, t.endRef)}</span>
                  <span className="flex items-center gap-2">
                    {t.score !== null && <span className="tabular-nums text-text-secondary">{toArabicDigits(Math.round(t.score))}/١٠٠</span>}
                    {t.verdict ? (
                      <Badge variant={VERDICTS[t.verdict].variant} size="sm">{VERDICTS[t.verdict].label}</Badge>
                    ) : (
                      <Badge variant="neutral" size="sm">بانتظار المعلمة</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {report.assignments.length > 0 && (
        <Card>
          <CardHeader><CardTitle>تكليفات الأسبوع</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-divider text-sm">
              {report.assignments.map((a) => (
                <li key={a.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                  <span><Badge variant="info" size="sm">{ASSIGNMENT_TYPES[a.type]}</Badge> <span className="font-medium ms-2">{formatAyahRange(a.startRef, a.endRef)}</span></span>
                  <span className="text-text-secondary">{a.completedAt ? 'أُنجز' : a.dueDate ? `حتى ${formatDateAr(a.dueDate)}` : ''}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
