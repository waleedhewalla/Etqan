'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@itqan/ui';
import { Bell, LogOut, Printer, Shield } from 'lucide-react';
import { useAuth, useRequireRole } from '@/lib/auth-context';
import { api, queryKeys } from '@/lib/api';
import { FullPageSpinner, LoadError, Spinner } from '@/components/LoadState';
import { WeeklyReportView } from '@/components/WeeklyReportView';

export default function GuardianDashboard() {
  const { user, ready } = useRequireRole(['mahram']);
  const { logout } = useAuth();
  const router = useRouter();
  const [selected, setSelected] = useState(0);

  const studentsQuery = useQuery({
    queryKey: queryKeys.guardianStudents,
    queryFn: () => api.getGuardianStudents().then((r) => r.data.students),
    enabled: ready,
  });
  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => api.getNotifications().then((r) => r.data),
    enabled: ready,
  });

  if (!ready) return <FullPageSpinner />;

  const students = studentsQuery.data ?? [];
  const report = students[selected] ?? students[0];
  const notifications = notificationsQuery.data ?? [];

  const signOut = async () => {
    await logout();
    router.replace('/');
  };

  return (
    <div className="min-h-screen bg-surface-canvas" dir="rtl">
      <header className="sticky top-0 z-40 bg-surface-elevated/95 border-b border-divider backdrop-blur-sm print:hidden">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 sm:px-6 h-14 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-brand-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-brand-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="font-heading text-lg font-bold text-text-primary">بوابة ولي الأمر</h1>
              <p className="text-xs text-text-secondary truncate">{user?.displayNameAr}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="w-4 h-4 ml-1" /> خروج
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {studentsQuery.isLoading ? <Spinner /> : studentsQuery.isError ? (
          <LoadError onRetry={() => studentsQuery.refetch()} />
        ) : students.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-text-secondary">
            لم يُربط حسابك بأي طالبة بعد. تواصل مع معلمة الحلقة لإضافة رقمك.
          </CardContent></Card>
        ) : (
          <>
            {students.length > 1 && (
              <div className="flex gap-2 flex-wrap print:hidden" role="tablist" aria-label="الطالبات">
                {students.map((s, i) => (
                  <button
                    key={s.student.id}
                    type="button"
                    role="tab"
                    aria-selected={i === selected}
                    onClick={() => setSelected(i)}
                    className={`rounded-full border px-4 py-1.5 text-sm ${i === selected ? 'border-brand-primary bg-brand-primary text-white' : 'border-divider bg-surface-elevated'}`}
                  >
                    {s.student.displayNameAr}
                  </button>
                ))}
              </div>
            )}

            <div className="flex justify-end print:hidden">
              <Button variant="secondary" size="sm" onClick={() => window.print()}>
                <Printer className="w-4 h-4 ml-1" /> طباعة التقرير
              </Button>
            </div>

            {report && <WeeklyReportView report={report} />}
          </>
        )}

        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" /> التنبيهات</CardTitle>
          </CardHeader>
          <CardContent>
            {notifications.length === 0 ? (
              <p className="text-sm text-text-secondary">لا توجد تنبيهات.</p>
            ) : (
              <ul className="divide-y divide-divider text-sm">
                {notifications.slice(0, 10).map((n) => (
                  <li key={n.id} className="py-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-text-primary">{n.titleAr}</p>
                      <p className="text-text-secondary">{n.bodyAr}</p>
                    </div>
                    <span className="flex flex-col items-end gap-1 text-xs text-text-muted whitespace-nowrap">
                      {new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date(n.sentAt))}
                      {!n.readAt && <Badge variant="info" size="sm">جديد</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
