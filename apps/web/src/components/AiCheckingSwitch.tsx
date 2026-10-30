'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { api, errorMessage, queryKeys } from '@/lib/api';

/** For administrators: turn the automatic first check of recitations on or off for the institution. */
export function AiCheckingSwitch() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.voiceStatus, queryFn: () => api.getVoiceStatus().then((r) => r.data) });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setAiChecking(enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.voiceStatus }),
  });

  if (!status.data) return null;
  const { available, enabled } = status.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>الفحص الآلي الأولي للتسميع</CardTitle>
        <CardDescription>
          يقارن تسجيل الطالبة بنص الآيات ويضع علامات على الكلمات للمعلمة. هو مؤشر أولي فقط، والتقدير والقرار للمعلمة دائماً.
          لا يُفحص إلا تسجيل طالبةٍ وافقت على ذلك.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!available ? (
          <p className="text-sm text-text-secondary">خدمة الفحص الآلي غير مفعّلة في هذا النظام حالياً، فالمراجعة تتم بواسطة المعلمة وحدها.</p>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm">الحالة: <b>{enabled ? 'مفعّل' : 'متوقف'}</b></span>
            <Button size="sm" variant={enabled ? 'outline' : 'primary'} loading={toggle.isPending} onClick={() => toggle.mutate(!enabled)}>
              {enabled ? 'إيقاف الفحص الآلي' : 'تفعيل الفحص الآلي'}
            </Button>
          </div>
        )}
        {toggle.isError && <p role="alert" className="text-sm text-red-800">{errorMessage(toggle.error)}</p>}
      </CardContent>
    </Card>
  );
}
