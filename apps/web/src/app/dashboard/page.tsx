'use client';

import { useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Badge } from '@itqan/ui';
import {
  BookOpen,
  Target,
  TrendingUp,
  AlertCircle,
  Sun,
  Clock,
  Flame,
  BarChart3,
  UserRound,
  LifeBuoy,
  GraduationCap,
  Users,
  Lock,
  Shield,
  Award,
  Star,
  Trophy,
  Zap,
  Music,
  Volume2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { HelpTickets } from '@/components/HelpTickets';
import { AccountPanel } from '@/components/AccountPanel';
import { CurriculumTracks } from '@/components/CurriculumTracks';
import { SessionTypePicker } from '@/components/SessionTypePicker';
import { IconTile } from '@/components/IconTile';

type StudentTab =
  | 'today'
  | 'progress'
  | 'mushaf'
  | 'mutashabihat'
  | 'curriculum'
  | 'account'
  | 'stats'
  | 'help';

export default function StudentDashboard() {
  const { user, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<StudentTab>('today');

  const nextAction = {
    type: 'review',
    title: 'مراجعة: سورة البقرة ٢٠٠-٢١٥',
    description: 'إتقان البعد الصوتي في الانتقالات',
    estimatedMinutes: 12,
    rationale: 'الاستقرار الصوتي ٠.٧٢، تسميع تجريبي خلال ٤ أيام',
  };

  const progress = {
    continuity: 78,
    mastery: 65,
    readiness: 72,
  };

  const streak = {
    current: 14,
    longest: 23,
    freezesRemaining: 2,
  };

  const recovery = {
    missed: true,
    message: 'فاتتك جلسة أمس. استأنفي بخطة ٧ دقائق للتعويض',
    minutes: 7,
  };

  // Gatekeeper state (Feature 1)
  const gatekeeper = {
    locked: true,
    currentMastery: 0.74,
    threshold: 0.85,
    deficitCards: 4,
    message: 'نسبة إتقانك في المراجعة الأخيرة 74% أقل من 85% المعتمدة. وفقاً للمنهجية الأصيلة: «لا يُؤخذ الجديد حتى يثبت القديم». يرجى التركيز على المراجعة اليوم لفك القفل.',
  };

  // Gamification badges (Feature 5)
  const badges = [
    { id: 'streak-7', nameAr: 'سلسلة ٧ أيام', icon: '🔥', earned: true, earnedAt: '2026-09-10' },
    { id: 'streak-14', nameAr: 'سلسلة ١٤ يوم', icon: '🔥', earned: true, earnedAt: '2026-09-17' },
    { id: 'surah-fatiha', nameAr: 'إتقان الفاتحة', icon: '📜', earned: true, earnedAt: '2026-08-20' },
    { id: 'surah-baqarah', nameAr: 'إتقان البقرة', icon: '📜', earned: true, earnedAt: '2026-09-05' },
    { id: 'tajweed-zero', nameAr: 'صفر أخطاء تجويد', icon: '🌟', earned: true, earnedAt: '2026-09-14' },
    { id: 'muraja-5', nameAr: '٥ مراجعات أقران', icon: '🤝', earned: false, earnedAt: null },
    { id: 'streak-30', nameAr: 'سلسلة ٣٠ يوم', icon: '💎', earned: false, earnedAt: null },
    { id: 'juz-30', nameAr: 'إتمام جزء عمّ', icon: '🏆', earned: false, earnedAt: null },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-canvas">
        <div className="animate-spin w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const navItems = [
    { id: 'today', label: 'الورد واليوم', icon: Sun },
    { id: 'mushaf', label: 'المصحف والحفظ', icon: BookOpen },
    { id: 'mutashabihat', label: 'المتشابهات', icon: Target },
    { id: 'progress', label: 'خطتي والكفايات', icon: TrendingUp },
    { id: 'curriculum', label: 'المناهج التعليمية', icon: GraduationCap },
    { id: 'stats', label: 'الاحصائيات', icon: BarChart3 },
    { id: 'account', label: 'حسابي', icon: UserRound },
    { id: 'help', label: 'الدعم الفني', icon: LifeBuoy },
  ];

  return (
    <AppShell
      items={navItems}
      activeId={activeTab}
      onSelect={(id) => setActiveTab(id as StudentTab)}
      homeHref="/dashboard"
      userInitials={user?.displayNameAr?.slice(0, 2) || '؟'}
      trailing={
        <div className="mt-4 p-3 rounded-2xl bg-surface-canvas border border-divider text-sm">
          <p className="text-text-secondary">سلسلة</p>
          <p className="font-bold text-brand-primary text-lg">{streak.current} / {streak.longest}</p>
        </div>
      }
    >
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <p className="text-sm text-text-secondary">مرحباً</p>
          <h1 className="font-heading text-2xl font-bold text-text-primary">
            {user?.displayNameAr || 'لوحة الطالبة'}
          </h1>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-medium">
          معتمد • إجمالي الحصص: {streak.current}
        </div>
      </div>

      {activeTab === 'today' && (
        <>
          <div className="grid md:grid-cols-3 gap-3 mb-5">
            <article className="surface-card p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <IconTile icon={Clock} size="sm" />
                <p className="font-heading font-bold text-brand-primary text-sm">الحصص القادمة</p>
              </div>
              <p className="text-text-secondary text-sm">لا توجد حصص تسميع مجدولة خارج خطة اليوم.</p>
              <Button variant="ghost" size="sm" className="mt-3 px-0" onClick={() => setActiveTab('mushaf')}>
                عرض الخطة
              </Button>
            </article>
            <article className="surface-card p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <IconTile icon={Users} size="sm" />
                <p className="font-heading font-bold text-brand-primary text-sm">المعلمات النشطات حالياً</p>
              </div>
              <p className="text-text-secondary text-sm">على منصة إتقان: متابعة عبر الشعبة المعتمدة</p>
              <Button variant="ghost" size="sm" className="mt-3 px-0" onClick={() => setActiveTab('help')}>
                طلب متابعة
              </Button>
            </article>
            <article className="surface-card p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <IconTile icon={BookOpen} size="sm" />
                <p className="font-heading font-bold text-brand-primary text-sm">هل ترغبين في بدء جلسة؟</p>
              </div>
              <Button size="sm" className="mt-2" onClick={() => setActiveTab('mushaf')}>
                ابدئي الجلسة
              </Button>
            </article>
          </div>

          <section className="mb-5">
            <Card className="border-brand-primary/30 shadow-lg">
              <CardContent>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <IconTile icon={BookOpen} size="sm" />
                    <div>
                      <span className="text-xs font-medium text-brand-primary">الإجراء التالي</span>
                      <h3 className="font-heading text-lg font-bold text-text-primary mt-1 block">{nextAction.title}</h3>
                    </div>
                  </div>
                  <Badge variant="gold" size="sm">موصى به</Badge>
                </div>
                <p className="text-text-secondary mb-3">{nextAction.description}</p>
                <div className="flex flex-wrap items-center gap-4 mb-3 text-sm">
                  <span className="flex items-center gap-1.5 text-text-secondary">
                    <Clock className="w-4 h-4" />
                    تقريباً {nextAction.estimatedMinutes} دقيقة
                  </span>
                  <span className="flex items-center gap-1.5 text-text-secondary">
                    <Flame className="w-4 h-4 text-state-positive" />
                    سلسلة {streak.current} يوم
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-brand-primary/5 border border-brand-primary/20 mb-3">
                  <p className="text-sm font-medium text-brand-primary mb-1">لماذا هذا الإجراء؟</p>
                  <p className="text-sm text-brand-primary/80">{nextAction.rationale}</p>
                </div>
                <Button size="lg" className="w-full" onClick={() => setActiveTab('mushaf')}>
                  ابدئي الجلسة
                </Button>
              </CardContent>
            </Card>
          </section>

          {/* Gatekeeper Rule Banner */}
          {gatekeeper.locked && (
            <section className="mb-5">
              <Card className="border-state-danger/30 bg-state-danger/5 shadow-lg">
                <CardContent>
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl bg-state-danger/10 flex items-center justify-center flex-shrink-0">
                      <Lock className="w-6 h-6 text-state-danger" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-heading font-bold text-text-primary">قفل الحفظ الجديد مفعّل</h3>
                        <Badge variant="red" size="sm">حارس الإتقان</Badge>
                      </div>
                      <p className="text-sm text-text-secondary mb-3">{gatekeeper.message}</p>
                      <div className="flex items-center gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-text-secondary">إتقانك الحالي:</span>
                          <span className="font-bold text-state-danger text-lg">{Math.round(gatekeeper.currentMastery * 100)}%</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-text-secondary">المطلوب:</span>
                          <span className="font-bold text-state-positive text-lg">{Math.round(gatekeeper.threshold * 100)}%</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-text-secondary">بطاقات تحتاج تحسين:</span>
                          <span className="font-bold text-state-attention">{gatekeeper.deficitCards}</span>
                        </div>
                      </div>
                      <div className="w-full bg-surface-canvas rounded-full h-3 mb-3">
                        <div
                          className="bg-state-danger h-3 rounded-full transition-all duration-500"
                          style={{ width: `${Math.round(gatekeeper.currentMastery * 100)}%` }}
                        />
                      </div>
                      <Button variant="primary" size="sm">
                        <Shield className="w-4 h-4 ml-2" />
                        ابدئي مراجعة فك القفل
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {recovery.missed && (
            <section className="mb-5">
              <Card className="border-state-attention/30 bg-state-attention/5">
                <CardContent>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-state-attention/10 flex items-center justify-center flex-shrink-0">
                      <AlertCircle className="w-5 h-5 text-state-attention" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-text-primary">{recovery.message}</p>
                      <Button variant="secondary" size="sm" className="mt-2">
                        ابدئي التعويض ({recovery.minutes} دقيقة)
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          <section className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ProgressCard
              label="الاستمرارية هذا الأسبوع"
              value={`${progress.continuity}%`}
              icon={<Sun className="w-5 h-5" />}
              trend={{ value: 5, label: 'عن الأسبوع الماضي' }}
              variant="positive"
            />
            <ProgressCard
              label="الإتقان (مستوى الجزء)"
              value={`${progress.mastery}%`}
              icon={<Target className="w-5 h-5" />}
              trend={{ value: 3, label: 'عن الشهر الماضي' }}
              variant="positive"
            />
            <ProgressCard
              label="الجاهزية للاختبار القادم"
              value={`${progress.readiness}%`}
              icon={<TrendingUp className="w-5 h-5" />}
              trend={{ value: -2, label: 'يحتاج تركيز' }}
              variant="neutral"
            />
          </section>

          <TodayTab />
        </>
      )}

      {activeTab === 'mushaf' && <MushafTab onReview={() => setActiveTab('today')} />}
      {activeTab === 'mutashabihat' && <MutashabihatTab />}
      {activeTab === 'progress' && <ProgressTab badges={badges} />}
      {activeTab === 'curriculum' && <CurriculumTracks onOpenMushaf={() => setActiveTab('mushaf')} />}
      {activeTab === 'account' && <AccountPanel />}
      {activeTab === 'stats' && (
        <EmptyState
          icon={BarChart3}
          title="لا توجد بيانات إحصائية بعد"
          description="أكملي أول جلسة حفظ لعرض إحصائيات حصتك وتقدمك هنا."
          action={
            <Button onClick={() => setActiveTab('mushaf')}>المصحف والحفظ</Button>
          }
        />
      )}
      {activeTab === 'help' && <HelpTickets />}
    </AppShell>
  );
}

function ProgressCard({ label, value, icon, trend, variant }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  trend?: { value: number; label: string };
  variant: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <Card variant="metric">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-text-secondary">{label}</p>
          <p className="mt-1 text-3xl font-bold text-text-primary">{value}</p>
          {trend && (
            <div className="mt-2 flex items-center gap-1.5 text-sm">
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

function TodayTab() {
  const tasks = [
    { type: 'new', label: 'جديد: سورة آل عمران ١-٥', time: '٨ دق', status: 'pending' },
    { type: 'review', label: 'مراجعة: البقرة ٢٠٠-٢١٥', time: '١٢ دق', status: 'current' },
    { type: 'mutashabihat', label: 'متشابهات: البقرة ٢٠٠ / آل عمران ١٠٠', time: '٥ دق', status: 'pending' },
    { type: 'review', label: 'مراجعة: الفاتحة - الناس', time: '١٠ دق', status: 'pending' },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>قائمة الحصص القادمة</span>
            <Badge variant="info">١٢ مهمة</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-divider">
            <table className="w-full text-sm">
              <thead className="bg-surface-canvas">
                <tr>
                  {['نوع الحصة', 'الوصف', 'المدة', 'الحالة'].map((h) => (
                    <th key={h} className="text-right py-2 px-3 font-medium text-text-secondary">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((item, i) => (
                  <tr key={i} className="border-t border-divider">
                    <td className="py-2 px-3">
                      <Badge variant={item.type === 'new' ? 'green' : item.type === 'mutashabihat' ? 'gold' : 'info'} size="sm">
                        {item.type === 'new' ? 'جديد' : item.type === 'mutashabihat' ? 'متشابهات' : 'مراجعة'}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 font-medium text-text-primary">{item.label}</td>
                    <td className="py-2 px-3 text-text-secondary">{item.time}</td>
                    <td className="py-2 px-3">
                      {item.status === 'current' ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-brand-primary/10 text-brand-primary">الحالية</span>
                      ) : (
                        <span className="text-text-muted">قادمة</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>قائمة المعلمات لديك</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Users}
            title="لم يتم إضافة معلمة بعد خارج الشعبة"
            description="المتابعة تتم عبر معلمة الشعبة المعتمدة. لا يوجد سوق حجز تجاري في إتقان."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            آية اليوم (من المحفوظ)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="font-quran text-2xl text-text-primary text-center leading-loose p-4 bg-surface-canvas rounded-lg border border-divider">
            اللَّهُ لاَ إِلَـهَ إِلاَّ هُوَ الْحَيُّ الْقَيُّومُ لاَ تَأْخُذُهُ سِنَةٌ وَلاَ نَوْمٌ...
          </div>
          <p className="text-sm text-text-secondary text-center mt-2">سورة البقرة • آية ٢٥٥ • آية الكرسي</p>
        </CardContent>
      </Card>
    </div>
  );
}

function MushafTab({ onReview }: { onReview?: () => void }) {
  return (
    <div className="space-y-4">
      <SessionTypePicker onNew={() => undefined} onReview={onReview} />
      <Card>
        <CardHeader>
          <CardTitle>المصحف الشريف</CardTitle>
          <CardDescription>قراءة، استذكار، وتسميع مع وضع التلاوة العمياء</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button variant="primary"><BookOpen className="w-4 h-4 mr-2" /> قراءة المستحفظ</Button>
            <Button variant="secondary"><Target className="w-4 h-4 mr-2" /> استذكار نشط</Button>
            <Button variant="ghost"><BookOpen className="w-4 h-4 mr-2" /> وضع التلاوة العمياء</Button>
          </div>
          <div className="p-4 bg-surface-canvas rounded-lg border border-divider font-quran text-2xl text-center leading-loose text-text-primary min-h-[140px] flex items-center justify-center">
            المصحف التفاعلي — اختر جزءاً أو صفحة للبدء
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" className="col-span-3">اختيار الجزء/الصفحة</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MutashabihatTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="w-5 h-5" />
          المتشابهات
        </CardTitle>
        <CardDescription>تدريب المقارنة بين الآيات المتشابهة</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <EmptyState
          icon={Target}
          title="لا توجد متشابهات مستحقة اليوم"
          description="ستظهر هنا عند وصول آيات متشابهة في خطتك"
        />
        <Button variant="secondary" className="w-full">استكشاف جميع المتشابهات</Button>
      </CardContent>
    </Card>
  );
}

function ProgressTab({ badges }: { badges: Array<{ id: string; nameAr: string; icon: string; earned: boolean; earnedAt: string | null }> }) {
  const earned = badges.filter(b => b.earned);
  const locked = badges.filter(b => !b.earned);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>خريطة الحرارة - الإتقان حسب الجزء</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-15 gap-1 max-w-full overflow-x-auto pb-4">
            {Array.from({ length: 30 }).map((_, i) => (
              <div key={i} className="w-8 h-8 rounded flex items-center justify-center text-xs font-medium select-none"
                style={{
                  backgroundColor: i % 7 === 0 ? '#1B4332' : i % 3 === 0 ? '#86A380' : '#E8E4DA',
                  color: i % 7 === 0 ? 'white' : 'inherit',
                }}
              >
                {i + 1}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-4 mt-4 text-sm text-text-secondary">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{background:'#E8E4DA'}}></span> لم يبدأ</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{background:'#86A380'}}></span> قيد التقدم</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{background:'#1B4332'}}></span> مُتقن</span>
          </div>
        </CardContent>
      </Card>

      {/* Gamification Badges */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-brand-accent" />
            الشارات والإنجازات
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <h4 className="text-sm font-medium text-text-secondary mb-3">مكتسبة ({earned.length})</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {earned.map(b => (
                <div key={b.id} className="flex flex-col items-center gap-2 p-3 rounded-xl bg-brand-accent/5 border border-brand-accent/20">
                  <span className="text-3xl">{b.icon}</span>
                  <span className="text-xs font-medium text-text-primary text-center">{b.nameAr}</span>
                  <span className="text-[10px] text-text-muted">{b.earnedAt}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium text-text-secondary mb-3">قادمة ({locked.length})</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {locked.map(b => (
                <div key={b.id} className="flex flex-col items-center gap-2 p-3 rounded-xl bg-surface-canvas border border-divider opacity-50">
                  <span className="text-3xl grayscale">{b.icon}</span>
                  <span className="text-xs font-medium text-text-muted text-center">{b.nameAr}</span>
                  <Lock className="w-3 h-3 text-text-muted" />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>سجل الأخطاء</CardTitle></CardHeader>
        <CardContent>
          <p className="text-text-secondary text-sm">لا توجد أخطاء مسجلة بعد. ابدئي جلسة لتسجيل التقدم.</p>
        </CardContent>
      </Card>
    </div>
  );
}
