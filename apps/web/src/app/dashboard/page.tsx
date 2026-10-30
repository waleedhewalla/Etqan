'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from '@itqan/ui';
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
  Lock,
  Shield,
  CheckCircle2,
  CalendarCheck,
  Trophy,
  Mic,
} from 'lucide-react';
import { useRequireRole } from '@/lib/auth-context';
import { api, errorMessage, queryKeys, type BadgeProgress, type EarnedBadge, type QueueItem, type QueueResponse, type Rating } from '@/lib/api';
import { formatAyahRange, formatAyahRef, toArabicDigits } from '@/lib/quran';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { HelpTickets } from '@/components/HelpTickets';
import { AccountPanel } from '@/components/AccountPanel';
import { CurriculumTracks } from '@/components/CurriculumTracks';
import { SessionTypePicker } from '@/components/SessionTypePicker';
import { IconTile } from '@/components/IconTile';
import { PreviewNotice } from '@/components/PreviewNotice';
import { MushafReader } from '@/components/MushafReader';
import { VerseText } from '@/components/VerseText';
import { ReciteTab } from '@/components/ReciteTab';
import { MutashabihatTrainer } from '@/components/MutashabihatTrainer';
import { FullPageSpinner, LoadError, Spinner } from '@/components/LoadState';

type StudentTab =
  | 'today'
  | 'progress'
  | 'mushaf'
  | 'recite'
  | 'mutashabihat'
  | 'curriculum'
  | 'account'
  | 'stats'
  | 'help';

export default function StudentDashboard() {
  const { user, ready } = useRequireRole(['student', 'alumna']);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<StudentTab>('today');
  const [reviewing, setReviewing] = useState(false);

  const queueQuery = useQuery({
    queryKey: queryKeys.queue,
    queryFn: () => api.getQueue().then((r) => r.data),
    enabled: ready,
  });
  const statsQuery = useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => api.getStats().then((r) => r.data),
    enabled: ready,
  });
  const weekQuery = useQuery({
    queryKey: ['weekly', user?.id],
    queryFn: () => api.getWeeklyReport(user!.id).then((r) => r.data),
    enabled: ready && Boolean(user),
  });

  const queue = queueQuery.data;
  const streak = queue?.streak ?? statsQuery.data?.streak;
  const items = useMemo(() => (queue ? orderedItems(queue) : []), [queue]);

  if (!ready) return <FullPageSpinner />;

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.queue });
    queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    queryClient.invalidateQueries({ queryKey: ['weekly'] });
  };

  const navItems = [
    { id: 'today', label: 'الورد واليوم', icon: Sun },
    { id: 'mushaf', label: 'المصحف والحفظ', icon: BookOpen },
    { id: 'recite', label: 'التسميع', icon: Mic },
    { id: 'mutashabihat', label: 'المتشابهات', icon: Target },
    { id: 'progress', label: 'خطتي والكفايات', icon: TrendingUp },
    { id: 'curriculum', label: 'المناهج التعليمية', icon: GraduationCap },
    { id: 'stats', label: 'الاحصائيات', icon: BarChart3 },
    { id: 'account', label: 'حسابي', icon: UserRound },
    { id: 'help', label: 'الدعم الفني', icon: LifeBuoy },
  ];

  const stats = statsQuery.data;
  const masteryPercent = stats?.total ? Math.round(((stats.review + stats.mastered) / stats.total) * 100) : 0;
  const activeDays = weekQuery.data?.revision.activeDays.length ?? 0;
  const missedDays = streak?.lastActiveDate ? daysSince(streak.lastActiveDate) : null;

  return (
    <AppShell
      items={navItems}
      activeId={activeTab}
      onSelect={(id) => { setActiveTab(id as StudentTab); setReviewing(false); }}
      homeHref="/dashboard"
      userInitials={user?.displayNameAr?.slice(0, 2) || '؟'}
      trailing={
        <div className="mt-4 p-3 rounded-2xl bg-surface-canvas border border-divider text-sm">
          <p className="text-text-secondary">السلسلة الحالية / الأطول</p>
          <p className="font-bold text-brand-primary text-lg">
            {toArabicDigits(streak?.currentStreak ?? 0)} / {toArabicDigits(streak?.longestStreak ?? 0)}
          </p>
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
        {streak && (
          <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-medium">
            <span className="flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5" />
              سلسلة {toArabicDigits(streak.currentStreak)} يوم
            </span>
            <span className="text-brand-primary/70" title="إن فاتكِ يوم واحد يُحتسب من أيام السماح ولا تنقطع السلسلة">
              أيام السماح: {toArabicDigits(streak.freezesRemaining)}
            </span>
          </div>
        )}
      </div>

      {activeTab === 'today' && (
        queueQuery.isLoading ? <Spinner /> : queueQuery.isError || !queue ? (
          <LoadError onRetry={() => queueQuery.refetch()} />
        ) : reviewing ? (
          <ReviewSession
            items={items}
            onFinish={() => { setReviewing(false); refreshAll(); }}
          />
        ) : (
          <>
            <NextActionCard queue={queue} onStart={() => setReviewing(true)} />

            {queue.gatekeeper.locked && (
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
                        <p className="text-sm text-text-secondary mb-3">{queue.gatekeeper.message}</p>
                        <div className="flex items-center gap-4 mb-3 flex-wrap">
                          <span className="text-sm text-text-secondary">إتقانك الحالي: <b className="text-state-danger text-lg">{Math.round(queue.gatekeeper.currentMastery * 100)}٪</b></span>
                          <span className="text-sm text-text-secondary">المطلوب: <b className="text-state-positive text-lg">{Math.round(queue.gatekeeper.threshold * 100)}٪</b></span>
                          <span className="text-sm text-text-secondary">بطاقات تحتاج تحسين: <b className="text-state-attention">{queue.gatekeeper.deficitCards}</b></span>
                        </div>
                        <Button variant="primary" size="sm" onClick={() => setReviewing(true)} disabled={items.length === 0}>
                          <Shield className="w-4 h-4 ml-2" />
                          ابدئي مراجعة فك القفل
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            {missedDays !== null && missedDays >= 2 && (
              <section className="mb-5">
                <Card className="border-state-attention/30 bg-state-attention/5">
                  <CardContent>
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-state-attention/10 flex items-center justify-center flex-shrink-0">
                        <AlertCircle className="w-5 h-5 text-state-attention" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-text-primary">
                          آخر مراجعة لكِ كانت قبل {toArabicDigits(missedDays)} أيام. ابدئي بمراجعة قصيرة لتستعيدي إيقاعك.
                        </p>
                        <Button variant="secondary" size="sm" className="mt-2" onClick={() => setReviewing(true)} disabled={items.length === 0}>
                          ابدئي المراجعة
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            <section className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ProgressCard
                label="أيام المراجعة هذا الأسبوع"
                value={`${toArabicDigits(activeDays)} / ٧`}
                icon={<Sun className="w-5 h-5" />}
                variant="neutral"
              />
              <ProgressCard
                label="الآيات المثبّتة"
                value={`${toArabicDigits(masteryPercent)}٪`}
                icon={<Target className="w-5 h-5" />}
                variant="neutral"
              />
              <ProgressCard
                label="مستحقة للمراجعة الآن"
                value={toArabicDigits(stats?.dueNow ?? 0)}
                icon={<TrendingUp className="w-5 h-5" />}
                variant="neutral"
              />
            </section>

            <QueueTable queue={queue} />
          </>
        )
      )}

      {activeTab === 'mushaf' && <MushafTab onReview={() => { setActiveTab('today'); setReviewing(true); }} />}
      {activeTab === 'recite' && <ReciteTab />}
      {activeTab === 'mutashabihat' && <MutashabihatTrainer />}
      {activeTab === 'progress' && <ProgressTab />}
      {activeTab === 'curriculum' && (
        <>
          <PreviewNotice />
          <CurriculumTracks onOpenMushaf={() => setActiveTab('mushaf')} />
        </>
      )}
      {activeTab === 'account' && <AccountPanel />}
      {activeTab === 'stats' && (
        statsQuery.isLoading ? <Spinner /> : !stats || stats.total === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="لا توجد بيانات إحصائية بعد"
            description="ستظهر الإحصائيات بعد أن تضيف معلمتك آيات خطتك وتبدئي المراجعة."
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <ProgressCard label="إجمالي الآيات في خطتك" value={toArabicDigits(stats.total)} icon={<BookOpen className="w-5 h-5" />} variant="neutral" />
            <ProgressCard label="في المراجعة" value={toArabicDigits(stats.review)} icon={<TrendingUp className="w-5 h-5" />} variant="neutral" />
            <ProgressCard label="متقنة" value={toArabicDigits(stats.mastered)} icon={<CheckCircle2 className="w-5 h-5" />} variant="positive" />
            <ProgressCard label="جديدة لم تُحفظ بعد" value={toArabicDigits(stats.new)} icon={<Sun className="w-5 h-5" />} variant="neutral" />
            <ProgressCard label="مستحقة الآن" value={toArabicDigits(stats.dueNow)} icon={<Clock className="w-5 h-5" />} variant="neutral" />
            <ProgressCard label="مراجعات اليوم" value={toArabicDigits(stats.todayReviews)} icon={<CalendarCheck className="w-5 h-5" />} variant="neutral" />
          </div>
        )
      )}
      {activeTab === 'help' && <HelpTickets />}
    </AppShell>
  );
}

const REASON_LABELS: Record<QueueItem['reason'], string> = {
  manzil: 'منزل',
  sabqi: 'سبقي',
  sabaq: 'سبق جديد',
};

const RATINGS: { value: Rating; label: string; hint: string; variant: 'danger' | 'secondary' | 'primary' | 'outline' }[] = [
  { value: 'again', label: 'نسيتُها', hint: 'تعود قريباً', variant: 'danger' },
  { value: 'hard', label: 'بصعوبة', hint: 'فترة أقصر', variant: 'secondary' },
  { value: 'good', label: 'جيدة', hint: 'الموعد المعتاد', variant: 'primary' },
  { value: 'easy', label: 'متقنة', hint: 'فترة أطول', variant: 'outline' },
];

/** Overdue (manzil) first, then today's revision (sabqi), then new memorization (sabaq). */
function orderedItems(queue: QueueResponse): QueueItem[] {
  return [...queue.queue.manzil.items, ...queue.queue.sabqi.items, ...queue.queue.sabaq.items];
}

function daysSince(date: string): number {
  const today = new Date();
  const then = new Date(`${date}T00:00:00`);
  return Math.floor((today.getTime() - then.getTime()) / 86_400_000);
}

function NextActionCard({ queue, onStart }: { queue: QueueResponse; onStart: () => void }) {
  const { manzil, sabqi, sabaq } = queue.queue;
  const nothingDue = queue.totalItems === 0;
  const title = manzil.count > 0
    ? `مراجعة متأخرة: ${toArabicDigits(manzil.count)} آيات`
    : sabqi.count > 0
      ? `مراجعة اليوم: ${toArabicDigits(sabqi.count)} آيات`
      : sabaq.count > 0
        ? `حفظ جديد: ${toArabicDigits(sabaq.count)} آيات`
        : 'أتممتِ ورد اليوم';
  const rationale = manzil.count > 0
    ? 'نبدأ بالآيات المتأخرة حتى لا تضعف، ثم مراجعة اليوم، ثم الجديد.'
    : sabqi.count > 0
      ? 'هذه الآيات حان موعد مراجعتها حسب جدول التكرار المتباعد.'
      : sabaq.count > 0
        ? 'لا مراجعات مستحقة، فهذا وقت مناسب لحفظ جديد.'
        : 'لا توجد آيات مستحقة الآن. عودي غداً لموعد المراجعة التالي.';

  return (
    <section className="mb-5">
      <Card className="border-brand-primary/30 shadow-lg">
        <CardContent>
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              <IconTile icon={nothingDue ? CheckCircle2 : BookOpen} size="sm" />
              <div>
                <span className="text-xs font-medium text-brand-primary">الإجراء التالي</span>
                <h3 className="font-heading text-lg font-bold text-text-primary mt-1 block">{title}</h3>
              </div>
            </div>
            {!nothingDue && <Badge variant="gold" size="sm">موصى به</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-4 mb-3 text-sm">
            {!nothingDue && (
              <span className="flex items-center gap-1.5 text-text-secondary">
                <Clock className="w-4 h-4" />
                تقريباً {toArabicDigits(Math.max(1, Math.round(queue.estimatedMinutes)))} دقيقة
              </span>
            )}
            <span className="flex items-center gap-1.5 text-text-secondary">
              <Flame className="w-4 h-4 text-state-positive" />
              سلسلة {toArabicDigits(queue.streak.currentStreak)} يوم
            </span>
          </div>
          <div className="p-3 rounded-lg bg-brand-primary/5 border border-brand-primary/20 mb-3">
            <p className="text-sm font-medium text-brand-primary mb-1">لماذا هذا الإجراء؟</p>
            <p className="text-sm text-brand-primary/80">{rationale}</p>
          </div>
          {!nothingDue && (
            <Button size="lg" className="w-full" onClick={onStart}>
              ابدئي الجلسة
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function QueueTable({ queue }: { queue: QueueResponse }) {
  const items = orderedItems(queue);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>ورد اليوم</span>
            <Badge variant="info">{toArabicDigits(items.length)} آية</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-text-secondary text-sm">لا توجد آيات مستحقة الآن.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-divider">
              <table className="w-full text-sm">
                <thead className="bg-surface-canvas">
                  <tr>
                    {['النوع', 'الآية', 'السبب'].map((h) => (
                      <th key={h} className="text-right py-2 px-3 font-medium text-text-secondary">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.card.id} className="border-t border-divider">
                      <td className="py-2 px-3">
                        <Badge variant={item.reason === 'sabaq' ? 'green' : item.reason === 'manzil' ? 'amber' : 'info'} size="sm">
                          {REASON_LABELS[item.reason]}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 font-medium text-text-primary">{formatAyahRef(item.card.ayahRef)}</td>
                      <td className="py-2 px-3 text-text-secondary">{item.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {queue.assignments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>تكليفات المعلمة</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-divider text-sm">
              {queue.assignments.map((a) => (
                <li key={a.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                  <span className="flex items-center gap-2">
                    <Badge variant={a.type === 'sabaq' ? 'green' : a.type === 'manzil' ? 'amber' : 'info'} size="sm">{REASON_LABELS[a.type]}</Badge>
                    <span className="font-medium text-text-primary">{formatAyahRange(a.startRef, a.endRef)}</span>
                  </span>
                  {a.dueDate && <span className="text-text-secondary">حتى {a.dueDate}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Steps through the day's cards; each rating reschedules the card with FSRS. */
function ReviewSession({ items, onFinish }: { items: QueueItem[]; onFinish: () => void }) {
  const queryClient = useQueryClient();
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<Rating, number>>({ again: 0, hard: 0, good: 0, easy: 0 });
  const [streakAfter, setStreakAfter] = useState<number | null>(null);
  const [earned, setEarned] = useState<EarnedBadge[]>([]);
  const shownAt = useRef(Date.now());

  const [showVerse, setShowVerse] = useState(false);

  const current = items[index];
  const done = index >= items.length;

  const rate = async (rating: Rating) => {
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.rateCard(current.card.id, rating, Date.now() - shownAt.current);
      setStreakAfter(res.data.streak?.currentStreak ?? null);
      if (res.data.newBadges?.length) {
        setEarned((e) => [...e, ...res.data.newBadges!]);
        queryClient.invalidateQueries({ queryKey: queryKeys.badges });
      }
      setCounts((c) => ({ ...c, [rating]: c[rating] + 1 }));
      setShowVerse(false);
      setIndex((i) => i + 1);
      shownAt.current = Date.now();
    } catch (err) {
      setError(errorMessage(err, 'لم يُحفظ التقييم. حاولي مرة أخرى.'));
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    const total = items.length;
    return (
      <Card className="mb-5">
        <CardContent className="text-center space-y-4 py-8">
          <CheckCircle2 className="w-12 h-12 text-state-positive mx-auto" />
          <h2 className="font-heading text-2xl font-bold text-text-primary">أحسنتِ، أتممتِ ورد اليوم</h2>
          <p className="text-text-secondary">
            راجعتِ {toArabicDigits(total)} آية: {toArabicDigits(counts.good + counts.easy)} ثابتة،
            {' '}{toArabicDigits(counts.hard)} بصعوبة، {toArabicDigits(counts.again)} تحتاج إعادة.
          </p>
          {streakAfter !== null && (
            <p className="flex items-center justify-center gap-1.5 text-brand-primary font-medium">
              <Flame className="w-4 h-4" /> سلسلتك الآن {toArabicDigits(streakAfter)} يوم
            </p>
          )}
          {earned.length > 0 && (
            <div role="status" className="rounded-xl bg-brand-accent/10 border border-brand-accent/30 p-3 space-y-1" data-testid="new-badges">
              <p className="text-sm font-medium text-text-primary">وسام جديد!</p>
              {earned.map((b) => <p key={b.id} className="text-sm"><span className="text-xl align-middle">{b.icon}</span> {b.nameAr}</p>)}
            </div>
          )}
          <Button onClick={onFinish}>العودة إلى اليوم</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-5">
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>جلسة المراجعة</CardTitle>
          <span className="text-sm text-text-secondary">
            {toArabicDigits(index + 1)} من {toArabicDigits(items.length)}
          </span>
        </div>
        <div className="w-full bg-surface-canvas rounded-full h-2 mt-2" aria-hidden="true">
          <div className="bg-brand-primary h-2 rounded-full transition-all" style={{ width: `${(index / items.length) * 100}%` }} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="text-center space-y-2 py-4">
          <Badge variant={current.reason === 'sabaq' ? 'green' : current.reason === 'manzil' ? 'amber' : 'info'} size="sm">
            {REASON_LABELS[current.reason]}
          </Badge>
          <p className="font-heading text-3xl font-bold text-text-primary">{formatAyahRef(current.card.ayahRef)}</p>
          <p className="text-text-secondary text-sm max-w-md mx-auto">
            سمّعي الآية من حفظك أولاً، ثم أظهري نصها للتحقق، واختاري كيف كان تسميعك.
          </p>
          {showVerse ? (
            <div className="rounded-xl border border-divider bg-surface-canvas p-4 max-w-2xl mx-auto">
              <VerseText refs={[current.card.ayahRef]} />
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowVerse(true)}>أظهري الآية للتحقق</Button>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2" role="alert">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {RATINGS.map((r) => (
            <Button key={r.value} variant={r.variant} disabled={saving} onClick={() => rate(r.value)} className="flex-col h-auto py-3">
              <span className="font-bold">{r.label}</span>
              <span className="text-xs opacity-80">{r.hint}</span>
            </Button>
          ))}
        </div>

        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={onFinish} disabled={saving}>إنهاء الجلسة الآن</Button>
        </div>
      </CardContent>
    </Card>
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

function MushafTab({ onReview }: { onReview?: () => void }) {
  return (
    <div className="space-y-4">
      <SessionTypePicker onNew={() => undefined} onReview={onReview} />
      <MushafReader />
    </div>
  );
}

function ProgressTab() {
  const badgesQuery = useQuery({ queryKey: queryKeys.badges, queryFn: () => api.getBadges().then((r) => r.data) });
  const badges: BadgeProgress[] = badgesQuery.data ?? [];
  const earned = badges.filter(b => b.earned);
  const locked = badges.filter(b => !b.earned).sort((a, b) => b.progress.current / b.progress.target - a.progress.current / a.progress.target);

  return (
    <div className="space-y-4">
      <PreviewNotice>خريطة الإتقان أدناه مثال توضيحي؛ تُفعَّل في مرحلة قادمة. أما الأوسمة فحقيقية.</PreviewNotice>
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
          {badgesQuery.isLoading && <Spinner />}
          {badgesQuery.isError && <LoadError message="تعذّر تحميل الأوسمة." onRetry={() => badgesQuery.refetch()} />}
          <div className="mb-4">
            <h4 className="text-sm font-medium text-text-secondary mb-3">مكتسبة ({toArabicDigits(earned.length)})</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {earned.map(b => (
                <div key={b.id} className="flex flex-col items-center gap-2 p-3 rounded-xl bg-brand-accent/5 border border-brand-accent/20">
                  <span className="text-3xl">{b.icon}</span>
                  <span className="text-xs font-medium text-text-primary text-center">{b.nameAr}</span>
                  <span className="text-[10px] text-text-muted">{b.earnedAt ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date(b.earnedAt)) : ''}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium text-text-secondary mb-3">قادمة ({toArabicDigits(locked.length)})</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {locked.map(b => (
                <div key={b.id} className="flex flex-col items-center gap-2 p-3 rounded-xl bg-surface-canvas border border-divider opacity-50">
                  <span className="text-3xl grayscale">{b.icon}</span>
                  <span className="text-xs font-medium text-text-muted text-center">{b.nameAr}</span>
                  <span className="text-[10px] text-text-muted tabular-nums" title={b.descriptionAr}>
                    {toArabicDigits(b.progress.current)} / {toArabicDigits(b.progress.target)}
                  </span>
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
