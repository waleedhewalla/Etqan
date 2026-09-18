export function BrandMark({
  size = 'md',
  inverse = false,
  showWordmark = true,
}: {
  size?: 'sm' | 'md' | 'lg';
  inverse?: boolean;
  showWordmark?: boolean;
}) {
  const box = size === 'lg' ? 'w-12 h-12' : size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const icon = size === 'lg' ? 'w-7 h-7' : size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  const word = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-lg' : 'text-xl';

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`${box} rounded-xl flex items-center justify-center shrink-0 ${
          inverse ? 'bg-surface-canvas text-brand-primary' : 'bg-brand-primary text-surface-canvas'
        }`}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className={icon} fill="currentColor">
          <path d="M4 4h6.5a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm9.5 3h6.5a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-6.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2ZM6.5 13.5H13a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2v-4.5a2 2 0 0 1 2-2Z" />
        </svg>
      </span>
      {showWordmark && (
        <span className={`font-heading font-bold ${word} ${inverse ? 'text-surface-canvas' : 'text-text-primary'}`}>
          إتقان
        </span>
      )}
    </span>
  );
}
