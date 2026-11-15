'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Button } from '@itqan/ui';

type Ask = (message: string, options?: { confirmLabel?: string }) => Promise<boolean>;

/** Without a provider (a test), asking says no, so nothing destructive runs by accident. */
const ConfirmContext = createContext<Ask>(async () => false);

/**
 * Asks "are you sure?" inside the page. The browser's own confirmation box is blocked in embedded and preview browsers,
 * where it silently answers "no" and the button seems dead; this one works everywhere.
 * `const confirm = useConfirm(); if (await confirm('…')) doIt();`
 */
export const useConfirm = () => useContext(ConfirmContext);

interface Pending { message: string; confirmLabel: string; resolve: (yes: boolean) => void }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const ask = useCallback<Ask>((message, options) => new Promise<boolean>((resolve) => {
    // A second question while one is open cancels the first.
    setPending((old) => { old?.resolve(false); return { message, confirmLabel: options?.confirmLabel ?? 'تأكيد', resolve }; });
  }), []);

  const answer = useCallback((yes: boolean) => {
    setPending((old) => { old?.resolve(yes); return null; });
  }, []);

  useEffect(() => {
    if (!pending) return;
    cancelRef.current?.focus(); // the safe choice has the focus, so a stray Enter does not confirm
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') answer(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, answer]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" dir="rtl" onClick={() => answer(false)} data-testid="confirm-overlay">
          <div role="alertdialog" aria-modal="true" aria-label="تأكيد" data-testid="confirm-dialog"
            className="w-full max-w-md rounded-2xl bg-surface-elevated p-5 shadow-xl space-y-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-text-primary leading-relaxed whitespace-pre-line">{pending.message}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button ref={cancelRef} type="button" data-testid="confirm-no" onClick={() => answer(false)}
                className="rounded-xl border border-divider px-4 py-2 text-sm text-text-primary hover:bg-surface-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
                إلغاء
              </button>
              <Button type="button" data-testid="confirm-yes" onClick={() => answer(true)}>{pending.confirmLabel}</Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
