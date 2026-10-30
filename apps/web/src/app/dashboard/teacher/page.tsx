'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Input } from '@itqan/ui';
import {
  Users, AlertCircle, TrendingUp, BookOpen, Trophy, LifeBuoy, UserRound, Mic, CheckCircle2,
  CalendarCheck, Copy, UserPlus, X, Target,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { HelpTickets } from '@/components/HelpTickets';
import { AccountPanel } from '@/components/AccountPanel';
import { PreviewNotice } from '@/components/PreviewNotice';
import { FullPageSpinner, LoadError, Spinner } from '@/components/LoadState';
import { WeeklyReportView } from '@/components/WeeklyReportView';
import { VerseText } from '@/components/VerseText';
import { TasmiAudio } from '@/components/TasmiAudio';
import { FlaggedVerse } from '@/components/FlaggedVerse';
import { AiCheckingSwitch } from '@/components/AiCheckingSwitch';
import { MutashabihatAuthoring } from '@/components/MutashabihatAuthoring';
import { useRequireRole } from '@/lib/auth-context';
import {
  api, errorMessage, normalizePhone, queryKeys,
  type AttendanceDay, type StudentSummary, type TasmiReviewInput, type TasmiSubmission,
} from '@/lib/api';
import { formatAyahRange, toArabicDigits } from '@/lib/quran';

type TeacherTab = 'overview' | 'students' | 'attendance' | 'speedgrader' | 'mutashabihat' | 'cases' | 'assessments' | 'reports' | 'account' | 'help';

const TEACHER_ROLES = ['lecturer', 'muhaffiza', 'sheikh_reviewer', 'advisor', 'dean', 'operator', 'superadmin'] as const;

function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

function lastActiveLabel(s: StudentSummary) {
  if (s.inactiveDays === null) return 'لم تبدأ بعد';
  if (s.inactiveDays === 0) return 'اليوم';
  if (s.inactiveDays === 1) return 'أمس';
  return `منذ ${toArabicDigits(s.inactiveDays)} أيام`;
}

function riskLabel(reasons: StudentSummary['riskReasons'], s: StudentSummary) {
  return reasons.map((r) => r === 'inactive'
    ? (s.inactiveDays === null ? 'لم تبدأ المراجعة' : `لا مراجعة منذ ${toArabicDigits(s.inactiveDays)} أيام`)
    : `حضور ${toArabicDigits(Math.round((s.attendanceRate ?? 0) * 100))}٪ في آخر ٣٠ يوماً`).join(' • ');
}

export default function TeacherDashboard() {
  const { user, ready } = useRequireRole([...TEACHER_ROLES], '/auth/login/faculty');
  const [activeTab, setActiveTab] = useState<TeacherTab>('overview');
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [openStudent, setOpenStudent] = useState<string | null>(null);

  const sectionsQuery = useQuery({
    queryKey: queryKeys.sections,
    queryFn: () => api.getSections().then((r) => r.data),
    enabled: ready,
  });

  useEffect(() => {
    if (!sectionId && sectionsQuery.data?.length) setSectionId(sectionsQuery.data[0].id);
  }, [sectionId, sectionsQuery.data]);

  const section = sectionsQuery.data?.find((s) => s.id === sectionId) ?? null;

  const studentsQuery = useQuery({
    queryKey: queryKeys.sectionStudents(sectionId ?? ''),
    queryFn: () => api.getSectionStudents(sectionId!).then((r) => r.data),
    enabled: Boolean(sectionId),
  });
  const reportQuery = useQuery({
    queryKey: queryKeys.sectionReport(sectionId ?? ''),
    queryFn: () => api.getSectionReport(sectionId!).then((r) => r.data),
    enabled: Boolean(sectionId),
  });

  if (!ready) return <FullPageSpinner />;

  const navItems = [
    { id: 'overview', label: 'نظرة عامة', icon: TrendingUp },
    { id: 'students', label: 'قائمة الطالبات', icon: Users },
    { id: 'attendance', label: 'الحضور', icon: CalendarCheck },
    { id: 'speedgrader', label: 'التسميع والتقييم', icon: Mic },
    { id: 'mutashabihat', label: 'المتشابهات', icon: Target },
    { id: 'cases', label: 'بحاجة متابعة', icon: AlertCircle },
    { id: 'assessments', label: 'التقييمات', icon: BookOpen },
    { id: 'reports', label: 'تقارير الجودة', icon: Trophy },
    { id: 'account', label: 'حسابي', icon: UserRound },
    { id: 'help', label: 'الدعم الفني', icon: LifeBuoy },
  ];

  const students = studentsQuery.data?.students ?? [];
  const openRow = students.find((s) => s.studentId === openStudent) ?? null;

  const body = () => {
    if (sectionsQuery.isLoading) return <Spinner />;
    if (sectionsQuery.isError) return <LoadError onRetry={() => sectionsQuery.refetch()} />;
    if (!section) {
      return (
        <Card><CardContent className="py-10 text-center text-text-secondary">
          لا توجد حلقات مسندة إليكِ بعد. تواصلي مع إدارة الكلية لإضافة حلقتك.
        </CardContent></Card>
      );
    }
    if (['overview', 'students', 'cases'].includes(activeTab)) {
      if (studentsQuery.isLoading) return <Spinner />;
      if (studentsQuery.isError) return <LoadError onRetry={() => studentsQuery.refetch()} />;
    }

    switch (activeTab) {
      case 'overview':
        return (
          <OverviewTab
            summary={studentsQuery.data!.summary}
            pendingReviews={reportQuery.data?.pendingReviews ?? 0}
            atRisk={students.filter((s) => s.atRisk)}
            onOpenStudent={(id) => { setOpenStudent(id); setActiveTab('students'); }}
            onGo={setActiveTab}
          />
        );
      case 'students':
        return <StudentsTab students={students} onOpen={setOpenStudent} />;
      case 'attendance':
        return <AttendanceTab sectionId={section.id} />;
      case 'speedgrader':
        return (
          <div className="space-y-4">
            {['dean', 'advisor', 'operator', 'superadmin'].includes(user?.role ?? '') && <AiCheckingSwitch />}
            <SpeedGraderTab sectionId={section.id} />
          </div>
        );
      case 'mutashabihat':
        return <MutashabihatAuthoring role={user?.role ?? ''} />;
      case 'cases':
        return <CasesTab students={students.filter((s) => s.atRisk)} onOpen={(id) => { setOpenStudent(id); setActiveTab('students'); }} />;
      case 'assessments':
        return (
          <>
            <PreviewNotice>جدولة التقييمات تصل في مرحلة قادمة.</PreviewNotice>
            <Card><CardContent className="py-8 text-center text-text-secondary">لا توجد تقييمات مجدولة.</CardContent></Card>
          </>
        );
      case 'reports':
        return (
          <>
            <PreviewNotice>تقارير الجودة على مستوى الكلية تصل في مرحلة قادمة. التقرير الأسبوعي لكل طالبة متاح من «قائمة الطالبات».</PreviewNotice>
          </>
        );
      case 'account':
        return <AccountPanel />;
      case 'help':
        return <HelpTickets />;
    }
  };

  return (
    <AppShell
      items={navItems}
      activeId={activeTab}
      onSelect={(id) => setActiveTab(id as TeacherTab)}
      homeHref="/dashboard/teacher"
      userInitials={user?.displayNameAr?.replace(/^أ\.\s*/, '').slice(0, 2) || 'م'}
      trailing={section ? <SectionCard name={section.nameAr} joinCode={section.joinCode} /> : null}
    >
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <p className="text-sm text-text-secondary">مرحباً {user?.displayNameAr}</p>
          <h1 className="font-heading text-2xl font-bold text-text-primary">{section?.nameAr ?? 'لوحة المعلمة'}</h1>
        </div>
        {(sectionsQuery.data?.length ?? 0) > 1 && (
          <label className="text-sm flex items-center gap-2">
            <span className="text-text-secondary">الحلقة</span>
            <select
              id="section-picker"
              className="rounded-xl border border-divider bg-surface-elevated px-3 py-2"
              value={sectionId ?? ''}
              onChange={(e) => { setSectionId(e.target.value); setOpenStudent(null); }}
            >
              {sectionsQuery.data!.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
            </select>
          </label>
        )}
      </div>

      {body()}

      {openRow && section && (
        <StudentDrawer sectionId={section.id} student={openRow} onClose={() => setOpenStudent(null)} />
      )}
    </AppShell>
  );
}

function SectionCard({ name, joinCode }: { name: string; joinCode?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the code is still visible to copy by hand.
    }
  };
  return (
    <div className="mt-4 p-3 rounded-2xl bg-surface-canvas border border-divider text-sm space-y-1">
      <p className="font-medium text-brand-primary">{name}</p>
      {joinCode && (
        <button type="button" onClick={copy} className="flex items-center gap-1.5 text-text-secondary hover:text-brand-primary" title="نسخ كود الانضمام">
          كود الانضمام: <span className="font-mono font-bold" dir="ltr">{joinCode}</span>
          {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-state-positive" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card variant="metric">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-text-secondary">{label}</p>
          <p className="mt-1 text-2xl font-bold text-text-primary tabular-nums">{value}</p>
        </div>
        <div className="text-brand-primary">{icon}</div>
      </div>
    </Card>
  );
}

function OverviewTab({ summary, pendingReviews, atRisk, onOpenStudent, onGo }: {
  summary: { totalStudents: number; activeToday: number; atRisk: number; avgMastery: number };
  pendingReviews: number;
  atRisk: StudentSummary[];
  onOpenStudent: (id: string) => void;
  onGo: (tab: TeacherTab) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard label="إجمالي الطالبات" value={toArabicDigits(summary.totalStudents)} icon={<Users className="w-5 h-5" />} />
        <MetricCard label="راجعن اليوم" value={toArabicDigits(summary.activeToday)} icon={<BookOpen className="w-5 h-5" />} />
        <MetricCard label="بحاجة متابعة" value={toArabicDigits(summary.atRisk)} icon={<AlertCircle className="w-5 h-5" />} />
        <MetricCard label="تسميع بانتظار التقييم" value={toArabicDigits(pendingReviews)} icon={<Mic className="w-5 h-5" />} />
        <MetricCard label="متوسط الآيات المثبّتة" value={`${toArabicDigits(summary.avgMastery)}٪`} icon={<TrendingUp className="w-5 h-5" />} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>بحاجة متابعة</CardTitle></CardHeader>
          <CardContent>
            {atRisk.length === 0 ? (
              <p className="text-sm text-text-secondary">لا توجد طالبات بحاجة متابعة الآن.</p>
            ) : (
              <div className="space-y-2">
                {atRisk.slice(0, 5).map((s) => (
                  <div key={s.studentId} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-canvas border border-divider">
                    <div className="min-w-0">
                      <p className="font-medium text-text-primary">{s.displayNameAr}</p>
                      <p className="text-sm text-text-secondary">{riskLabel(s.riskReasons, s)}</p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => onOpenStudent(s.studentId)}>التقرير</Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>إجراءات سريعة</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Button className="w-full justify-start gap-3" variant="secondary" onClick={() => onGo('attendance')}>
              <CalendarCheck className="w-4 h-4" /> تسجيل حضور اليوم
            </Button>
            <Button className="w-full justify-start gap-3" variant="secondary" onClick={() => onGo('speedgrader')}>
              <Mic className="w-4 h-4" /> تقييم التسميع المعلّق ({toArabicDigits(pendingReviews)})
            </Button>
            <Button className="w-full justify-start gap-3" variant="secondary" onClick={() => onGo('students')}>
              <Users className="w-4 h-4" /> قائمة الطالبات والتقارير
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StudentsTab({ students, onOpen }: { students: StudentSummary[]; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const filtered = students.filter((s) => s.displayNameAr.includes(search.trim()));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>قائمة الطالبات ({toArabicDigits(students.length)})</CardTitle>
          <div className="w-full sm:w-64">
            <Input id="student-search" placeholder="ابحثي بالاسم" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {students.length === 0 ? (
          <p className="text-sm text-text-secondary">لم تنضم أي طالبة بعد. شاركي كود الانضمام الظاهر في القائمة الجانبية.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-divider">
            <table className="w-full text-sm">
              <thead className="bg-surface-canvas">
                <tr>
                  {['الطالبة', 'الآيات المثبّتة', 'مستحقة', 'آخر مراجعة', 'الحضور (٣٠ يوماً)', 'السلسلة', 'الحالة', ''].map((h) => (
                    <th key={h} className="text-right py-2 px-3 font-medium text-text-secondary whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.studentId} className="border-t border-divider">
                    <td className="py-2 px-3 font-medium text-text-primary whitespace-nowrap">{s.displayNameAr}</td>
                    <td className="py-2 px-3 tabular-nums">{toArabicDigits(s.masteryPercent)}٪</td>
                    <td className="py-2 px-3 tabular-nums">{toArabicDigits(s.cardsDue)}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{lastActiveLabel(s)}</td>
                    <td className="py-2 px-3 tabular-nums">{s.attendanceRate === null ? '—' : `${toArabicDigits(Math.round(s.attendanceRate * 100))}٪`}</td>
                    <td className="py-2 px-3 tabular-nums">{toArabicDigits(s.currentStreak)}</td>
                    <td className="py-2 px-3">
                      {s.atRisk ? <Badge variant="red" size="sm">بحاجة متابعة</Badge> : <Badge variant="green" size="sm">منتظمة</Badge>}
                    </td>
                    <td className="py-2 px-3">
                      <Button size="sm" variant="ghost" onClick={() => onOpen(s.studentId)}>التقرير</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CasesTab({ students, onOpen }: { students: StudentSummary[]; onOpen: (id: string) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle>طالبات بحاجة متابعة ({toArabicDigits(students.length)})</CardTitle></CardHeader>
      <CardContent>
        <p className="text-sm text-text-secondary mb-3">
          تظهر الطالبة هنا إذا لم تراجع منذ ٣ أيام أو أكثر، أو إذا قلّ حضورها عن ٧٠٪ في آخر ٣٠ يوماً.
        </p>
        {students.length === 0 ? (
          <p className="text-sm text-text-secondary">لا توجد حالات الآن.</p>
        ) : (
          <div className="space-y-2">
            {students.map((s) => (
              <div key={s.studentId} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-canvas border border-divider flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">{s.displayNameAr}</p>
                  <p className="text-sm text-text-secondary">{riskLabel(s.riskReasons, s)}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => onOpen(s.studentId)}>التقرير وولي الأمر</Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttendanceTab({ sectionId }: { sectionId: string }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayLocal());
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const dayQuery = useQuery({
    queryKey: queryKeys.attendance(sectionId, date),
    queryFn: () => api.getAttendance(sectionId, date).then((r) => r.data),
  });

  useEffect(() => {
    if (!dayQuery.data) return;
    // Unmarked students default to present; the teacher only taps the absent ones.
    setMarks(Object.fromEntries(dayQuery.data.records.map((r) => [r.studentId, r.present ?? true])));
  }, [dayQuery.data]);

  // A saved-confirmation belongs to the day it was saved for.
  useEffect(() => setStatus(null), [date]);

  const save = useMutation({
    mutationFn: (day: AttendanceDay) => api.saveAttendance(
      sectionId, day.date, day.records.map((r) => ({ studentId: r.studentId, present: marks[r.studentId] ?? true })),
    ).then((r) => r.data),
    onSuccess: (res) => {
      const parts = [`حُفظ حضور ${toArabicDigits(res.saved)} طالبات.`];
      if (res.alerts.sent) parts.push(`أُرسل تنبيه غياب إلى ${toArabicDigits(res.alerts.sent)} من أولياء الأمور.`);
      if (res.alerts.noGuardian) parts.push(`${toArabicDigits(res.alerts.noGuardian)} غائبة بلا ولي أمر مسجّل.`);
      if (res.alerts.failed) parts.push(`تعذّر إرسال ${toArabicDigits(res.alerts.failed)} تنبيه عبر واتساب.`);
      if (res.alerts.skipped) parts.push(`وصل ${toArabicDigits(res.alerts.skipped)} تنبيه إلى بوابة ولي الأمر فقط لأن إرسال واتساب غير مفعّل.`);
      setStatus({ kind: 'ok', text: parts.join(' ') });
      queryClient.invalidateQueries({ queryKey: ['sections', sectionId] });
    },
    onError: (err) => setStatus({ kind: 'error', text: errorMessage(err, 'لم يُحفظ الحضور. حاولي مرة أخرى.') }),
  });

  const absentCount = Object.values(marks).filter((p) => !p).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>تسجيل الحضور</CardTitle>
          <label className="text-sm flex items-center gap-2">
            <span className="text-text-secondary">اليوم</span>
            <input
              id="attendance-date"
              type="date"
              value={date}
              max={todayLocal()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="rounded-xl border border-divider bg-surface-elevated px-3 py-2"
            />
          </label>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {dayQuery.isLoading ? <Spinner /> : dayQuery.isError || !dayQuery.data ? (
          <LoadError onRetry={() => dayQuery.refetch()} />
        ) : dayQuery.data.records.length === 0 ? (
          <p className="text-sm text-text-secondary">لا توجد طالبات في الحلقة بعد.</p>
        ) : (
          <>
            <p className="text-sm text-text-secondary">
              اضغطي على اسم الطالبة الغائبة. يصل لولي أمرها تنبيه واتساب عند الحفظ، مرة واحدة لكل يوم.
            </p>
            <ul className="grid sm:grid-cols-2 gap-2">
              {dayQuery.data.records.map((r) => {
                const present = marks[r.studentId] ?? true;
                return (
                  <li key={r.studentId}>
                    <button
                      type="button"
                      aria-pressed={!present}
                      onClick={() => setMarks((m) => ({ ...m, [r.studentId]: !present }))}
                      className={`w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-right transition-colors ${
                        present
                          ? 'border-divider bg-surface-elevated hover:border-brand-primary/40'
                          : 'border-state-danger/40 bg-state-danger/5'
                      }`}
                    >
                      <span className="font-medium text-text-primary">{r.displayNameAr}</span>
                      {present
                        ? <span className="text-sm text-state-positive">حاضرة</span>
                        : <span className="text-sm text-state-danger font-medium">غائبة</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            {status && (
              <p role="status" className={`text-sm rounded-lg px-3 py-2 ${status.kind === 'ok' ? 'bg-state-positive/10 text-state-positive' : 'bg-red-50 text-red-800'}`}>
                {status.text}
              </p>
            )}
            <Button onClick={() => save.mutate(dayQuery.data!)} loading={save.isPending} className="w-full sm:w-auto">
              حفظ الحضور ({toArabicDigits(absentCount)} غائبة)
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SpeedGraderTab({ sectionId }: { sectionId: string }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pendingQuery = useQuery({
    queryKey: queryKeys.pendingTasmi(sectionId),
    queryFn: () => api.getPendingTasmi(sectionId).then((r) => r.data),
  });
  const pending = useMemo(() => pendingQuery.data ?? [], [pendingQuery.data]);
  const selected = pending.find((p) => p.id === selectedId) ?? pending[0] ?? null;

  if (pendingQuery.isLoading) return <Spinner />;
  if (pendingQuery.isError) return <LoadError onRetry={() => pendingQuery.refetch()} />;
  if (pending.length === 0) {
    return (
      <Card><CardContent className="py-10 text-center space-y-2">
        <CheckCircle2 className="w-10 h-10 text-state-positive mx-auto" />
        <p className="text-text-secondary">لا يوجد تسميع بانتظار التقييم.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-1">
        <CardHeader><CardTitle>بانتظار التقييم ({toArabicDigits(pending.length)})</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {pending.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full text-right p-3 rounded-lg border ${selected?.id === p.id ? 'border-brand-primary bg-brand-primary/5' : 'border-divider bg-surface-canvas'}`}
                >
                  <p className="font-medium text-text-primary">{p.studentName}</p>
                  <p className="text-sm text-text-secondary">{formatAyahRange(p.startRef, p.endRef)}</p>
                  {(p.disputedCount ?? 0) > 0 && (
                    <Badge className="mt-1 bg-amber-50 text-amber-900">اعتراض على الفحص الآلي</Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {selected && (
        <ReviewForm
          key={selected.id}
          submission={selected}
          onDone={() => {
            setSelectedId(null);
            queryClient.invalidateQueries({ queryKey: ['tasmi'] });
            queryClient.invalidateQueries({ queryKey: queryKeys.sectionReport(sectionId) });
          }}
        />
      )}
    </div>
  );
}

const VERDICT_OPTIONS: { value: TasmiReviewInput['verdict']; label: string }[] = [
  { value: 'approved', label: 'مقبول' },
  { value: 'redo', label: 'يُعاد التسميع' },
  { value: 'flagged', label: 'بحاجة مراجعة الشيخة' },
];

function ReviewForm({ submission, onDone }: { submission: TasmiSubmission; onDone: () => void }) {
  const [scores, setScores] = useState({ hifz: 90, tajweed: 85, fluency: 85 });
  const [verdict, setVerdict] = useState<TasmiReviewInput['verdict']>('approved');
  const [notes, setNotes] = useState('');
  const [decisions, setDecisions] = useState<Record<string, 'confirmed' | 'dismissed'>>({});
  const weighted = Math.round(scores.hifz * 0.5 + scores.tajweed * 0.3 + scores.fluency * 0.2);

  const submit = useMutation({
    mutationFn: () => api.reviewTasmi(submission.id, {
      hifzScore: scores.hifz, tajweedScore: scores.tajweed, fluencyScore: scores.fluency, verdict,
      notes: notes.trim() || undefined,
      flagDecisions: Object.keys(decisions).length ? decisions : undefined,
    }),
    onSuccess: onDone,
  });

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>{submission.studentName} — {formatAyahRange(submission.startRef, submission.endRef)}</CardTitle>
        <p className="text-sm text-text-secondary">
          أُرسل {new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(submission.submittedAt))}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <AiPanel submission={submission} decisions={decisions} onDecide={(id, d) => setDecisions((c) => ({ ...c, [id]: d }))} />

        <TasmiAudio id={submission.id} hasAudio={submission.hasAudio} />

        <RubricSlider id="score-hifz" label="الحفظ" weight="٥٠٪" value={scores.hifz} onChange={(v) => setScores((s) => ({ ...s, hifz: v }))} />
        <RubricSlider id="score-tajweed" label="التجويد" weight="٣٠٪" value={scores.tajweed} onChange={(v) => setScores((s) => ({ ...s, tajweed: v }))} />
        <RubricSlider id="score-fluency" label="الطلاقة" weight="٢٠٪" value={scores.fluency} onChange={(v) => setScores((s) => ({ ...s, fluency: v }))} />

        <p className="text-sm">الدرجة الموزونة: <b className="tabular-nums text-brand-primary">{toArabicDigits(weighted)}</b> / ١٠٠</p>

        <fieldset className="flex gap-2 flex-wrap">
          <legend className="text-sm font-medium text-text-primary mb-2">القرار</legend>
          {VERDICT_OPTIONS.map((v) => (
            <label key={v.value} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${verdict === v.value ? 'border-brand-primary bg-brand-primary/5 text-brand-primary' : 'border-divider'}`}>
              <input type="radio" name="verdict" value={v.value} checked={verdict === v.value} onChange={() => setVerdict(v.value)} className="sr-only" />
              {v.label}
            </label>
          ))}
        </fieldset>

        <label className="block text-sm">
          <span className="font-medium text-text-primary">ملاحظات للطالبة (اختياري)</span>
          <textarea
            id="review-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border border-divider bg-surface-elevated px-3 py-2"
          />
        </label>

        {submit.isError && (
          <p role="alert" className="text-sm rounded-lg px-3 py-2 bg-red-50 text-red-800">{errorMessage(submit.error, 'لم يُحفظ التقييم.')}</p>
        )}
        <Button onClick={() => submit.mutate()} loading={submit.isPending}>اعتماد التقييم</Button>
      </CardContent>
    </Card>
  );
}

/** The automatic check's first look at a recitation (never a grade), with the verses marked. */
function AiPanel({ submission, decisions, onDecide }: {
  submission: TasmiSubmission;
  decisions: Record<string, 'confirmed' | 'dismissed'>;
  onDecide: (flagId: string, decision: 'confirmed' | 'dismissed') => void;
}) {
  const { aiStatus, aiFlaggedErrors: flags } = submission;
  const plain = (
    <div className="rounded-xl border border-divider bg-surface-canvas p-4 max-h-56 overflow-y-auto">
      <VerseText start={submission.startRef} end={submission.endRef} />
    </div>
  );

  if (aiStatus === 'done') {
    return (
      <section className="space-y-3" aria-label="الفحص الآلي">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <Badge>فحص آلي أولي</Badge>
          <span>نسبة الكلمات المطابقة: <b className="tabular-nums">{toArabicDigits(Math.round(submission.aiHifzAccuracy ?? 0))}٪</b></span>
          <span className="text-text-secondary">
            {flags.length === 0 ? '— لم تُرصد ملاحظات.' : `— ${toArabicDigits(flags.length)} ملاحظة تحتاج نظرك.`}
          </span>
        </div>
        <FlaggedVerse start={submission.startRef} end={submission.endRef} flags={flags} decisions={decisions} onDecide={onDecide} />
        <p className="text-xs text-text-secondary">العلامات مؤشر أولي وقد تُخطئ، خاصة في التجويد. استمعي للتسجيل، فالقرار والدرجة لكِ.</p>
      </section>
    );
  }

  const note = aiStatus === 'pending' || aiStatus === 'processing' ? 'الفحص الآلي جارٍ، وقد تظهر العلامات بعد قليل.'
    : aiStatus === 'unclear' ? 'لم يُسمع التسجيل بوضوح كافٍ للفحص الآلي. استمعي إليه مباشرة.'
      : aiStatus === 'failed' ? 'تعذّر الفحص الآلي لهذا التسجيل. راجعيه يدوياً.'
        : null;
  return (
    <section className="space-y-2" aria-label="الفحص الآلي">
      {note && <p role="note" className="text-sm rounded-lg px-3 py-2 bg-amber-50 text-amber-900">{note}</p>}
      {plain}
    </section>
  );
}

function RubricSlider({ id, label, weight, value, onChange }: {
  id: string; label: string; weight: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={id} className="text-sm font-medium text-text-primary">{label} ({weight})</label>
        <span className="text-sm font-bold text-brand-primary tabular-nums">{toArabicDigits(value)}٪</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-surface-canvas rounded-full appearance-none cursor-pointer accent-brand-primary"
      />
    </div>
  );
}

function StudentDrawer({ sectionId, student, onClose }: { sectionId: string; student: StudentSummary; onClose: () => void }) {
  const queryClient = useQueryClient();
  const reportQuery = useQuery({
    queryKey: ['weekly', student.studentId],
    queryFn: () => api.getWeeklyReport(student.studentId).then((r) => r.data),
  });
  const guardiansQuery = useQuery({
    queryKey: queryKeys.guardians(sectionId, student.studentId),
    queryFn: () => api.getGuardians(sectionId, student.studentId).then((r) => r.data),
  });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const addGuardian = useMutation({
    mutationFn: () => api.addGuardian(sectionId, student.studentId, { displayNameAr: name.trim(), whatsapp: normalizePhone(phone) }),
    onSuccess: () => {
      setName('');
      setPhone('');
      queryClient.invalidateQueries({ queryKey: queryKeys.guardians(sectionId, student.studentId) });
    },
  });

  return (
    <div className="fixed inset-0 z-40 flex justify-start bg-black/30" role="dialog" aria-modal="true" aria-label={`تقرير ${student.displayNameAr}`} onClick={onClose}>
      <div
        className="h-full w-full max-w-2xl overflow-y-auto bg-surface-canvas p-4 sm:p-6 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold text-text-primary">التقرير الأسبوعي</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-surface-elevated" aria-label="إغلاق">
            <X className="w-5 h-5" />
          </button>
        </div>

        {reportQuery.isLoading ? <Spinner /> : reportQuery.data ? <WeeklyReportView report={reportQuery.data} /> : <LoadError onRetry={() => reportQuery.refetch()} />}

        <Card>
          <CardHeader><CardTitle>أولياء الأمور</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {guardiansQuery.data?.length ? (
              <ul className="divide-y divide-divider text-sm">
                {guardiansQuery.data.map((g) => (
                  <li key={g.id} className="py-2 flex justify-between gap-3">
                    <span className="font-medium">{g.displayNameAr}</span>
                    <span dir="ltr" className="text-text-secondary">{g.whatsappE164}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-secondary">لا يوجد ولي أمر مسجّل. أضيفيه ليصله تنبيه الغياب والتقرير الأسبوعي.</p>
            )}
            <form
              className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end"
              onSubmit={(e) => { e.preventDefault(); addGuardian.mutate(); }}
            >
              <Input id="guardian-name" label="الاسم" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
              <Input id="guardian-phone" label="رقم الواتساب" type="tel" dir="ltr" placeholder="010 1234 5678" value={phone} onChange={(e) => setPhone(e.target.value)} required />
              <Button type="submit" loading={addGuardian.isPending}><UserPlus className="w-4 h-4 ml-1" /> إضافة</Button>
            </form>
            {addGuardian.isError && (
              <p role="alert" className="text-sm text-red-800">{errorMessage(addGuardian.error, 'تعذّرت إضافة ولي الأمر. تحققي من الرقم.')}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
