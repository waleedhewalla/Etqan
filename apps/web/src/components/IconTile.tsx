import type { LucideIcon } from 'lucide-react';

const glyphPaths = {
  cluster:
    'M4 4h6.5a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm9.5 3h6.5a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-6.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2ZM6.5 13.5H13a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2v-4.5a2 2 0 0 1 2-2Z',
  petals:
    'M8 3.5h8A2.5 2.5 0 0 1 18.5 6v5.5A2.5 2.5 0 0 1 16 14H8A2.5 2.5 0 0 1 5.5 11.5V6A2.5 2.5 0 0 1 8 3.5Zm-4 9h7A2.5 2.5 0 0 1 13.5 15v5.5A2.5 2.5 0 0 1 11 23H4A2.5 2.5 0 0 1 1.5 20.5V15A2.5 2.5 0 0 1 4 12.5Zm9 1.5h7A2.5 2.5 0 0 1 22.5 16.5V21A2.5 2.5 0 0 1 20 23.5h-7A2.5 2.5 0 0 1 10.5 21v-4.5A2.5 2.5 0 0 1 13 14Z',
  mosaic:
    'M3.5 3.5H11A1.5 1.5 0 0 1 12.5 5v7.5A1.5 1.5 0 0 1 11 14H3.5A1.5 1.5 0 0 1 2 12.5V5A1.5 1.5 0 0 1 3.5 3.5Zm9.5 2h7A1.5 1.5 0 0 1 21.5 7v7A1.5 1.5 0 0 1 20 15.5h-7A1.5 1.5 0 0 1 11.5 14V7A1.5 1.5 0 0 1 13 5.5ZM5 14.5h7A1.5 1.5 0 0 1 13.5 16v5.5A1.5 1.5 0 0 1 12 23H5a1.5 1.5 0 0 1-1.5-1.5V16A1.5 1.5 0 0 1 5 14.5Zm10.2 1.2a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6Z',
  rings:
    'M8 4.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm8 4a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM12 9.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z',
  grid:
    'M3.5 3.5h7v7h-7v-7Zm10 0h7v7h-7v-7Zm-10 10h7v7h-7v-7Zm10 0h7v7h-7v-7Z',
};

export type IconGlyph = keyof typeof glyphPaths;

export function IconTile({
  icon: Icon,
  glyph,
  size = 'md',
  className = '',
}: {
  icon?: LucideIcon;
  glyph?: IconGlyph;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box = size === 'lg' ? 'w-16 h-16' : size === 'sm' ? 'w-11 h-11' : 'w-14 h-14';
  const iconSize = size === 'lg' ? 'w-8 h-8' : size === 'sm' ? 'w-5 h-5' : 'w-7 h-7';
  const chosenGlyph = glyph ?? 'cluster';

  return (
    <span className={`icon-tile ${box} ${className}`} aria-hidden>
      {Icon ? (
        <Icon className={`${iconSize} text-surface-canvas`} strokeWidth={1.75} />
      ) : (
        <svg viewBox="0 0 24 24" className={`${iconSize} text-surface-canvas`} fill="currentColor">
          <path d={glyphPaths[chosenGlyph]} />
        </svg>
      )}
    </span>
  );
}
