'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { api, currentConsents, errorMessage, queryKeys, type ConsentPurpose } from '@/lib/api';

/**
 * Lets a student decide whether her guardians may see her reports (weekly report, monthly record, memorization map).
 * Switching it off hides her from them at once and stops their alerts; she can switch it back on any time.
 */
export function GuardianAccessSwitch() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: () => api.getMe().then((r) => r.data) });
  const allowed = me.data?.guardianAccess ?? true;

  const change = useMutation({
    // The list replaces her consents, so it carries the others unchanged.
    mutationFn: (allow: boolean) => {
      const others = currentConsents(me.data).filter((c) => c !== 'mahram_access');
      return api.setConsents(allow ? [...others, 'mahram_access' as ConsentPurpose] : others);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  });

  if (!me.data) return null;
  return (
    <Card data-testid="guardian-access">
      <CardHeader>
        <CardTitle>اطلاع ولي الأمر</CardTitle>
        <CardDescription>
          يرى ولي أمركِ المرتبط بحسابكِ تقريركِ الأسبوعي وسجلكِ الشهري وخريطة حفظكِ، ويصله تنبيه الغياب وتذكير الدروس المباشرة.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <label className="flex items-center gap-3 text-sm cursor-pointer">
          <input type="checkbox" className="w-5 h-5 accent-brand-primary" checked={allowed} disabled={change.isPending}
            onChange={(e) => change.mutate(e.target.checked)} />
          <span>أسمح لولي أمري بمتابعة تقاريري</span>
        </label>
        <p className="text-xs text-text-secondary">
          {allowed ? 'إن أوقفتِ ذلك لن يرى ولي الأمر شيئاً من هذا حتى تعيدي السماح.' : 'أوقفتِ الاطلاع: لا يرى ولي أمركِ تقاريركِ الآن ولا تصله تنبيهات عنكِ.'}
        </p>
        {change.isError && <p role="alert" className="text-sm text-red-800">{errorMessage(change.error, 'تعذّر حفظ اختياركِ. حاولي مرة أخرى.')}</p>}
      </CardContent>
    </Card>
  );
}
