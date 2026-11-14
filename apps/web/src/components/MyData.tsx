'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { Download, ShieldCheck } from 'lucide-react';
import { api, errorMessage, queryKeys } from '@/lib/api';
import { saveBlob } from '@/lib/download';
import { toArabicDigits } from '@/lib/quran';
import { SUPPORT_EMAIL } from '@/lib/site';

const day = (iso: string) => new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' }).format(new Date(iso));

/** What the person may do with her own data: download everything the app keeps about her, or ask for it to be deleted. */
export function MyData() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.myDataRequest, queryFn: () => api.getMyDataRequest().then((r) => r.data) });
  const [notice, setNotice] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.myDataRequest });
  const download = useMutation({
    mutationFn: () => api.downloadMyData().then((r) => r.data),
    onSuccess: (blob) => { saveBlob(blob, 'itqan-my-data.json'); setNotice('نُزّل ملف بياناتكِ.'); },
  });
  const ask = useMutation({ mutationFn: () => api.createMyDataRequest().then((r) => r.data), onSuccess: () => { setNotice(''); refresh(); } });
  const withdraw = useMutation({ mutationFn: () => api.cancelMyDataRequest(), onSuccess: () => { setNotice('سُحب الطلب.'); refresh(); } });
  const request = status.data?.request ?? null;
  const grace = status.data?.graceDays ?? 14;

  return (
    <Card data-testid="my-data">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-brand-primary" />بياناتي وخصوصيتي</CardTitle>
        <CardDescription>لكِ أن تأخذي نسخة من كل ما تحتفظ به المنصة عنكِ، وأن تطلبي حذفه.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="space-y-2">
          <p className="font-medium text-text-primary">نسخة من بياناتي</p>
          <p className="text-text-secondary">ملف يضم بياناتكِ الشخصية وخطتكِ ودرجات تسميعكِ واختباراتكِ وحضوركِ وإشعاراتكِ. لا يضم التسجيلات الصوتية: تُحذف تلقائياً بعد مراجعتها.</p>
          <Button variant="outline" size="sm" loading={download.isPending} onClick={() => { setNotice(''); download.mutate(); }}><Download className="w-4 h-4 ml-1" /> تنزيل بياناتي</Button>
          {download.isError && <p role="alert" className="text-red-800">{errorMessage(download.error, 'تعذّر تنزيل الملف.')}</p>}
        </div>

        <div className="space-y-2 border-t border-divider pt-4">
          <p className="font-medium text-text-primary">حذف بياناتي</p>
          {status.isLoading ? null : request?.status === 'pending' ? (
            <div className="space-y-2" data-testid="my-request-pending">
              <p><Badge variant="gold" size="sm">بانتظار الاعتماد</Badge> طلبتِ حذف بياناتكِ في {day(request.requestedAt)}. تنظر فيه إدارة المؤسسة.</p>
              <Button variant="ghost" size="sm" loading={withdraw.isPending} onClick={() => { setNotice(''); withdraw.mutate(); }}>سحب الطلب</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {request?.status === 'rejected' && (
                <p role="status" className="rounded-xl bg-amber-50 text-amber-900 px-3 py-2" data-testid="my-request-rejected">
                  لم يُعتمد طلبكِ السابق{request.decisionNote ? `: ${request.decisionNote}` : ''}. يمكنكِ تقديم طلب جديد.
                </p>
              )}
              <p className="text-text-secondary">
                إذا اعتُمد طلبكِ يتوقف حسابكِ فوراً، وبعد {toArabicDigits(grace)} يوماً (لتتراجعي إن شئتِ) تُزال هويتكِ: اسمكِ ورقمكِ وبريدكِ وتسجيلاتكِ وملاحظات المعلمة وتاريخ مراجعتكِ وإشعاراتكِ.
                قد تحتفظ المؤسسة بدرجاتكِ وحضوركِ دون اسمكِ، لأنها سجلّ أكاديمي لها، ما لم تقرر الإدارة حذف كل شيء.
              </p>
              <Button variant="outline" size="sm" loading={ask.isPending}
                onClick={() => { setNotice(''); if (window.confirm('طلب حذف بياناتكِ؟ إن اعتُمد الطلب يتوقف حسابكِ ولا تستطيعين الدخول.')) ask.mutate(); }}>
                طلب حذف بياناتي
              </Button>
              {ask.isError && <p role="alert" className="text-red-800">{errorMessage(ask.error, 'تعذّر إرسال الطلب.')}</p>}
              <p className="text-xs text-text-secondary">يمكنكِ أيضاً مراسلتنا على <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
            </div>
          )}
        </div>
        {notice && <p role="status" className="text-text-primary">{notice}</p>}
      </CardContent>
    </Card>
  );
}
