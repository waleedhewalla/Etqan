'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { Target } from 'lucide-react';
import { api, errorMessage, queryKeys, type Cluster, type Drill, type DrillResult } from '@/lib/api';
import { formatAyahRef, toArabicDigits } from '@/lib/quran';
import { ClusterCompare } from '@/components/ClusterCompare';
import { EmptyState } from '@/components/EmptyState';
import { LoadError, Spinner } from '@/components/LoadState';

const ROUND = 5;

/**
 * Chooses the next question: a fill-in-the-blank when the verses differ by one word, otherwise "which verse is this?".
 * A cluster that cannot make either (for example verses worded identically) is skipped in favour of another.
 */
async function nextDrill(clusters: Cluster[]): Promise<Drill> {
  const order = [...clusters].sort(() => Math.random() - 0.5);
  for (const cluster of order) {
    const types: Drill['drillType'][] = Math.random() < 0.6 ? ['cloze', 'timed-choice'] : ['timed-choice', 'cloze'];
    for (const type of types) {
      try { return (await api.generateDrill(cluster.id, type)).data; } catch { /* try the other kind, then the next cluster */ }
    }
  }
  throw new Error('no drill');
}

/** A short practice round: a few questions that make her tell look-alike verses apart. */
function Practice({ clusters, onDone }: { clusters: Cluster[]; onDone: () => void }) {
  const [drill, setDrill] = useState<Drill | null>(null);
  const [result, setResult] = useState<DrillResult | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  const [right, setRight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);

  const load = async () => {
    setBusy(true); setError(null); setResult(null); setChosen(null);
    try { setDrill(await nextDrill(clusters)); } catch (err) { setError(errorMessage(err, 'تعذّر تجهيز السؤال.')); }
    finally { setBusy(false); }
  };
  if (!drill && !busy && !error && asked === 0) void load();

  const answer = async (option: string) => {
    if (!drill || result) return;
    setChosen(option);
    try {
      const { data } = await api.answerDrill(drill.id, option);
      setResult(data);
      setAsked((n) => n + 1);
      if (data.wasCorrect) setRight((n) => n + 1);
    } catch (err) { setError(errorMessage(err, 'لم تُحفظ الإجابة.')); }
  };

  if (finished) {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-3">
          <h2 className="font-heading text-xl font-bold">أحسنتِ!</h2>
          <p>أجبتِ {toArabicDigits(right)} من {toArabicDigits(ROUND)} إجابة صحيحة.</p>
          {right < ROUND && <p className="text-sm text-text-secondary">الآيات التي اختلطت عليكِ ستعود إلى مراجعتكِ قريباً.</p>}
          <Button onClick={onDone}>العودة</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>تمرين المتشابهات</CardTitle>
        <CardDescription>السؤال {toArabicDigits(Math.min(asked + (result ? 0 : 1), ROUND))} من {toArabicDigits(ROUND)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {busy && <Spinner />}
        {error && <LoadError message={error} onRetry={load} />}
        {drill && !busy && (
          <>
            <p className="text-sm text-text-secondary">
              {drill.drillType === 'cloze' ? 'اختاري الكلمة الصحيحة في هذه الآية:' : 'من أي موضع هذه الآية؟'}
            </p>
            <p lang="ar" dir="rtl" className="font-quran text-mushaf rounded-xl border border-divider bg-surface-canvas p-4" data-testid="drill-question">{drill.question}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {drill.options.map((o) => {
                const isRight = result && o === result.correctAnswer;
                const isWrong = result && o === chosen && !result.wasCorrect;
                return (
                  <Button key={o} type="button" variant="outline" disabled={Boolean(result)} onClick={() => answer(o)}
                    className={isRight ? 'border-state-positive bg-state-positive/10' : isWrong ? 'border-red-600 bg-red-50' : ''}>
                    <span lang="ar" className={drill.drillType === 'cloze' ? 'font-quran text-xl' : ''}>
                      {drill.drillType === 'timed-choice' ? formatAyahRef(o) : o}
                    </span>
                  </Button>
                );
              })}
            </div>
            {result && (
              <div role="status" className={`rounded-lg px-3 py-2 text-sm ${result.wasCorrect ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                {result.wasCorrect ? 'أحسنتِ، إجابة صحيحة.' : 'ليست هذه. الإجابة الصحيحة ظاهرة بالأخضر.'}
                {result.rescheduled && ' ستعود هذه الآية إلى مراجعتكِ قريباً.'}
              </div>
            )}
            {result && (asked >= ROUND
              ? <Button onClick={() => setFinished(true)}>إنهاء</Button>
              : <Button onClick={load}>السؤال التالي</Button>)}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The student's look-alike verses (those near what she is memorizing), with a practice round. */
export function MutashabihatTrainer() {
  const [practicing, setPracticing] = useState(false);
  const query = useQuery({ queryKey: queryKeys.myClusters, queryFn: () => api.getMyClusters().then((r) => r.data) });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <LoadError onRetry={() => query.refetch()} message="تعذّر تحميل المتشابهات." />;
  const clusters = query.data ?? [];
  const drillable = clusters.filter((c) => c.ayat.every((a) => a.text));

  if (clusters.length === 0) {
    return (
      <EmptyState
        icon={Target}
        title="لا توجد متشابهات لخطتكِ بعد"
        description="تضيف معلمتكِ مجموعات الآيات المتشابهة وتعتمدها معلمة مراجِعة، ثم تظهر هنا إن كانت قريبة مما تحفظينه."
      />
    );
  }
  if (practicing && drillable.length) return <Practice clusters={drillable} onDone={() => setPracticing(false)} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Target className="w-5 h-5" /> المتشابهات</CardTitle>
          <CardDescription>آيات يختلط بعضها ببعض فيما تحفظينه. الكلمات الملوّنة هي موضع الفرق.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button onClick={() => setPracticing(true)} disabled={drillable.length === 0}>ابدئي تمريناً</Button>
          {drillable.length === 0 && <p className="text-sm text-state-attention">نص الآيات غير محمّل على الخادم بعد، فلا يمكن التمرين.</p>}
        </CardContent>
      </Card>
      {clusters.map((c) => (
        <Card key={c.id} data-testid="cluster">
          <CardContent className="pt-4"><ClusterCompare cluster={c} /></CardContent>
        </Card>
      ))}
    </div>
  );
}
