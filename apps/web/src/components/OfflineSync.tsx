'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CloudOff, RefreshCw } from 'lucide-react';
import { api, queryKeys } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getOfflineStore } from '@/lib/offline';
import { toArabicDigits } from '@/lib/quran';

/** Event the review session fires when it queues a review, so the banner updates at once. */
export const OFFLINE_CHANGED = 'itqan:offline-changed';

/**
 * Tells the student when she has no connection, how many reviews are waiting, and sends them as soon as the
 * connection is back (and every half minute while some are still waiting).
 */
export function OfflineSync() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(true);
  const [waiting, setWaiting] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState<number | null>(null);
  const busy = useRef(false);
  const userId = user?.id;

  const count = useCallback(async () => {
    const store = getOfflineStore();
    if (store && userId) setWaiting(await store.pendingCount(userId).catch(() => 0));
  }, [userId]);

  const flush = useCallback(async () => {
    const store = getOfflineStore();
    if (!store || !userId || busy.current) return;
    if ((await store.pendingCount(userId)) === 0) return;
    busy.current = true;
    setSyncing(true);
    try {
      const out = await store.flush(userId, (reviews) => api.rateBatch(reviews).then((r) => r.data));
      if (out.applied > 0) {
        setSynced(out.applied);
        setTimeout(() => setSynced(null), 6000);
      }
      if (!out.offline) {
        for (const key of [queryKeys.queue, queryKeys.stats, queryKeys.badges, ['weekly']]) queryClient.invalidateQueries({ queryKey: key });
      }
    } catch {
      // The server refused for some other reason; they stay waiting and are tried again later.
    } finally {
      busy.current = false;
      setSyncing(false);
      await count();
    }
  }, [userId, count, queryClient]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => { setOnline(true); void flush(); };
    const goOffline = () => setOnline(false);
    const changed = () => { void count(); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener(OFFLINE_CHANGED, changed);
    void count().then(() => { if (navigator.onLine) void flush(); });
    const timer = setInterval(() => { if (navigator.onLine) void flush(); }, 30_000);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener(OFFLINE_CHANGED, changed);
      clearInterval(timer);
    };
  }, [count, flush]);

  if (online && waiting === 0 && synced === null) return null;

  return (
    <div
      role="status"
      data-testid="offline-banner"
      className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm ${online ? 'bg-brand-primary/10 text-brand-primary' : 'bg-amber-50 text-amber-900'}`}
    >
      {online ? <RefreshCw className={`w-4 h-4 shrink-0 ${syncing ? 'animate-spin' : ''}`} /> : <CloudOff className="w-4 h-4 shrink-0" />}
      <span>
        {!online
          ? <>أنتِ غير متصلة بالإنترنت. يمكنكِ متابعة المراجعة، وتُحفظ مراجعاتكِ على جهازكِ وتُرسل تلقائياً عند عودة الاتصال.{waiting > 0 && <> بانتظار الإرسال: <b>{toArabicDigits(waiting)}</b></>}</>
          : waiting > 0
            ? <>{syncing ? 'جارٍ إرسال' : 'بانتظار إرسال'} <b>{toArabicDigits(waiting)}</b> مراجعة محفوظة على جهازكِ…</>
            : <>تمت مزامنة <b>{toArabicDigits(synced ?? 0)}</b> مراجعة. شكراً لصبركِ.</>}
      </span>
    </div>
  );
}
