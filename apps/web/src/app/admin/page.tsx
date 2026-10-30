'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@itqan/ui';
import { AlertTriangle, BookOpen, Building2, CheckCircle2, Mic, Shield, TrendingUp, Users } from 'lucide-react';
import { useRequireRole } from '@/lib/auth-context';
import { api, queryKeys, type AtRiskStudent } from '@/lib/api';
import { toArabicDigits } from '@/lib/quran';
import { FullPageSpinner, LoadError, Spinner } from '@/components/LoadState';
import { EmptyState } from '@/components/EmptyState';

const ADMIN_ROLES = ['dean', 'advisor', 'operator', 'superadmin'] as const;

const PLAN_LABEL: Record<string, string> = {
  free: 'مجانية', madrasa_basic: 'مدرسة — أساسية', madrasa_pro: 'مدرسة — احترافية', enterprise: 'مؤسسات',
};
const FEATURE_LABEL: Record<string, string> = {
  ai_checking: 'الفحص الآلي للتسميع', analytics: 'تقارير وتحليلات', priority_support: 'دعم فني ذو أولوية',
};

const REASON_LABEL = {
  inactive: (s: AtRiskStudent) => s.inactiveDays === null ? 'لم تبدأ المراجعة بعد' : `لم تراجع منذ ${toArabicDigits(s.inactiveDays)} أيام`,
  attendance: (s: AtRiskStudent) => `حضورها ${toArabicDigits(Math.round((s.attendanceRate ?? 0) * 100))}٪ في آخر ٣٠ يوماً`,
};

const formatDate = (iso: string) => new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date(iso));

export default function AdminDashboard() {
  const { user, ready } = useRequireRole([...ADMIN_ROLES], '/auth/login/faculty');
  const isSuper = user?.role === 'superadmin';
  const [tenantId, setTenantId] = useState<string | undefined>(undefined);

  const tenants = useQuery({ queryKey: queryKeys.adminTenants, queryFn: () => api.getAdminTenants().then((r) => r.data), enabled: ready && isSuper });
  const overview = useQuery({
    queryKey: queryKeys.adminOverview(tenantId),
    queryFn: () => api.getAdminOverview(tenantId).then((r) => r.data),
    enabled: ready,
  });

  if (!ready) return <FullPageSpinner />;
  const data = overview.data;

  return (
    <div dir="rtl" className="min-h-screen bg-surface-canvas">
      <header className="bg-surface-elevated border-b border-divider sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-primary flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-text-inverse" />
            </div>
            <div>
              <h1 className="font-heading text-lg font-bold text-text-primary">لوحة الإدارة</h1>
              <p className="text-xs text-text-secondary">{user?.displayNameAr}</p>
            </div>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            {isSuper && (tenants.data?.length ?? 0) > 1 && (
              <select aria-label="المؤسسة" value={tenantId ?? data?.institution.id ?? ''} onChange={(e) => setTenantId(e.target.value)}
                className="rounded-xl border border-divider bg-surface-elevated px-3 py-2">
                {tenants.data!.map((t) => <option key={t.id} value={t.id}>{t.nameAr}</option>)}
              </select>
            )}
            <Link href="/dashboard/teacher" className="rounded-xl border border-divider px-3 py-2 hover:border-brand-primary/40">الحلقات والتسميع</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {overview.isLoading ? <Spinner /> : overview.isError || !data ? (
          <LoadError onRetry={() => overview.refetch()} />
        ) : (
          <>
            <section className="surface-card p-6 rounded-2xl flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-brand-primary/10 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-7 h-7 text-brand-primary" />
                </div>
                <div>
                  <h2 className="font-heading text-xl font-bold text-text-primary">{data.institution.nameAr}</h2>
                  {data.institution.domain && <p className="text-sm text-text-secondary mt-1">{data.institution.domain}</p>}
                </div>
              </div>
              <Badge variant={data.institution.active ? 'green' : 'gold'} size="sm">{data.institution.active ? 'مفعّلة' : 'متوقفة'}</Badge>
            </section>

            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-label="مؤشرات">
              <Stat icon={<Users className="w-5 h-5" />} label="الطالبات في الحلقات" value={toArabicDigits(data.usage.students)} note={`في ${toArabicDigits(data.usage.halaqat)} حلقة نشطة`} />
              <Stat icon={<BookOpen className="w-5 h-5" />} label="نشيطات هذا الأسبوع" value={toArabicDigits(data.activity.activeThisWeek)} note={`اليوم: ${toArabicDigits(data.activity.activeToday)}`} />
              <Stat icon={<TrendingUp className="w-5 h-5" />} label="مراجعات هذا الأسبوع" value={toArabicDigits(data.activity.reviewsThisWeek)} note={trend(data.activity.reviewsThisWeek, data.activity.reviewsLastWeek)} />
              <Stat icon={<Shield className="w-5 h-5" />} label="متوسط الإتقان" value={`${toArabicDigits(data.activity.avgMastery)}٪`} note="آيات ثابتة أو متقنة من خطط الطالبات" />
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-1">
                <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-brand-accent" />الترخيص</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">الخطة</span>
                    <Badge variant="gold" size="sm">{PLAN_LABEL[data.institution.plan.tier] ?? data.institution.plan.tier}</Badge>
                  </div>
                  {data.institution.plan.status.expired && (
                    <p role="alert" data-testid="plan-expired" className="text-sm rounded-lg px-3 py-2 bg-red-50 text-red-800">
                      انتهى ترخيص المؤسسة. {data.institution.plan.status.enforcement === 'block' ? 'لا يمكن إضافة طالبات أو حلقات جديدة، ويستمر تعلّم الطالبات الحاليات.' : 'جدّدوه لتفعيل الميزات المدفوعة.'}
                    </p>
                  )}
                  <Usage label="الطالبات" {...data.institution.plan.status.students} enforcement={data.institution.plan.status.enforcement} />
                  <Usage label="الحلقات" {...data.institution.plan.status.halaqat} enforcement={data.institution.plan.status.enforcement} />
                  {data.institution.plan.validUntil && (
                    <p className="text-sm text-text-secondary">{data.institution.plan.status.expired ? 'انتهت في' : 'سارية حتى'} {formatDate(data.institution.plan.validUntil)}</p>
                  )}
                  {data.institution.plan.features.length > 0 && (
                    <ul className="space-y-1.5">
                      {data.institution.plan.features.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                          <span className="w-1.5 h-1.5 rounded-full bg-state-positive flex-shrink-0" />{FEATURE_LABEL[f] ?? f}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-text-secondary">
                    {data.institution.plan.status.enforcement === 'block'
                      ? 'عند بلوغ الحد أو انتهاء الترخيص لا تُقبل طالبات أو حلقات جديدة. الطالبات الحاليات لا يُمنعن من المراجعة.'
                      : 'الحدود للتنبيه فقط الآن: لا يُمنع الانضمام عند بلوغها.'}
                  </p>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2 border-state-attention/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-state-attention" />
                    الإنذار المبكر — طالبات يحتجن متابعة
                  </CardTitle>
                  <p className="text-sm text-text-secondary">
                    {data.atRisk.high + data.atRisk.medium === 0 ? 'لا توجد طالبات متعثرات الآن.' : (
                      <>عالٍ: <b>{toArabicDigits(data.atRisk.high)}</b> · متوسط: <b>{toArabicDigits(data.atRisk.medium)}</b></>
                    )}
                    {' '}القاعدة: ٣ أيام بلا مراجعة، أو حضور أقل من ٧٠٪ في ٣٠ يوماً. وهي عالية عند اجتماعهما أو غياب أسبوعين أو لم تبدأ بعد. ليست توقعاً، بل ما سُجّل فعلاً.
                  </p>
                </CardHeader>
                <CardContent>
                  {data.atRisk.students.length === 0 ? (
                    <EmptyState icon={CheckCircle2} title="كل الطالبات منتظمات" description="تظهر هنا من تنقطع عن المراجعة أو تتغيب." />
                  ) : (
                    <ul className="space-y-3">
                      {data.atRisk.students.map((s) => (
                        <li key={s.studentId} data-testid="at-risk" data-level={s.level} className="p-4 rounded-xl border border-divider bg-surface-elevated space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-text-primary">{s.displayNameAr}</p>
                            <Badge variant={s.level === 'high' ? 'red' : 'gold'} size="sm">{s.level === 'high' ? 'أولوية عالية' : 'أولوية متوسطة'}</Badge>
                          </div>
                          <p className="text-sm text-text-secondary">{s.reasons.map((r) => REASON_LABEL[r](s)).join(' · ')}</p>
                          <p className="text-xs text-text-secondary">
                            {s.halaqat.join('، ')}
                            {s.lastActiveAt && <> · آخر مراجعة {formatDate(s.lastActiveAt)}</>}
                            {' '}· الإتقان {toArabicDigits(s.masteryPercent)}٪
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {data.atRisk.truncated && <p className="text-xs text-text-secondary mt-3">تُعرض الأولى فقط.</p>}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Mic className="w-5 h-5 text-brand-primary" />الفحص الآلي للتسميع</CardTitle></CardHeader>
              <CardContent className="text-sm text-text-secondary">
                يُتحكم به من <Link className="text-brand-primary underline" href="/dashboard/teacher">تبويب «التسميع والتقييم»</Link> في لوحة الحلقات.
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

function trend(now: number, before: number) {
  if (before === 0) return now === 0 ? 'لا نشاط بعد' : 'لا مقارنة بالأسبوع الماضي';
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? 'كالأسبوع الماضي' : `${pct > 0 ? '+' : '−'}${toArabicDigits(Math.abs(pct))}٪ عن الأسبوع الماضي`;
}

function Stat({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return (
    <Card variant="metric">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-text-secondary">{label}</p>
          <p className="mt-1 text-3xl font-bold text-text-primary">{value}</p>
          <p className="mt-2 text-xs text-text-secondary">{note}</p>
        </div>
        <div className="text-brand-primary">{icon}</div>
      </div>
    </Card>
  );
}

const STATE_NOTE = {
  ok: null, near: 'اقتربتم من الحد', full: 'بلغتم الحد', over: 'تجاوزتم الحد',
} as const;

function Usage({ label, used, limit, state, enforcement }: { label: string; used: number; limit: number; state: 'ok' | 'near' | 'full' | 'over'; enforcement: 'warn' | 'block' }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const note = STATE_NOTE[state];
  return (
    <div data-testid={`usage-${state}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-text-secondary">{label}</span>
        <span className="text-sm font-bold text-text-primary">{toArabicDigits(used)} / {toArabicDigits(limit)}</span>
      </div>
      <div className="w-full bg-surface-canvas rounded-full h-3" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
        <div className={`h-3 rounded-full ${state === 'over' || state === 'full' ? 'bg-state-danger' : state === 'near' ? 'bg-state-attention' : 'bg-brand-primary'}`} style={{ width: `${pct}%` }} />
      </div>
      {note && <p className="text-xs mt-1 text-state-attention">{note}{state !== 'near' && enforcement === 'block' ? ': لا إضافة جديدة' : ''}</p>}
    </div>
  );
}
