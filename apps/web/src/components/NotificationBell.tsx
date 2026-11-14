'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarClock, X } from 'lucide-react';
import { Button } from '@itqan/ui';
import { api, queryKeys, type AppNotification } from '@/lib/api';
import { toArabicDigits } from '@/lib/quran';
import { useModules } from '@/lib/modules';
import { LoadError, Spinner } from '@/components/LoadState';

const PAGE = 20;
const when = (iso: string) => new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' }).format(new Date(iso));

/** Where a notification leads, if it leads anywhere. */
const hrefOf = (n: AppNotification) => (n.data?.type === 'live_reminder' && n.data.sessionId ? `/live/${n.data.sessionId}` : null);

/**
 * The bell: how many notifications are unread, and the list behind it. A live-lesson reminder opens the lesson.
 * The count is asked for every minute; the list only while the panel is open. Hidden when the institution has
 * switched the notifications module off.
 */
export function NotificationBell() {
  const { isOn } = useModules();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const enabled = isOn('notifications');

  const count = useQuery({
    queryKey: queryKeys.notificationCount,
    queryFn: () => api.getNotificationCount().then((r) => r.data.unread),
    refetchInterval: 60_000,
    enabled,
  });
  const list = useInfiniteQuery({
    queryKey: queryKeys.notificationList,
    queryFn: ({ pageParam }) => api.getNotifications({ before: pageParam, limit: PAGE }).then((r) => r.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].sentAt : undefined),
    enabled: enabled && open,
  });
  const changed = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.notificationCount });
    queryClient.invalidateQueries({ queryKey: queryKeys.notificationList });
  };
  const read = useMutation({ mutationFn: (id: string) => api.markNotificationRead(id), onSuccess: changed });
  const readAll = useMutation({ mutationFn: () => api.markAllNotificationsRead(), onSuccess: changed });

  // Escape closes the panel, and so does a click anywhere outside it.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (!enabled) return null;
  const unread = count.data ?? 0;
  const items = list.data?.pages.flat() ?? [];

  return (
    <div ref={box} className="relative" data-testid="notification-bell">
      <button type="button" aria-label={unread ? `الإشعارات، ${toArabicDigits(unread)} غير مقروءة` : 'الإشعارات'} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-xl min-h-[44px] min-w-[44px] flex items-center justify-center text-text-secondary hover:text-brand-primary hover:bg-surface-canvas cursor-pointer">
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span data-testid="notification-count" className="absolute top-1 left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-state-danger text-white text-[11px] font-bold flex items-center justify-center">
            {unread > 9 ? '٩+' : toArabicDigits(unread)}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="الإشعارات" data-testid="notification-panel"
          className="fixed inset-x-3 top-16 lg:absolute lg:inset-auto lg:top-full lg:mt-2 lg:right-0 lg:w-96 z-50 max-h-[70vh] flex flex-col rounded-2xl border border-divider bg-surface-elevated shadow-overlay">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-divider">
            <p className="font-medium text-text-primary">الإشعارات</p>
            <div className="flex items-center gap-1">
              {unread > 0 && <Button size="sm" variant="ghost" loading={readAll.isPending} onClick={() => readAll.mutate()}>تعليم الكل كمقروء</Button>}
              <button type="button" aria-label="إغلاق" onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-surface-canvas cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="overflow-y-auto">
            {list.isLoading ? <div className="p-4"><Spinner /></div> : list.isError ? <div className="p-4"><LoadError onRetry={() => list.refetch()} /></div> : items.length === 0 ? (
              <p className="p-6 text-center text-sm text-text-secondary">لا إشعارات بعد. ستظهر هنا تذكيرات الدروس المباشرة وغيرها.</p>
            ) : (
              <ul className="divide-y divide-divider" data-testid="notification-list">
                {items.map((n) => {
                  const href = hrefOf(n);
                  const body = (
                    <>
                      <span className="mt-1 shrink-0">{href ? <CalendarClock className="w-4 h-4 text-brand-primary" /> : <Bell className="w-4 h-4 text-text-secondary" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${n.readAt ? 'text-text-secondary' : 'font-semibold text-text-primary'}`}>{n.titleAr}</span>
                        <span className="block text-sm text-text-secondary">{n.bodyAr}</span>
                        <span className="block text-xs text-text-muted mt-0.5">{when(n.sentAt)}</span>
                      </span>
                      {!n.readAt && <span aria-label="غير مقروء" className="mt-2 w-2 h-2 rounded-full bg-brand-primary shrink-0" />}
                    </>
                  );
                  const open = () => { if (!n.readAt) read.mutate(n.id); };
                  return (
                    <li key={n.id} data-unread={!n.readAt}>
                      {href ? (
                        <Link href={href} onClick={open} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-canvas">{body}</Link>
                      ) : (
                        <button type="button" onClick={open} className="w-full text-right flex items-start gap-3 px-4 py-3 hover:bg-surface-canvas cursor-pointer">{body}</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {list.hasNextPage && (
              <div className="p-3 border-t border-divider">
                <Button size="sm" variant="outline" className="w-full" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>عرض الأقدم</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
