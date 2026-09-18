import type { ReactNode } from 'react';
import { IconTile } from './IconTile';
import type { LucideIcon } from 'lucide-react';

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="surface-card px-5 py-8 text-center">
      <div className="flex justify-center mb-3">
        <IconTile icon={icon} glyph="rings" size="lg" />
      </div>
      <h3 className="font-heading text-2xl font-bold text-text-primary mb-2">{title}</h3>
      <p className="text-text-secondary font-normal max-w-md mx-auto mb-4">{description}</p>
      {action}
    </div>
  );
}
