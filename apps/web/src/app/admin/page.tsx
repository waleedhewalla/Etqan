'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Input } from '@itqan/ui';
import {
  Building2,
  Users,
  BookOpen,
  TrendingUp,
  AlertTriangle,
  Settings,
  Plus,
  FileText,
  Shield,
} from 'lucide-react';

const tenants = [
  { id: 'tenant-1', name: 'كلية الدراسات الإسلامية', domain: 'islamic-studies.itqan.app', status: 'active' as const },
  { id: 'tenant-2', name: 'معهد القراءات العشر', domain: 'qiraat10.itqan.app', status: 'active' as const },
  { id: 'tenant-3', name: 'مدرسة النور الأسبوعية', domain: 'al-nour.itqan.app', status: 'trial' as const },
];

const atRiskStudents = [
  {
    id: 'risk-1',
    name: 'فاطمة أحمد محمد',
    riskPercentage: 82,
    reason: 'غياب ٥ أيام متتالية عن جلسات المراجعة',
    lastActive: 'منذ ٥ أيام',
    halaqah: 'حلقة سورة البقرة',
  },
  {
    id: 'risk-2',
    name: 'مريم عبد الرحمن',
    riskPercentage: 67,
    reason: 'انخفاض حاد في نسبة الإتقان من ٩١٪ إلى ٦٣٪',
    lastActive: 'منذ يومين',
    halaqah: 'حلقة جزء عمّ',
  },
  {
    id: 'risk-3',
    name: 'خديجة حسن علي',
    riskPercentage: 55,
    reason: 'تأخر في إنجاز الحفظ الجديد ٣ أسابيع',
    lastActive: 'منذ ٣ أيام',
    halaqah: 'حلقة سورة آل عمران',
  },
];

const licenseFeatures = [
  'تحليلات متقدمة وتقارير مؤسسية',
  'إدارة حلقات غير محدودة',
  'نظام إنذار مبكر للطالبات',
  'تكامل مع نظام الحضور',
  'دعم فني ذو أولوية',
];

export default function AdminDashboard() {
  const [selectedTenant, setSelectedTenant] = useState(tenants[0].id);
  const currentTenant = tenants.find((t) => t.id === selectedTenant) ?? tenants[0];

  return (
    <div dir="rtl" className="min-h-screen bg-surface-canvas">
      {/* Top Navigation Bar */}
      <header className="bg-surface-elevated border-b border-divider sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-primary flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-text-inverse" />
            </div>
            <div>
              <h1 className="font-heading text-lg font-bold text-text-primary">لوحة الإدارة</h1>
              <p className="text-xs text-text-secondary">إتقان - نظام إدارة المؤسسات</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Section 1: Institution Header */}
        <section className="surface-card p-6 rounded-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-brand-primary/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-7 h-7 text-brand-primary" />
              </div>
              <div>
                <h2 className="font-heading text-xl font-bold text-text-primary">
                  كلية الدراسات الإسلامية - جامعة الأزهر
                </h2>
                <p className="text-sm text-text-secondary mt-1">{currentTenant.domain}</p>
              </div>
            </div>
            <Badge variant="green" size="sm">مفعّلة</Badge>
          </div>
        </section>

        {/* Section 2: Key Stats Row */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Users className="w-5 h-5" />}
            label="إجمالي الطالبات"
            value="١٥٦"
            trend="+١٢ هذا الشهر"
            trendPositive
          />
          <StatCard
            icon={<BookOpen className="w-5 h-5" />}
            label="الحلقات النشطة"
            value="٨"
            trend="٣ حلقات جديدة"
            trendPositive
          />
          <StatCard
            icon={<TrendingUp className="w-5 h-5" />}
            label="إجمالي الجلسات"
            value="١٬٢٤٧"
            trend="+٨٧ هذا الأسبوع"
            trendPositive
          />
          <StatCard
            icon={<Shield className="w-5 h-5" />}
            label="الإتقان المؤسسي"
            value="٨٨.٨٪"
            trend="+٢.٣٪ عن الشهر الماضي"
            trendPositive
          />
        </section>

        {/* Section 3 & 4: License Info + Tenant Selector */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* License Info Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-brand-accent" />
                معلومات الترخيص
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">الخطة الحالية</span>
                <Badge variant="gold" size="sm">Madrasa Pro</Badge>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-text-secondary">استخدام المقاعد</span>
                  <span className="text-sm font-bold text-text-primary">١٥٦ / ٢٠٠</span>
                </div>
                <div className="w-full bg-surface-canvas rounded-full h-3">
                  <div
                    className="bg-brand-primary h-3 rounded-full transition-all duration-500"
                    style={{ width: '78%' }}
                  />
                </div>
                <p className="text-xs text-text-secondary mt-1">٧٨٪ من السعة المتاحة</p>
              </div>

              <div>
                <p className="text-sm font-medium text-text-primary mb-2">المميزات المتاحة:</p>
                <ul className="space-y-1.5">
                  {licenseFeatures.map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm text-text-secondary">
                      <span className="w-1.5 h-1.5 rounded-full bg-state-positive flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Tenant Selector */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-brand-primary" />
                تبديل المؤسسة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {tenants.map((tenant) => (
                <button
                  key={tenant.id}
                  onClick={() => setSelectedTenant(tenant.id)}
                  className={`w-full text-right p-4 rounded-xl border transition-all duration-200 ${
                    selectedTenant === tenant.id
                      ? 'border-brand-primary bg-brand-primary/5 shadow-sm'
                      : 'border-divider bg-surface-elevated hover:border-brand-primary/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          selectedTenant === tenant.id
                            ? 'bg-brand-primary text-text-inverse'
                            : 'bg-surface-canvas text-brand-primary'
                        }`}
                      >
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-medium text-text-primary text-sm">{tenant.name}</p>
                        <p className="text-xs text-text-secondary mt-0.5">{tenant.domain}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedTenant === tenant.id && (
                        <span className="text-xs text-brand-primary font-medium">الحالية</span>
                      )}
                      <Badge
                        variant={tenant.status === 'active' ? 'green' : 'gold'}
                        size="sm"
                      >
                        {tenant.status === 'active' ? 'مفعّلة' : 'تجريبية'}
                      </Badge>
                    </div>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Section 5: At-Risk Early Warning Center */}
        <Card className="border-state-attention/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-state-attention" />
              مركز الإنذار المبكر - طالبات معرّضات للانقطاع
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {atRiskStudents.map((student) => (
                <div
                  key={student.id}
                  className="p-4 rounded-xl border border-divider bg-surface-elevated flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3 flex-1">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        student.riskPercentage >= 75
                          ? 'bg-state-danger/10'
                          : student.riskPercentage >= 60
                            ? 'bg-state-attention/10'
                            : 'bg-state-info/10'
                      }`}
                    >
                      <span
                        className={`text-sm font-bold ${
                          student.riskPercentage >= 75
                            ? 'text-state-danger'
                            : student.riskPercentage >= 60
                              ? 'text-state-attention'
                              : 'text-state-info'
                        }`}
                      >
                        {student.riskPercentage}٪
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-text-primary text-sm">{student.name}</p>
                        <Badge
                          variant={student.riskPercentage >= 75 ? 'red' : 'gold'}
                          size="sm"
                        >
                          {student.riskPercentage >= 75 ? 'خطر عالٍ' : 'خطر متوسط'}
                        </Badge>
                      </div>
                      <p className="text-sm text-text-secondary">{student.reason}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-text-secondary">
                        <span>{student.halaqah}</span>
                        <span className="text-divider">|</span>
                        <span>آخر نشاط: {student.lastActive}</span>
                      </div>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" className="flex-shrink-0">
                    <AlertTriangle className="w-3.5 h-3.5 ml-1.5" />
                    تدخّل
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Section 6: Quick Actions */}
        <section>
          <h3 className="font-heading text-lg font-bold text-text-primary mb-4">إجراءات سريعة</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <QuickAction icon={<Plus className="w-5 h-5" />} label="إضافة طالبة" />
            <QuickAction icon={<BookOpen className="w-5 h-5" />} label="إنشاء حلقة" />
            <QuickAction icon={<FileText className="w-5 h-5" />} label="إنشاء تقرير" />
            <QuickAction icon={<Users className="w-5 h-5" />} label="إدارة المعلمات" />
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  trend,
  trendPositive,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend: string;
  trendPositive: boolean;
}) {
  return (
    <Card variant="metric">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-text-secondary">{label}</p>
          <p className="mt-1 text-3xl font-bold text-text-primary">{value}</p>
          <p
            className={`mt-2 text-xs ${
              trendPositive ? 'text-state-positive' : 'text-state-danger'
            }`}
          >
            {trend}
          </p>
        </div>
        <div className="text-brand-primary">{icon}</div>
      </div>
    </Card>
  );
}

function QuickAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="surface-card p-4 rounded-xl flex flex-col items-center gap-3 hover:shadow-md transition-shadow duration-200 border border-divider hover:border-brand-primary/30">
      <div className="w-12 h-12 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
        {icon}
      </div>
      <span className="text-sm font-medium text-text-primary">{label}</span>
    </button>
  );
}
