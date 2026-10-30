import { AlertCircle } from 'lucide-react';
import { Button } from '@itqan/ui';

export function Spinner({ label = 'جارٍ التحميل' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-10" role="status" aria-label={label}>
      <div className="animate-spin w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full" />
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-canvas">
      <Spinner />
    </div>
  );
}

export function LoadError({ onRetry, message = 'تعذّر تحميل البيانات.' }: { onRetry?: () => void; message?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center" role="alert">
      <AlertCircle className="w-8 h-8 text-state-danger" />
      <p className="text-text-secondary">{message}</p>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>إعادة المحاولة</Button>}
    </div>
  );
}
