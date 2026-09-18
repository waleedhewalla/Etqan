'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Input } from '@itqan/ui';
import { Users, AlertCircle, TrendingUp, BookOpen, Clock, Trophy, LifeBuoy, UserRound } from 'lucide-react';
import { formatRelativeTime } from '@itqan/ui';
import { AppShell } from '@/components/AppShell';
import { HelpTickets } from '@/components/HelpTickets';
import { AccountPanel } from '@/components/AccountPanel';

export default function TeacherDashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'cases' | 'assessments' | 'reports' | 'account' | 'help'>('overview');
  const [searchQuery, setSearchQuery] = useState('');

  // Mock data
  const sectionStats = {
    totalStudents: 42,
    activeToday: 31,
    atRisk: 5,
    pendingReviews: 8,
    avgMastery: 67,
  };

  const students = [
    { id: '1', name: 'فاطمة أحمد', avatar: null, status: 'active' as const, mastery: 78, streak: 14, lastActive: 'منذ ساعتين', risk: 'low' as const },
    { id: '2', name: 'عائشة محمد', avatar: null, status: 'at-risk' as const, mastery: 45, streak: 2, lastActive: 'منذ 3 أيام', risk: 'high' as const },
    { id: '3', name: 'مريم علي', avatar: null, status: 'active' as const, mastery: 92, streak: 28, lastActive: 'منذ 30 دقيقة', risk: 'low' as const },
    { id: '4', name: 'خديجة حسن', avatar: null, status: 'excused' as const, mastery: 61, streak: 0, lastActive: 'منذ أسبوع', risk: 'medium' as const },
    { id: '5', name: 'زينب عمر', avatar: null, status: 'active' as const, mastery: 73, streak: 11, lastActive: 'منذ ساعة', risk: 'low' as const },
  ];

  const cases = [
    { id: '1', student: 'عائشة محمد', type: 'absence', severity: 'medium', opened: 'منذ يومين', status: 'triaged' },
    { id: '2', student: 'خديجة حسن', type: 'mastery_drop', severity: 'high', opened: 'منذ ٥ أيام', status: 'in_progress' },
    { id: '3', student: 'سمية خالد', type: 'mutashabihat', severity: 'low', opened: 'منذ يوم', status: 'new' },
  ];

  const upcomingAssessments = [
    { title: 'اختبار أسبوعي - الأسبوع ٣', date: 'غداً', type: 'quiz', students: 42 },
    { title: 'تسميع تجريبي - منتصف الفصل', date: 'بعد ٥ أيام', type: 'mock_sama', students: 42 },
    { title: 'اختبار المتشابهات الشهري', date: 'بعد ١٠ أيام', type: 'mutashabihat_challenge', students: 42 },
  ];

  return (
    <AppShell
      items={[
        { id: 'overview', label: 'نظرة عامة', icon: TrendingUp },
        { id: 'students', label: 'قائمة الطالبات', icon: Users },
        { id: 'cases', label: 'الحالات المفتوحة', icon: AlertCircle },
        { id: 'assessments', label: 'التقييمات', icon: BookOpen },
        { id: 'reports', label: 'تقارير الجودة', icon: Trophy },
        { id: 'account', label: 'حسابي', icon: UserRound },
        { id: 'help', label: 'الدعم الفني', icon: LifeBuoy },
      ]}
      activeId={activeTab}
      onSelect={(id) => setActiveTab(id as typeof activeTab)}
      homeHref="/dashboard/teacher"
      userInitials="أ.ف"
      trailing={
        <div className="mt-4 p-3 rounded-2xl bg-surface-canvas border border-divider text-sm flex items-center gap-2">
          <Clock className="w-4 h-4 text-brand-primary" />
          <span className="font-medium text-brand-primary">شعبة: ٢٠٢٦-أ</span>
        </div>
      }
    >
      {activeTab === 'overview' && <OverviewTab stats={sectionStats} upcoming={upcomingAssessments} cases={cases} />}
      {activeTab === 'students' && <StudentsTab students={students} searchQuery={searchQuery} setSearchQuery={setSearchQuery} />}
      {activeTab === 'cases' && <CasesTab cases={cases} />}
      {activeTab === 'assessments' && <AssessmentsTab upcoming={upcomingAssessments} />}
      {activeTab === 'reports' && <ReportsTab />}
      {activeTab === 'account' && <AccountPanel />}
      {activeTab === 'help' && <HelpTickets />}
    </AppShell>
  );
}

function OverviewTab({ stats, upcoming, cases }: any) {
  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard label="إجمالي الطالبات" value={stats.totalStudents} icon={<Users className="w-5 h-5" />} />
        <MetricCard label="نشطات اليوم" value={stats.activeToday} icon={<BookOpen className="w-5 h-5" />} trend={{ value: 3, label: 'عن أمس' }} variant="positive" />
        <MetricCard label="بحاجة متابعة" value={stats.atRisk} icon={<AlertCircle className="w-5 h-5" />} trend={{ value: -1, label: 'تحسن' }} variant="negative" />
        <MetricCard label="مراجعات معلقة" value={stats.pendingReviews} icon={<BookOpen className="w-5 h-5" />} variant="info" />
        <MetricCard label="متوسط الإتقان" value={`${stats.avgMastery}%`} icon={<TrendingUp className="w-5 h-5" />} trend={{ value: 5, label: 'هذا الشهر' }} variant="positive" />
      </div>

      {/* ARI Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>توزيع مؤشر المخاطر الأكاديمية (ARI)</span>
            <Badge variant="info">محدث قبل ١٥ دقيقة</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: 'أخضر', range: '٠-٠.٢', count: 22, color: 'text-state-positive', bg: 'bg-state-positive/10' },
              { label: 'أصفر', range: '٠.٢-٠.٤', count: 12, color: 'text-state-attention', bg: 'bg-state-attention/10' },
              { label: 'برتقالي', range: '٠.٤-٠.٦٥', count: 5, color: 'text-state-attention', bg: 'bg-state-attention/10' },
              { label: 'أحمر', range: '٠.٦٥-٠.٨٥', count: 2, color: 'text-state-danger', bg: 'bg-state-danger/10' },
              { label: 'حرج', range: '٠.٨٥-١', count: 1, color: 'text-state-danger', bg: 'bg-state-danger/10' },
            ].map((band, i) => (
              <div key={i} className="p-4 rounded-lg bg-surface-canvas border border-divider text-center">
                <div className={`text-2xl font-bold ${band.color}`}>{band.count}</div>
                <div className="text-sm font-medium text-text-primary mt-1">{band.label}</div>
                <div className="text-xs text-text-muted">{band.range}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>الحالات المعلقة للمراجعة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {cases.slice(0, 3).map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-canvas border border-divider">
                  <div>
                    <p className="font-medium text-text-primary">{c.student}</p>
                    <p className="text-sm text-text-secondary">{c.type} • {c.opened}</p>
                  </div>
                  <Button size="sm" variant="secondary">مراجعة</Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>التقييمات القادمة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {upcoming.map(a => (
                <div key={a.title} className="flex items-center justify-between p-3 rounded-lg bg-surface-canvas border border-divider">
                  <div>
                    <p className="font-medium text-text-primary">{a.title}</p>
                    <p className="text-sm text-text-secondary">{a.date} • {a.students} طالبة</p>
                  </div>
                  <Badge variant={a.type === 'mock_sama' ? 'gold' : a.type === 'mutashabihat_challenge' ? 'info' : 'green'} size="sm">
                    {a.type === 'mock_sama' ? 'تسميع تجريبي' : a.type === 'mutashabihat_challenge' ? 'متشابهات' : 'اختبار أسبوعي'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>إجراءات سريعة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Button className="w-full justify-start gap-3" variant="secondary"><span className="w-5 h-5">➕</span> رسالة تدخل لطالبات الخطر</Button>
              <Button className="w-full justify-start gap-3" variant="secondary"><span className="w-5 h-5">📅</span> جدولة اختبار أسبوعي</Button>
              <Button className="w-full justify-start gap-3" variant="secondary"><span className="w-5 h-5">📊</span> تصدير تقرير الشعبة</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StudentsTab({ students, searchQuery, setSearchQuery }: any) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <Input
          placeholder="ابحث بالاسم، الحالة، أو مستوى الإتقان..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>}
          className="w-full md:w-80"
        />
        <Button variant="secondary"><svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg> تصدير CSV</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-divider">
                  {['الطالبة', 'الحالة', 'الإتقان', 'السلسلة', 'آخر نشاط', 'المخاطر', 'إجراءات'].map(h => (
                    <th key={h} className="text-right py-2 px-3 font-medium text-text-secondary text-sm">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map(s => (
                  <tr key={s.id} className="border-b border-divider hover:bg-surface-canvas/50">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center text-brand-primary font-bold">
                          {s.name.slice(0,2)}
                        </div>
                        <span className="font-medium text-text-primary">{s.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge variant={s.status === 'active' ? 'green' : s.status === 'at-risk' ? 'amber' : s.status === 'excused' ? 'info' : 'neutral'}>
                        {s.status === 'active' ? 'نشطة' : s.status === 'at-risk' ? 'خطر' : 'معذورة'}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-text-primary">{s.mastery}%</td>
                    <td className="py-2.5 px-3">
                      <span className="flex items-center gap-1 text-sm text-text-secondary">
                        <svg className="w-4 h-4 text-brand-primary" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" /></svg>
                        {s.streak}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-sm text-text-secondary">{formatRelativeTime(s.lastActive)}</td>
                    <td className="py-2.5 px-3">
                      <Badge variant={s.risk === 'low' ? 'green' : s.risk === 'medium' ? 'amber' : 'red'} size="sm">
                        {s.risk === 'low' ? 'منخفض' : s.risk === 'medium' ? 'متوسط' : 'عالي'}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" className="p-1.5"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg></Button>
                        <Button size="sm" variant="ghost" className="p-1.5"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CasesTab({ cases }: any) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>الحالات المفتوحة</span>
            <Badge variant="amber">{cases.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {cases.map(c => (
              <div key={c.id} className="p-4 rounded-lg border border-divider bg-surface-canvas">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-medium text-text-primary">{c.student}</span>
                      <Badge variant={c.severity === 'high' ? 'red' : c.severity === 'medium' ? 'amber' : 'green'} size="sm">
                        {c.severity === 'high' ? 'عالي' : c.severity === 'medium' ? 'متوسط' : 'منخفض'}
                      </Badge>
                      <Badge variant={c.status === 'new' ? 'info' : c.status === 'triaged' ? 'green' : 'amber'} size="sm">
                        {c.status === 'new' ? 'جديد' : c.status === 'triaged' ? 'قيد المراجعة' : 'قيد التنفيذ'}
                      </Badge>
                    </div>
                    <p className="text-sm text-text-secondary">{c.type === 'absence' ? 'غياب متكرر' : c.type === 'mastery_drop' ? 'تراجع في الإتقان' : 'ارتباك متشابهات'} • {c.opened}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary">فتح الحالة</Button>
                    <Button size="sm" variant="ghost"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AssessmentsTab({ upcoming }: any) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>التقييمات المجدولة</span>
            <Button variant="secondary" size="sm"><svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg> جدولة جديد</Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {upcoming.map(a => (
              <div key={a.title} className="p-4 rounded-lg border border-divider bg-surface-canvas">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="font-medium text-text-primary">{a.title}</p>
                    <p className="text-sm text-text-secondary mt-1">{a.date} • {a.students} طالبة</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={a.type === 'mock_sama' ? 'gold' : a.type === 'mutashabihat_challenge' ? 'info' : 'green'} size="sm">
                      {a.type === 'mock_sama' ? 'تسميع تجريبي' : a.type === 'mutashabihat_challenge' ? 'متشابهات' : 'اختبار أسبوعي'}
                    </Badge>
                    <Button size="sm" variant="ghost"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReportsTab() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>تقارير الجودة</span>
            <Button variant="secondary" size="sm">توليد تقرير</Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <Button variant="secondary" className="h-20 flex flex-col items-center justify-center gap-2">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <span className="font-medium">تقرير الشعبة الأسبوعي</span>
            </Button>
            <Button variant="secondary" className="h-20 flex flex-col items-center justify-center gap-2">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 002-2V5a2 2 0 012-2h2a2 2 0 002 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 002 2h2a2 2 0 012 2v6a2 2 0 002 2z" /></svg>
              <span className="font-medium">تقارير الإتقان</span>
            </Button>
            <Button variant="secondary" className="h-20 flex flex-col items-center justify-center gap-2">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
              <span className="font-medium">تقارير التدخل</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, value, icon, trend, variant = 'neutral' }: any) {
  return (
    <Card variant="metric">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-text-secondary">{label}</p>
          <p className="mt-1 text-2xl font-bold text-text-primary">{value}</p>
          {trend && (
            <div className="mt-1.5 flex items-center gap-1.5 text-sm">
              <span className={`font-medium ${variant === 'positive' ? 'text-state-positive' : variant === 'negative' ? 'text-state-danger' : 'text-text-secondary'}`}>
                {trend.value >= 0 ? '+' : ''}{trend.value}%
              </span>
              <span className="text-text-muted">{trend.label}</span>
            </div>
          )}
        </div>
        <div className="text-brand-primary">{icon}</div>
      </div>
    </Card>
  );
}