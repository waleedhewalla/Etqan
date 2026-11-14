'use client';

import { useQuery } from '@tanstack/react-query';
import { api, queryKeys, type ModuleKey, type ModuleSettingValue } from '@/lib/api';

/**
 * Which of the product's modules are on for the signed-in user's institution, and the settings of each that a screen
 * needs. Until the answer arrives everything counts as on, so screens do not flash empty and then fill in.
 */
export function useModules() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: () => api.getMe().then((r) => r.data) });
  const modules = me.data?.modules;
  return {
    loaded: Boolean(modules),
    isOn: (key: ModuleKey) => modules?.[key]?.enabled ?? true,
    setting: (key: ModuleKey, name: string, fallback: ModuleSettingValue) => modules?.[key]?.config?.[name] ?? fallback,
  };
}
