'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { DATABASE_BEHIND_EVENT, databaseBehindText } from '@/lib/database-behind';

/** Tells the person, at the top of any screen, that the server's database is behind its code, instead of leaving "could not load". */
export function DatabaseBehindBanner() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = () => setShown(true);
    window.addEventListener(DATABASE_BEHIND_EVENT, show);
    return () => window.removeEventListener(DATABASE_BEHIND_EVENT, show);
  }, []);
  if (!shown) return null;
  return (
    <div role="alert" dir="rtl" data-testid="database-behind"
      className="fixed top-0 inset-x-0 z-[90] flex items-start gap-3 bg-amber-100 text-amber-950 border-b border-amber-300 px-4 py-3 text-sm shadow">
      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="flex-1 leading-relaxed">{databaseBehindText()}</p>
      <button type="button" onClick={() => setShown(false)} className="underline shrink-0">إخفاء</button>
    </div>
  );
}
