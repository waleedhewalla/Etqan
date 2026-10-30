'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { AYAH_COUNTS } from '@itqan/quran';
import { api, errorMessage, queryKeys, type ConsentPurpose, type TasmiSubmission } from '@/lib/api';
import { formatAyahRange, SURAH_NAMES, toArabicDigits } from '@/lib/quran';
import { VerseText } from '@/components/VerseText';
import { RecitationRecorder, type Recording } from '@/components/RecitationRecorder';
import { TasmiAudio } from '@/components/TasmiAudio';
import { FlaggedVerse } from '@/components/FlaggedVerse';
import { LoadError, Spinner } from '@/components/LoadState';

const MAX_AYAT = 60;

const VERDICT: Record<string, { label: string; tone: string }> = {
  approved: { label: 'مقبول', tone: 'bg-green-50 text-green-800' },
  redo: { label: 'أعيدي التسميع', tone: 'bg-amber-50 text-amber-900' },
  flagged: { label: 'عند الشيخة للمراجعة', tone: 'bg-red-50 text-red-800' },
};

/** Student records a recitation for her teacher and sees her earlier submissions. */
export function ReciteTab() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: () => api.getMe().then((r) => r.data) });
  const voice = useQuery({ queryKey: queryKeys.voiceStatus, queryFn: () => api.getVoiceStatus().then((r) => r.data) });
  const mine = useQuery({
    queryKey: queryKeys.myTasmi,
    queryFn: () => api.getMyTasmi().then((r) => r.data),
    refetchOnMount: 'always',
    // while an automatic check is running, look again every few seconds
    refetchInterval: (q) => (q.state.data?.some((t) => t.aiStatus === 'pending' || t.aiStatus === 'processing') ? 3000 : false),
  });

  const [sectionId, setSectionId] = useState('');
  const [sura, setSura] = useState(114);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(6);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [recorderKey, setRecorderKey] = useState(0);
  const [showVerses, setShowVerses] = useState(false);
  const [sent, setSent] = useState(false);

  const sections = me.data?.sections ?? [];
  const section = sectionId || sections[0]?.id || '';
  const hasConsent = me.data?.consents.includes('voice_recording') ?? false;
  const aiOn = voice.data?.enabled ?? false;
  const hasAiConsent = me.data?.consents.includes('ai_processing') ?? false;
  const [withAi, setWithAi] = useState(true);
  const count = AYAH_COUNTS[sura - 1];
  const invalidRange = to < from || to - from + 1 > MAX_AYAT;

  const grant = useMutation({
    mutationFn: (purposes: ConsentPurpose[]) => api.setConsents([...new Set([...(me.data?.consents ?? []), ...purposes])]),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  });

  const send = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('startRef', `${sura}:${from}`);
      form.append('endRef', `${sura}:${to}`);
      form.append('sectionId', section);
      form.append('durationMs', String(recording!.durationMs));
      const ext = recording!.blob.type.includes('mp4') ? 'm4a' : recording!.blob.type.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', recording!.blob, `recitation.${ext}`);
      return api.uploadTasmi(form);
    },
    onSuccess: () => {
      setSent(true);
      setRecording(null);
      setRecorderKey((k) => k + 1);
      queryClient.invalidateQueries({ queryKey: queryKeys.myTasmi });
    },
  });

  const dispute = useMutation({
    mutationFn: ({ id, flagId }: { id: string; flagId: string }) => api.disputeFlag(id, flagId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.myTasmi }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTasmiAudio(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.myTasmi }),
  });

  const setNumber = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Math.floor(Number(e.target.value));
    if (n >= 1 && n <= count) { set(n); setSent(false); }
  };

  if (me.isLoading) return <Spinner />;
  if (me.isError) return <LoadError message="تعذّر تحميل بياناتك." onRetry={() => me.refetch()} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>سمّعي لمعلمتكِ</CardTitle>
          <CardDescription>اختاري المقطع الذي ستسمّعينه، ثم سجّلي صوتكِ. تستمع إليه معلمتكِ وحدها.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sections.length === 0 ? (
            <p className="text-sm text-text-secondary">لستِ في حلقة بعد. اطلبي كود الحلقة من معلمتكِ.</p>
          ) : !hasConsent ? (
            <div className="rounded-xl border border-divider bg-surface-canvas p-4 space-y-3">
              <p className="text-sm">
                لتسجيل صوتكِ نحتاج موافقتكِ. يُحفظ التسجيل بشكل خاص، وتسمعه معلمتكِ ومسؤولو مؤسستكِ فقط،
                ويمكنكِ حذفه في أي وقت. يمكنكِ سحب الموافقة من صفحة «حسابي».
              </p>
              {aiOn && (
                <label className="flex items-start gap-2 text-sm">
                  <input id="consent-ai" type="checkbox" checked={withAi} onChange={(e) => setWithAi(e.target.checked)} className="mt-1" />
                  <span>
                    أسمح بفحصٍ آلي أولي لتسجيلي (اختياري). يضع علامات على الكلمات لمعلمتي فقط، ولا يُحتسب كدرجة،
                    ويمكنني الاعتراض على أي علامة. يُرسل التسجيل إلى خدمة التفريغ الصوتي لهذا الغرض.
                  </span>
                </label>
              )}
              <Button onClick={() => grant.mutate(['voice_recording', ...(aiOn && withAi ? ['ai_processing' as const] : [])])} loading={grant.isPending}>
                أوافق على تسجيل صوتي
              </Button>
              {grant.isError && <p role="alert" className="text-sm text-red-800">{errorMessage(grant.error)}</p>}
            </div>
          ) : (
            <>
              {aiOn && !hasAiConsent && (
                <div className="rounded-xl border border-divider bg-surface-canvas p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
                  <span>يمكنكِ السماح بفحصٍ آلي أولي يساعد معلمتكِ (اختياري، ولا يُحتسب كدرجة).</span>
                  <Button size="sm" variant="outline" loading={grant.isPending} onClick={() => grant.mutate(['ai_processing'])}>أسمح بالفحص الآلي</Button>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-3">
                {sections.length > 1 && (
                  <label className="text-sm">
                    <span className="block text-text-secondary mb-1">الحلقة</span>
                    <select id="recite-section" value={section} onChange={(e) => setSectionId(e.target.value)}
                      className="rounded-xl border border-divider bg-surface-elevated px-3 py-2">
                      {sections.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
                    </select>
                  </label>
                )}
                <label className="text-sm">
                  <span className="block text-text-secondary mb-1">السورة</span>
                  <select id="recite-sura" value={sura}
                    onChange={(e) => { const n = Number(e.target.value); setSura(n); setFrom(1); setTo(Math.min(AYAH_COUNTS[n - 1], 5)); setSent(false); }}
                    className="rounded-xl border border-divider bg-surface-elevated px-3 py-2 min-w-[10rem]">
                    {SURAH_NAMES.map((name, i) => <option key={name} value={i + 1}>{toArabicDigits(i + 1)}. {name}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="block text-text-secondary mb-1">من الآية</span>
                  <input id="recite-from" type="number" min={1} max={count} value={from} onChange={setNumber(setFrom)}
                    className="w-20 rounded-xl border border-divider bg-surface-elevated px-3 py-2" />
                </label>
                <label className="text-sm">
                  <span className="block text-text-secondary mb-1">إلى الآية</span>
                  <input id="recite-to" type="number" min={1} max={count} value={to} onChange={setNumber(setTo)}
                    className="w-20 rounded-xl border border-divider bg-surface-elevated px-3 py-2" />
                </label>
              </div>

              {invalidRange && (
                <p role="alert" className="text-sm text-red-800">
                  {to < from ? 'آية النهاية قبل آية البداية.' : `يمكن تسجيل ${toArabicDigits(MAX_AYAT)} آية كحدٍّ أقصى.`}
                </p>
              )}

              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowVerses((v) => !v)}>
                  {showVerses ? 'إخفاء الآيات' : 'أظهري الآيات'}
                </Button>
                {showVerses && !invalidRange && (
                  <div className="mt-3 rounded-xl border border-divider bg-surface-canvas p-4 max-h-56 overflow-y-auto">
                    <VerseText start={`${sura}:${from}`} end={`${sura}:${to}`} />
                  </div>
                )}
              </div>

              <RecitationRecorder key={recorderKey} onChange={(r) => { setRecording(r); setSent(false); }} disabled={send.isPending} />

              {recording && (
                <Button onClick={() => send.mutate()} loading={send.isPending} disabled={invalidRange}>
                  إرسال إلى المعلمة
                </Button>
              )}
              {send.isError && <p role="alert" className="text-sm rounded-lg px-3 py-2 bg-red-50 text-red-800">{errorMessage(send.error, 'لم يُرسل التسجيل.')}</p>}
              {sent && <p role="status" className="text-sm rounded-lg px-3 py-2 bg-green-50 text-green-800">وصل تسميعكِ إلى معلمتكِ. جزاكِ الله خيراً.</p>}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>تسميعاتي</CardTitle></CardHeader>
        <CardContent>
          {mine.isLoading ? <Spinner /> : mine.isError ? (
            <LoadError message="تعذّر تحميل تسميعاتكِ." onRetry={() => mine.refetch()} />
          ) : (mine.data ?? []).length === 0 ? (
            <p className="text-sm text-text-secondary">لا توجد تسميعات بعد.</p>
          ) : (
            <ul className="divide-y divide-divider">
              {mine.data!.map((t) => (
                <li key={t.id} className="py-3 space-y-2" data-testid="my-tasmi">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-medium">{formatAyahRange(t.startRef, t.endRef)}</span>
                    {t.reviewVerdict ? (
                      <Badge className={VERDICT[t.reviewVerdict].tone}>{VERDICT[t.reviewVerdict].label}</Badge>
                    ) : (
                      <Badge>بانتظار المعلمة</Badge>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary">
                    {new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t.submittedAt))}
                    {t.reviewWeightedTotal != null && ` · الدرجة ${toArabicDigits(Math.round(t.reviewWeightedTotal))}`}
                  </p>
                  {t.reviewNotes && <p className="text-sm rounded-lg bg-surface-canvas px-3 py-2">{t.reviewNotes}</p>}
                  <AiResult
                    t={t}
                    onDispute={(flagId) => dispute.mutate({ id: t.id, flagId })}
                    busy={dispute.isPending}
                  />
                  <div className="flex items-center gap-3 flex-wrap">
                    <TasmiAudio id={t.id} hasAudio={t.hasAudio} />
                    {t.hasAudio && (
                      <Button variant="ghost" size="sm" loading={remove.isPending && remove.variables === t.id}
                        onClick={() => { if (window.confirm('حذف هذا التسجيل نهائياً؟ تبقى درجتكِ وملاحظات معلمتكِ.')) remove.mutate(t.id); }}>
                        حذف التسجيل
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** What the automatic check found, in words the student can act on. */
function AiResult({ t, onDispute, busy }: { t: TasmiSubmission; onDispute: (flagId: string) => void; busy: boolean }) {
  if (t.aiStatus === 'pending' || t.aiStatus === 'processing') {
    return <p role="status" className="text-sm text-text-secondary">جارٍ الفحص الآلي الأولي…</p>;
  }
  if (t.aiStatus === 'unclear') {
    return (
      <p role="note" className="text-sm rounded-lg px-3 py-2 bg-amber-50 text-amber-900">
        لم نسمع تسجيلكِ بوضوح كافٍ للفحص الآلي. إن أردتِ، أعيدي التسجيل في مكان أهدأ وقرّبي الجهاز منكِ. ستستمع معلمتكِ إلى هذا التسجيل على أي حال.
      </p>
    );
  }
  if (t.aiStatus !== 'done') return null;

  if (t.aiFlaggedErrors.length === 0) {
    return <p className="text-sm text-text-secondary">لم يجد الفحص الآلي ملاحظات. القرار لمعلمتكِ.</p>;
  }
  return (
    <details className="text-sm" open={!t.reviewVerdict}>
      <summary className="cursor-pointer font-medium">الفحص الآلي الأولي: {toArabicDigits(t.aiFlaggedErrors.length)} ملاحظة</summary>
      <div className="mt-2 space-y-2">
        <FlaggedVerse
          start={t.startRef}
          end={t.endRef}
          flags={t.aiFlaggedErrors}
          onDispute={t.reviewVerdict ? undefined : onDispute}
          disputeBusy={busy}
        />
        <p className="text-xs text-text-secondary">قد يُخطئ الفحص الآلي. إن رأيتِ علامةً خاطئة فاضغطي «أعترض» لتنظر فيها معلمتكِ أولاً. القرار والدرجة لها وحدها.</p>
      </div>
    </details>
  );
}
