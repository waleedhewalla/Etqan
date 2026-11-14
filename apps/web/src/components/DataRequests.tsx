'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { ShieldAlert } from 'lucide-react';
import { api, errorMessage, queryKeys, type AdminDataRequest } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/admin-labels';
import { toArabicDigits } from '@/lib/quran';
import { LoadError, Spinner } from '@/components/LoadState';

const day = (iso: string) => new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' }).format(new Date(iso));
const field = 'rounded-xl border border-divider bg-surface-elevated px-3 py-2 text-sm';
const STATUS = { pending: ['بانتظار القرار', 'gold'], scheduled: ['معتمد: ينتظر التنفيذ', 'info'], done: ['نُفّذ', 'green'], rejected: ['مرفوض', 'red'], cancelled: ['أُلغي', 'neutral'] } as const;

/** The institution's data-deletion requests: a dean decides each, and an approved one waits out its grace period before it runs. */
export function DataRequests() {
  const queryClient = useQueryClient();
  const [showDone, setShowDone] = useState(false);
  /** What was just done: kept here, because the request it was about leaves the open list. */
  const [notice, setNotice] = useState('');
  const list = useQuery({ queryKey: queryKeys.dataRequests(showDone ? 'done' : 'open'), queryFn: () => api.getDataRequests(showDone ? 'done' : 'open').then((r) => r.data) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'data-requests'] });

  return (
    <Card data-testid="data-requests">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-brand-primary" />طلبات حذف البيانات</CardTitle>
        <CardDescription>
          يطلب الشخص حذف بياناته من حسابه، أو تسجّلين طلباً وصل بالبريد من «إدارة» في بطاقته. عند الاعتماد يتوقف الحساب فوراً، وتُزال البيانات بعد {list.data ? toArabicDigits(list.data.graceDays) : '…'} يوماً ما لم تُلغي الطلب.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {list.isLoading ? <Spinner /> : list.isError || !list.data ? <LoadError onRetry={() => list.refetch()} /> : list.data.requests.length === 0 ? (
          <p className="text-sm text-text-secondary">{showDone ? 'لا طلبات سابقة.' : 'لا طلبات مفتوحة.'}</p>
        ) : (
          <ul className="divide-y divide-divider" data-testid="data-request-list">
            {list.data.requests.map((r) => <RequestRow key={r.id} request={r} onChange={(message) => { setNotice(message); refresh(); }} />)}
          </ul>
        )}
        {notice && <p role="status" className="text-sm text-text-primary" data-testid="data-request-notice">{notice}</p>}
        <button type="button" className="text-sm text-brand-primary underline" onClick={() => setShowDone(!showDone)}>{showDone ? 'عرض الطلبات المفتوحة' : 'عرض الطلبات السابقة'}</button>
      </CardContent>
    </Card>
  );
}

function RequestRow({ request: r, onChange }: { request: AdminDataRequest; onChange: (message: string) => void }) {
  const [mode, setMode] = useState<'anonymize' | 'erase'>('anonymize');
  const done = (message: string) => () => onChange(`${r.subjectName ?? 'الحساب'}: ${message}`);
  const approve = useMutation({ mutationFn: () => api.approveDataRequest(r.id, mode), onSuccess: done('اعتُمد الطلب، وتوقف الحساب.') });
  const reject = useMutation({ mutationFn: (reason: string) => api.rejectDataRequest(r.id, reason), onSuccess: done('رُفض الطلب.') });
  const cancel = useMutation({ mutationFn: () => api.cancelDataRequest(r.id), onSuccess: done('أُلغي الطلب.') });
  const [label, tone] = STATUS[r.status];
  const error = approve.error ?? reject.error ?? cancel.error;

  return (
    <li className="py-3 space-y-2" data-testid={`data-request-${r.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-text-primary flex items-center gap-2 flex-wrap">
            {r.subjectName ?? 'حساب محذوف'}
            <Badge variant="neutral" size="sm">{ROLE_LABEL[r.subjectRole as keyof typeof ROLE_LABEL] ?? r.subjectRole}</Badge>
            <Badge variant={tone} size="sm">{label}</Badge>
          </p>
          <p className="text-xs text-text-secondary">
            طُلب {day(r.requestedAt)} · {r.source === 'self' ? 'من صاحبة الحساب' : 'سجّلته الإدارة'}
            {r.mode && <> · {r.mode === 'erase' ? 'حذف كل شيء' : 'تجهيل الهوية'}</>}
            {r.status === 'scheduled' && r.scheduledFor && <> · يُنفَّذ {day(r.scheduledFor)}</>}
            {r.status === 'done' && r.completedAt && <> · نُفّذ {day(r.completedAt)}</>}
            {r.decisionNote && <> · {r.decisionNote}</>}
          </p>
          {r.error && <p className="text-xs text-red-800">تعذّر التنفيذ: {r.error}. يُعاد المحاولة تلقائياً.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {r.status === 'pending' && (
            <>
              <select aria-label="ما يُزال" className={field} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="anonymize">تجهيل الهوية (يبقى الأكاديمي دون اسم)</option>
                {r.erasable && <option value="erase">حذف كل شيء (الدرجات أيضاً)</option>}
              </select>
              <Button size="sm" loading={approve.isPending} disabled={r.leadsHalaqat > 0}
                onClick={() => { if (window.confirm(mode === 'erase' ? 'حذف الحساب وكل ما يتعلق به بما فيه الدرجات؟ لا يمكن التراجع بعد التنفيذ.' : 'اعتماد الطلب؟ يتوقف الحساب فوراً وتُزال الهوية بعد مدة السماح.')) approve.mutate(); }}>اعتماد</Button>
              <Button size="sm" variant="outline" loading={reject.isPending}
                onClick={() => { const reason = window.prompt('سبب الرفض (تراه صاحبة الطلب):'); if (reason && reason.trim().length >= 3) reject.mutate(reason.trim()); }}>رفض</Button>
            </>
          )}
          {(r.status === 'pending' || r.status === 'scheduled') && (
            <Button size="sm" variant="ghost" loading={cancel.isPending}
              onClick={() => { if (window.confirm('إلغاء الطلب؟ يُعاد تفعيل الحساب إن كان الاعتماد أوقفه.')) cancel.mutate(); }}>إلغاء الطلب</Button>
          )}
        </div>
      </div>
      {r.status === 'pending' && r.leadsHalaqat > 0 && <p className="text-xs text-amber-900">تقود {toArabicDigits(r.leadsHalaqat)} حلقة: أسنديها إلى معلمة أخرى قبل الاعتماد.</p>}
      {error && <p role="alert" className="text-sm text-red-800">{errorMessage(error, 'تعذّر تنفيذ الطلب.')}</p>}
    </li>
  );
}
