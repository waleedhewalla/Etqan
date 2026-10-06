'use client';

import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@itqan/ui';
import {
  Shield,
  TrendingUp,
  Flame,
  Target,
  Bell,
  Share2,
  Users,
  Award,
  BookOpen,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Mock data (inline, no API calls)
// ---------------------------------------------------------------------------

const childInfo = {
  name: 'فاطمة أحمد المنصوري',
  halaqah: 'حلقة النور — المستوى الثالث',
  teacher: 'الشيخة نورة العلي',
};

const metrics = {
  retention: 93.7,
  streak: 24,
  activeTarget: 'جزء عمّ',
};

const forecast = {
  dailyRate: 12,
  projectedCompletion: '١٥ ربيع الأول ١٤٤٨ هـ',
  khatmTarget: 'رمضان ١٤٤٨ هـ',
  gatekeeperStatus: 'مفتوح' as const,
};

const badges = [
  { id: 'sanad', icon: '📜', nameAr: 'سند الإجازة', earnedAt: '١٤٤٧/٠٦/١٠' },
  { id: 'streak-30', icon: '🔥', nameAr: 'سلسلة ٣٠ يوم', earnedAt: '١٤٤٧/٠٧/٠٢' },
  { id: 'peer-muraja', icon: '🎤', nameAr: 'مراجعة الأقران', earnedAt: '١٤٤٧/٠٧/١٥' },
  { id: 'tajweed', icon: '⭐', nameAr: 'إتقان التجويد', earnedAt: '١٤٤٧/٠٨/٠١' },
];

const notifications = [
  {
    id: 'n1',
    type: 'forecast' as const,
    message: 'معدل الحفظ الحالي يتوقع إتمام جزء عمّ قبل رمضان ١٤٤٨ هـ',
    time: 'منذ ساعتين',
  },
  {
    id: 'n2',
    type: 'mastery' as const,
    message: 'فاطمة أتقنت سورة الملك — نسبة الاحتفاظ ٩٦٪',
    time: 'أمس',
  },
  {
    id: 'n3',
    type: 'streak' as const,
    message: 'فاطمة حافظت على سلسلة ٢٤ يوماً متتالياً',
    time: 'منذ ٣ أيام',
  },
];

const peerLog = [
  {
    date: '١٤٤٧/٠٨/١٨',
    sessionType: 'مراجعة أقران',
    scope: 'سورة البقرة ١-٥٠',
    score: 94,
    sheikhApproval: true,
  },
  {
    date: '١٤٤٧/٠٨/١٥',
    sessionType: 'تسميع فردي',
    scope: 'سورة الملك كاملة',
    score: 96,
    sheikhApproval: true,
  },
  {
    date: '١٤٤٧/٠٨/١٢',
    sessionType: 'مراجعة أقران',
    scope: 'سورة النبأ — الناس',
    score: 88,
    sheikhApproval: false,
  },
  {
    date: '١٤٤٧/٠٨/٠٨',
    sessionType: 'اختبار دوري',
    scope: 'جزء عمّ — النصف الأول',
    score: 91,
    sheikhApproval: true,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GuardianDashboard() {
  return (
    <div className="min-h-screen bg-surface-canvas" dir="rtl">
      {/* ---- Page Header ---- */}
      <header className="sticky top-0 z-40 bg-surface-elevated/95 border-b border-divider backdrop-blur-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 sm:px-6 h-14">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-brand-primary" />
            </div>
            <h1 className="font-heading text-lg font-bold text-text-primary">
              بوابة ولي الأمر
            </h1>
          </div>
          <Badge variant="green" size="sm" dot>
            متصل
          </Badge>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ---- 1. Child Info Header ---- */}
        <Card>
          <CardContent>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-brand-primary text-white flex items-center justify-center text-2xl font-bold shrink-0">
                {childInfo.name.slice(0, 2)}
              </div>
              <div className="flex-1 space-y-1">
                <h2 className="font-heading text-xl font-bold text-text-primary">
                  {childInfo.name}
                </h2>
                <p className="text-sm text-text-secondary flex items-center gap-2">
                  <BookOpen className="w-4 h-4 shrink-0" />
                  {childInfo.halaqah}
                </p>
                <p className="text-sm text-text-secondary flex items-center gap-2">
                  <Users className="w-4 h-4 shrink-0" />
                  المعلمة: {childInfo.teacher}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ---- 2. Key Metrics Row ---- */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MetricTile
            icon={<TrendingUp className="w-5 h-5" />}
            label="نسبة الاحتفاظ"
            value={`${metrics.retention}٪`}
            accent="text-state-positive"
          />
          <MetricTile
            icon={<Flame className="w-5 h-5" />}
            label="السلسلة الحالية"
            value={`${metrics.streak} يوم`}
            accent="text-brand-accent"
          />
          <MetricTile
            icon={<Target className="w-5 h-5" />}
            label="الهدف النشط"
            value={metrics.activeTarget}
            accent="text-brand-primary"
          />
        </section>

        {/* ---- 3. Milestone Velocity Forecast ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-brand-primary" />
              توقعات سرعة الإنجاز
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-3">
                <ForecastRow label="معدل الحفظ اليومي" value={`${forecast.dailyRate} آية/يوم`} />
                <ForecastRow label="تاريخ الإتمام المتوقع" value={forecast.projectedCompletion} />
              </div>
              <div className="space-y-3">
                <ForecastRow label="هدف الختمة القادم" value={forecast.khatmTarget} />
                <div className="flex items-center justify-between p-3 rounded-xl bg-surface-canvas border border-divider">
                  <span className="text-sm text-text-secondary">حارس الإتقان</span>
                  <Badge variant="green" size="sm">
                    {forecast.gatekeeperStatus}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ---- 4. Badges Section ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="w-5 h-5 text-brand-accent" />
              الشارات المكتسبة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {badges.map((b) => (
                <div
                  key={b.id}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl bg-brand-accent/5 border border-brand-accent/20"
                >
                  <span className="text-3xl">{b.icon}</span>
                  <span className="text-sm font-medium text-text-primary text-center">
                    {b.nameAr}
                  </span>
                  <span className="text-[11px] text-text-muted">{b.earnedAt}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ---- 5. Notifications Feed ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-brand-primary" />
              آخر التحديثات
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-divider">
              {notifications.map((n) => (
                <li key={n.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="mt-0.5 w-8 h-8 rounded-lg bg-brand-primary/10 flex items-center justify-center shrink-0">
                    {n.type === 'forecast' && (
                      <TrendingUp className="w-4 h-4 text-brand-primary" />
                    )}
                    {n.type === 'mastery' && (
                      <BookOpen className="w-4 h-4 text-state-positive" />
                    )}
                    {n.type === 'streak' && (
                      <Flame className="w-4 h-4 text-brand-accent" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary">{n.message}</p>
                    <p className="text-xs text-text-muted mt-1">{n.time}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* ---- 6. WhatsApp Share Button ---- */}
        <Button
          size="lg"
          className="w-full bg-[#25D366] hover:bg-[#1da851] text-white"
        >
          <Share2 className="w-5 h-5 ml-2" />
          مشاركة التقدم عبر واتساب
        </Button>

        {/* ---- 7. Peer Muraja'ah Log ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-brand-primary" />
              سجل المراجعة والتسميع
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border border-divider">
              <table className="w-full text-sm">
                <thead className="bg-surface-canvas">
                  <tr>
                    {['التاريخ', 'نوع الجلسة', 'النطاق', 'الدرجة', 'اعتماد الشيخ'].map(
                      (h) => (
                        <th
                          key={h}
                          className="text-right py-2.5 px-3 font-medium text-text-secondary whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {peerLog.map((row, i) => (
                    <tr key={i} className="border-t border-divider">
                      <td className="py-2.5 px-3 text-text-primary whitespace-nowrap">
                        {row.date}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge
                          variant={row.sessionType === 'مراجعة أقران' ? 'info' : 'gold'}
                          size="sm"
                        >
                          {row.sessionType}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-text-primary font-quran">
                        {row.scope}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`font-bold ${
                            row.score >= 90
                              ? 'text-state-positive'
                              : 'text-state-danger'
                          }`}
                        >
                          {row.score}٪
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {row.sheikhApproval ? (
                          <Badge variant="green" size="sm">
                            معتمد
                          </Badge>
                        ) : (
                          <Badge variant="amber" size="sm">
                            قيد المراجعة
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (local to this file)
// ---------------------------------------------------------------------------

function MetricTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <Card variant="metric">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-text-secondary">{label}</p>
          <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
        </div>
        <div className="text-brand-primary">{icon}</div>
      </div>
    </Card>
  );
}

function ForecastRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-surface-canvas border border-divider">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-sm font-bold text-text-primary">{value}</span>
    </div>
  );
}
