import { Info } from 'lucide-react';

/** Marks a section that still shows example content rather than the user's data. */
export function PreviewNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-state-attention/30 bg-state-attention/5 px-3 py-2 text-sm text-text-secondary" role="note">
      <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-state-attention" />
      <span>{children ?? 'هذا القسم قيد التطوير، والبيانات المعروضة فيه أمثلة توضيحية وليست بياناتك.'}</span>
    </div>
  );
}
