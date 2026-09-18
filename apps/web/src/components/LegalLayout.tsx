import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-surface-canvas">
      <SiteHeader compact />
      <main className="flex-1 pt-20 pb-10">
        <article className="container-main max-w-3xl">
          <h1 className="font-heading text-4xl font-bold text-text-primary mb-5">{title}</h1>
          <div className="surface-card p-5 space-y-4 text-text-secondary font-normal leading-relaxed">
            {children}
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
