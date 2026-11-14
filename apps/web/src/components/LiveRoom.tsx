'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@itqan/ui';
import { Circle, Hand, Mic, MicOff, MonitorUp, PhoneOff, Send, Square, Video, VideoOff } from 'lucide-react';
import type { Room, RemoteTrack, Track as LkTrack } from 'livekit-client';
import { api, errorMessage, homeFor, queryKeys, type LiveSession } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatAyahRange, toArabicDigits } from '@/lib/quran';
import { VerseText } from '@/components/VerseText';
import { canRecordLesson, startLessonRecorder, type LessonRecorder } from '@/lib/lesson-recorder';

type Phase = 'lobby' | 'connecting' | 'live' | 'ended' | 'failed';

/**
 * The room of a live lesson. The teacher hosts: her voice, and her screen or camera if she shares them.
 * Students listen, write questions, and raise a hand to be given the microphone. Nobody's camera but the
 * teacher's is ever offered.
 */
export function LiveRoom({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('lobby');
  const [role, setRole] = useState<'host' | 'listener'>('listener');
  const [session, setSession] = useState<LiveSession | null>(null);
  const [problem, setProblem] = useState('');
  const [mic, setMic] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [camera, setCamera] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [question, setQuestion] = useState('');
  /** The browser is holding the sound back until she taps something. */
  const [soundBlocked, setSoundBlocked] = useState(false);

  /** The host's choice in the lobby: record the lesson and share it with the halaqa. */
  const [wantRecording, setWantRecording] = useState(true);
  const [recordingNote, setRecordingNote] = useState('');
  const recorder = useRef<LessonRecorder | null>(null);
  const [recordingHere, setRecordingHere] = useState(false);

  const room = useRef<Room | null>(null);
  const stage = useRef<HTMLVideoElement>(null);
  /** Players for the voices in the room. They are not placed in the page: a detached audio element plays fine,
   *  and this way a voice that arrives while the room screen is still being drawn is not lost. */
  const audios = useRef(new Map<LkTrack, HTMLMediaElement>());
  const [voices, setVoices] = useState(0);
  /** The video on stage: a screen share wins over a camera. */
  const videos = useRef<{ track: LkTrack; screen: boolean }[]>([]);

  const showVideo = useCallback(() => {
    const el = stage.current;
    if (!el) return;
    const best = videos.current.find((v) => v.screen) ?? videos.current[0];
    for (const v of videos.current) if (v !== best) v.track.detach(el);
    if (best) best.track.attach(el);
    setHasVideo(Boolean(best));
  }, []);

  const state = useQuery({
    queryKey: queryKeys.liveState(sessionId),
    queryFn: () => api.getLiveState(sessionId).then((r) => r.data),
    enabled: phase === 'live' || phase === 'lobby',
    refetchInterval: phase === 'live' ? 3000 : false,
  });
  const info = session ?? state.data?.session ?? null;
  const canSpeak = role === 'host' || (state.data?.me.canSpeak ?? false);

  /** Stops the recording in this browser, sends what is left, and closes it on the server. */
  const stopRecording = useCallback(async () => {
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    setRecordingHere(false);
    // Sending the last piece is given a little time, not forever: ending the lesson must not hang on a dead
    // connection, and the server closes the recording with what it has.
    const done = await Promise.race([rec.stop(), new Promise<null>((r) => setTimeout(() => r(null), 20_000))]);
    await api.finishLiveRecording(sessionId, done?.durationMs).catch(() => undefined);
    queryClient.invalidateQueries({ queryKey: ['live'] });
  }, [sessionId, queryClient]);

  const leave = useCallback(async (next: Phase) => {
    await stopRecording();
    const r = room.current;
    room.current = null;
    videos.current = [];
    audios.current.forEach((el, track) => { track.detach(el); });
    audios.current.clear();
    setVoices(0);
    setMic(false); setSharing(false); setCamera(false); setHasVideo(false);
    if (r) await r.disconnect().catch(() => undefined);
    setPhase(next);
  }, []);

  // The lesson was ended by the teacher (or the room closed): leave for everyone.
  useEffect(() => {
    if (phase === 'live' && state.data?.session.status === 'ended') void leave('ended');
  }, [phase, state.data?.session.status, leave]);

  // The microphone was taken back: stop sending.
  useEffect(() => {
    if (phase === 'live' && role === 'listener' && !canSpeak && mic) {
      void room.current?.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      setMic(false);
    }
  }, [phase, role, canSpeak, mic]);

  useEffect(() => () => {
    const rec = recorder.current;
    recorder.current = null;
    if (rec) void rec.stop().then(({ durationMs }) => api.finishLiveRecording(sessionId, durationMs)).catch(() => undefined);
    void room.current?.disconnect();
  }, [sessionId]);

  /** Starts recording this lesson from the host's browser. */
  async function record(r: Room, current: LiveSession) {
    if (current.recordingStatus === 'recording') {
      // She was recording and the page was reloaded: what was sent before is kept as the recording.
      await api.finishLiveRecording(sessionId).catch(() => undefined);
      setRecordingNote('انقطع التسجيل عند إعادة فتح الصفحة. حُفظ ما سُجّل قبل ذلك.');
      return;
    }
    if (current.recordingStatus || !wantRecording) return;
    if (!canRecordLesson()) { setRecordingNote('هذا المتصفح لا يدعم تسجيل الدرس. استخدمي Chrome أو Edge على حاسوب.'); return; }
    try {
      await api.startLiveRecording(sessionId);
      const lk = await import('livekit-client');
      recorder.current = startLessonRecorder({
        title: current.title,
        stage: () => stage.current,
        microphone: () => r.localParticipant.getTrackPublication(lk.Track.Source.Microphone)?.track?.mediaStreamTrack ?? null,
        send: (seq, piece) => api.sendLiveRecordingChunk(sessionId, seq, piece),
        onFailure: (reason) => {
          setRecordingNote(reason === 'upload'
            ? 'توقف التسجيل: تعذّر إرسال التسجيل إلى الخادم أو بلغ حدّه الأقصى. الدرس مستمر، وحُفظ ما أُرسل.'
            : 'توقف التسجيل في هذا المتصفح. الدرس مستمر، وحُفظ ما أُرسل.');
          void stopRecording();
        },
      });
      setRecordingHere(true);
      queryClient.invalidateQueries({ queryKey: queryKeys.liveState(sessionId) });
    } catch (err) {
      recorder.current = null;
      setRecordingNote(errorMessage(err, 'لم يبدأ تسجيل الدرس. الدرس مستمر بلا تسجيل.'));
    }
  }

  async function enter() {
    setPhase('connecting');
    setProblem('');
    try {
      const { data } = await api.joinLive(sessionId);
      const lk = await import('livekit-client');
      const r = new lk.Room({ adaptiveStream: true, dynacast: true });
      room.current = r;
      setRole(data.role);
      setSession(data.session);

      r.on(lk.RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === lk.Track.Kind.Audio) {
          audios.current.set(track, track.attach());
          setVoices(audios.current.size);
        } else {
          videos.current.push({ track, screen: track.source === lk.Track.Source.ScreenShare });
          showVideo();
        }
      });
      r.on(lk.RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach();
        if (audios.current.delete(track)) setVoices(audios.current.size);
        videos.current = videos.current.filter((v) => v.track !== track);
        showVideo();
      });
      r.on(lk.RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.track && pub.kind === lk.Track.Kind.Video) {
          videos.current.push({ track: pub.track, screen: pub.source === lk.Track.Source.ScreenShare });
          showVideo();
        }
      });
      r.on(lk.RoomEvent.LocalTrackUnpublished, (pub) => {
        videos.current = videos.current.filter((v) => v.track !== pub.track);
        if (pub.source === lk.Track.Source.ScreenShare) setSharing(false);
        if (pub.source === lk.Track.Source.Camera) setCamera(false);
        showVideo();
      });
      r.on(lk.RoomEvent.AudioPlaybackStatusChanged, () => setSoundBlocked(!r.canPlaybackAudio));
      r.on(lk.RoomEvent.Disconnected, () => { if (room.current === r) void leave('ended'); });

      await r.connect(data.url, data.token);
      await r.startAudio().catch(() => undefined);
      setSoundBlocked(!r.canPlaybackAudio);
      setPhase('live');
      if (data.role === 'host') {
        // The teacher starts with her microphone on. Entering does not wait for it: a slow or refused
        // microphone leaves her in the room, muted, with a message.
        void r.localParticipant.setMicrophoneEnabled(true)
          .then(() => { if (room.current === r) setMic(true); })
          .catch(() => setProblem('لم نتمكن من فتح الميكروفون. تحققي من إذن المتصفح.'));
        void record(r, data.session);
      }
    } catch (err) {
      room.current = null;
      setProblem(errorMessage(err, 'تعذّر الدخول إلى الدرس. حاولي مرة أخرى.'));
      setPhase('failed');
    }
  }

  const toggleMic = async () => {
    try { await room.current?.localParticipant.setMicrophoneEnabled(!mic); setMic(!mic); setProblem(''); }
    catch { setProblem('لم نتمكن من فتح الميكروفون. تحققي من إذن المتصفح.'); }
  };
  const toggleShare = async () => {
    try { await room.current?.localParticipant.setScreenShareEnabled(!sharing); setSharing(!sharing); setProblem(''); }
    catch { setProblem('لم تبدأ مشاركة الشاشة. مشاركة الشاشة تحتاج حاسوباً، لا هاتفاً.'); }
  };
  const toggleCamera = async () => {
    try { await room.current?.localParticipant.setCameraEnabled(!camera); setCamera(!camera); setProblem(''); }
    catch { setProblem('لم نتمكن من فتح الكاميرا. تحققي من إذن المتصفح.'); }
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.liveState(sessionId) });
  const hand = useMutation({ mutationFn: (raised: boolean) => api.setLiveHand(sessionId, raised), onSuccess: refresh });
  const speak = useMutation({
    mutationFn: (v: { userId: string; canSpeak: boolean }) => api.setLiveSpeak(sessionId, v.userId, v.canSpeak),
    onSuccess: refresh,
  });
  const ask = useMutation({ mutationFn: () => api.askLive(sessionId, question.trim()), onSuccess: () => { setQuestion(''); refresh(); } });
  const answer = useMutation({ mutationFn: (id: string) => api.answerLive(sessionId, id, true), onSuccess: refresh });
  const end = useMutation({
    // The recording is closed first, so its last seconds are in it when the lesson ends.
    mutationFn: async () => { await stopRecording(); return api.endLive(sessionId); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['live'] }); void leave('ended'); },
  });

  const home = () => router.push(user ? homeFor(user.role) : '/');
  const verses = info?.startRef && info.endRef ? { start: info.startRef, end: info.endRef } : null;

  if (phase !== 'live') {
    const ended = phase === 'ended' || state.data?.session.status === 'ended';
    return (
      <main dir="rtl" className="min-h-screen bg-surface-canvas flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader><CardTitle>{info?.title ?? 'درس مباشر'}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {state.isError && phase === 'lobby' ? (
              <p role="alert" className="text-sm text-red-800">هذا الدرس غير متاح لكِ، أو أنه غير موجود.</p>
            ) : ended ? (
              <p className="text-sm text-text-secondary" data-testid="live-ended">انتهى الدرس. بارك الله فيكِ.</p>
            ) : (
              <>
                {verses && <p className="text-sm text-text-secondary">{formatAyahRange(verses.start, verses.end)}</p>}
                <p className="text-sm text-text-secondary">
                  {state.data?.role === 'host'
                    ? 'تدخلين معلمةً للدرس: يُفتح ميكروفونكِ عند الدخول، وتشاركين شاشتكِ متى شئتِ.'
                    : 'تدخلين مستمعةً: ميكروفونكِ مغلق ولا تُعرض كاميرتكِ. يمكنكِ كتابة سؤال أو رفع يدكِ لتأذن لكِ المعلمة بالكلام.'}
                </p>
                {state.data?.role === 'host' ? !state.data.session.recordingStatus && (
                  <label className="flex items-start gap-2 text-sm">
                    <input id="live-record" type="checkbox" className="mt-1" checked={wantRecording} onChange={(e) => setWantRecording(e.target.checked)} />
                    <span>
                      سجّلي الدرس وشاركيه مع الحلقة
                      <span className="block text-xs text-text-secondary">يُسجَّل صوتكِ وما تعرضينه فقط، ولا تُسجَّل أصوات الطالبات. أبقي هذه الصفحة مفتوحة حتى نهاية الدرس.</span>
                    </span>
                  </label>
                ) : (
                  <p className="text-xs text-text-secondary">قد تسجّل المعلمة الدرس لتشاهده الحلقة لاحقاً: يُسجَّل صوتها وشاشتها فقط، ولا يُسجَّل صوتكِ.</p>
                )}
                <Button className="w-full" onClick={enter} loading={phase === 'connecting'} disabled={state.isLoading}>دخول الدرس</Button>
              </>
            )}
            {problem && <p role="alert" className="text-sm text-red-800">{problem}</p>}
            <Button variant="ghost" className="w-full" onClick={home}>العودة</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const s = state.data;
  const hands = s?.participants.filter((p) => p.handRaised) ?? [];
  const speaking = s?.participants.filter((p) => p.canSpeak) ?? [];
  const open = s?.questions.filter((q) => !q.answeredAt) ?? [];

  return (
    <main dir="rtl" className="min-h-screen bg-surface-canvas p-3 sm:p-4 overflow-x-hidden" data-testid="live-room" data-voices={voices}>
      <header className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <h1 className="font-heading text-lg font-bold text-text-primary truncate">{info?.title}</h1>
          <p className="text-xs text-text-secondary">
            <Badge variant="red" size="sm">مباشر</Badge> {toArabicDigits(s?.attending ?? 0)} طالبة حاضرة
            {(recordingHere || s?.session.recordingStatus === 'recording') && (
              <span className="mr-2 inline-flex items-center gap-1 text-red-700" data-testid="live-recording">
                <Circle className="w-2.5 h-2.5 fill-current" /> يُسجَّل
              </span>
            )}
          </p>
        </div>
        {role === 'host' ? (
          <Button variant="danger" size="sm" loading={end.isPending}
            onClick={() => { if (window.confirm('إنهاء الدرس لجميع الطالبات؟')) end.mutate(); }}>
            <PhoneOff className="w-4 h-4 ml-1" /> إنهاء الدرس
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => { void leave('lobby'); home(); }}>مغادرة</Button>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <section className="lg:col-span-2 space-y-3 min-w-0">
          <div className="relative rounded-2xl bg-black overflow-hidden aspect-video">
            {/* The teacher's own share is muted here so she does not hear herself. */}
            <video ref={stage} autoPlay playsInline muted={role === 'host'} className="absolute inset-0 w-full h-full object-contain" data-testid="live-stage" />
            {!hasVideo && (
              <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-white/80 text-sm">
                {role === 'host' ? 'طالباتكِ يسمعنكِ الآن. شاركي شاشتكِ لعرض المصحف.' : 'تستمعين إلى المعلمة. ستظهر شاشتها هنا إذا شاركتها.'}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2" data-testid="live-controls">
            {canSpeak && (
              <Button variant={mic ? 'primary' : 'outline'} onClick={toggleMic} aria-pressed={mic}>
                {mic ? <Mic className="w-4 h-4 ml-1" /> : <MicOff className="w-4 h-4 ml-1" />}
                {mic ? 'الميكروفون مفتوح' : role === 'host' ? 'افتحي الميكروفون' : 'تحدّثي الآن'}
              </Button>
            )}
            {role === 'host' && (
              <>
                <Button variant={sharing ? 'primary' : 'outline'} onClick={toggleShare} aria-pressed={sharing}>
                  <MonitorUp className="w-4 h-4 ml-1" /> {sharing ? 'إيقاف مشاركة الشاشة' : 'مشاركة الشاشة'}
                </Button>
                <Button variant={camera ? 'primary' : 'outline'} onClick={toggleCamera} aria-pressed={camera}>
                  {camera ? <Video className="w-4 h-4 ml-1" /> : <VideoOff className="w-4 h-4 ml-1" />} {camera ? 'إيقاف الكاميرا' : 'الكاميرا'}
                </Button>
                {recordingHere && (
                  <Button variant="outline" onClick={() => {
                    if (window.confirm('إيقاف التسجيل؟ لا يمكن استئنافه في هذا الدرس.')) void stopRecording().then(() => setRecordingNote('أُوقف التسجيل وحُفظ.'));
                  }}>
                    <Square className="w-4 h-4 ml-1" /> إيقاف التسجيل
                  </Button>
                )}
              </>
            )}
            {role === 'listener' && user?.role === 'student' && !canSpeak && (
              <Button variant={s?.me.handRaised ? 'primary' : 'outline'} loading={hand.isPending} aria-pressed={s?.me.handRaised}
                onClick={() => hand.mutate(!s?.me.handRaised)}>
                <Hand className="w-4 h-4 ml-1" /> {s?.me.handRaised ? 'يدكِ مرفوعة — أنزليها' : 'ارفعي يدكِ'}
              </Button>
            )}
          </div>
          {soundBlocked && (
            <Button className="w-full" onClick={() => { void room.current?.startAudio().then(() => setSoundBlocked(false)).catch(() => undefined); }}>
              اضغطي لتشغيل الصوت
            </Button>
          )}
          {role === 'listener' && canSpeak && <p role="status" className="text-sm text-brand-primary">أذنت لكِ المعلمة بالكلام.</p>}
          {problem && <p role="alert" className="text-sm text-red-800">{problem}</p>}
          {recordingNote && <p role="status" className="text-sm text-text-secondary" data-testid="live-recording-note">{recordingNote}</p>}

          {verses && (
            <details className="rounded-2xl border border-divider bg-surface-elevated p-3">
              <summary className="cursor-pointer text-sm font-medium">{formatAyahRange(verses.start, verses.end)}</summary>
              <div className="mt-3 max-h-64 overflow-y-auto"><VerseText start={verses.start} end={verses.end} /></div>
            </details>
          )}
        </section>

        <aside className="space-y-3 min-w-0">
          {role === 'host' && (
            <Card>
              <CardHeader><CardTitle className="text-base">الحاضرات ({toArabicDigits(s?.participants.length ?? 0)})</CardTitle></CardHeader>
              <CardContent>
                {hands.length === 0 && speaking.length === 0 && <p className="text-sm text-text-secondary">لا أيدٍ مرفوعة.</p>}
                <ul className="space-y-2" data-testid="live-hands">
                  {[...speaking, ...hands.filter((h) => !h.canSpeak)].map((p) => (
                    <li key={p.userId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-1.5">
                        {p.canSpeak ? <Mic className="w-4 h-4 text-brand-primary" /> : <Hand className="w-4 h-4 text-state-attention" />}{p.name}
                      </span>
                      <Button size="sm" variant={p.canSpeak ? 'outline' : 'primary'} disabled={speak.isPending}
                        onClick={() => speak.mutate({ userId: p.userId, canSpeak: !p.canSpeak })}>
                        {p.canSpeak ? 'إنهاء الإذن' : 'اسمحي بالكلام'}
                      </Button>
                    </li>
                  ))}
                </ul>
                {speak.isError && <p role="alert" className="mt-2 text-sm text-red-800">{errorMessage(speak.error, 'الطالبة غير متصلة الآن.')}</p>}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">الأسئلة {open.length > 0 && `(${toArabicDigits(open.length)})`}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(s?.questions.length ?? 0) === 0 ? (
                <p className="text-sm text-text-secondary">لا أسئلة بعد.</p>
              ) : (
                <ul className="space-y-2 max-h-72 overflow-y-auto" data-testid="live-questions">
                  {s!.questions.map((q) => (
                    <li key={q.id} className={`rounded-xl bg-surface-canvas px-3 py-2 text-sm ${q.answeredAt ? 'opacity-60' : ''}`}>
                      <p className="text-xs text-text-secondary">{q.mine ? 'أنتِ' : q.name}{q.answeredAt && ' · أُجيب'}</p>
                      <p className="whitespace-pre-wrap">{q.text}</p>
                      {role === 'host' && !q.answeredAt && (
                        <button type="button" className="mt-1 text-xs text-brand-primary underline" onClick={() => answer.mutate(q.id)}>تمت الإجابة</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {role === 'listener' && (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (question.trim()) ask.mutate(); }}>
                  <input id="live-question" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} placeholder="اكتبي سؤالكِ"
                    className="min-w-0 flex-1 rounded-xl border border-divider bg-surface-elevated px-3 py-2 text-sm" />
                  <Button type="submit" size="sm" loading={ask.isPending} disabled={!question.trim()} aria-label="إرسال السؤال"><Send className="w-4 h-4" /></Button>
                </form>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
