'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Menu, X } from 'lucide-react';
import { BrandMark } from './BrandMark';

export interface ShellNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

export function AppShell({
  items,
  activeId,
  onSelect,
  homeHref,
  trailing,
  children,
  userInitials = '؟',
}: {
  items: ShellNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  homeHref: string;
  trailing?: ReactNode;
  children: ReactNode;
  userInitials?: string;
}) {
  const [open, setOpen] = useState(false);
  const primary = items.slice(0, 4);

  const navButton = (item: ShellNavItem) => {
    const Icon = item.icon;
    const active = activeId === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => {
          onSelect(item.id);
          setOpen(false);
        }}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer min-h-[44px] ${
          active
            ? 'bg-brand-primary text-white'
            : 'text-text-secondary hover:text-brand-primary hover:bg-surface-canvas'
        }`}
      >
        <Icon className="w-5 h-5 shrink-0" />
        <span>{item.label}</span>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-surface-canvas" dir="rtl">
      <aside className="hidden lg:flex flex-col fixed top-0 right-0 bottom-0 w-64 bg-surface-elevated border-l border-divider z-40 p-3">
        <Link href={homeHref} className="mb-4 px-1 cursor-pointer">
          <BrandMark size="sm" />
        </Link>
        <nav className="flex-1 space-y-1 overflow-y-auto">{items.map(navButton)}</nav>
        {trailing}
      </aside>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/30 cursor-pointer"
            aria-label="إغلاق القائمة"
            onClick={() => setOpen(false)}
          />
            <aside className="absolute top-0 right-0 bottom-0 w-72 bg-surface-elevated p-4 shadow-overlay">
            <div className="flex items-center justify-between mb-4">
              <BrandMark size="sm" />
              <button type="button" className="p-2 rounded-xl min-h-[44px] min-w-[44px] cursor-pointer" onClick={() => setOpen(false)} aria-label="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="space-y-1">{items.map(navButton)}</nav>
          </aside>
        </div>
      )}

      <header className="lg:hidden fixed top-0 right-0 left-0 z-40 h-14 bg-surface-elevated/95 border-b border-divider flex items-center justify-between px-4">
        <button type="button" className="p-2 rounded-xl min-h-[44px] min-w-[44px] cursor-pointer" onClick={() => setOpen(true)} aria-label="فتح القائمة">
          <Menu className="w-5 h-5" />
        </button>
        <BrandMark size="sm" showWordmark={false} />
        <div className="w-9 h-9 rounded-full bg-brand-primary text-surface-canvas flex items-center justify-center text-sm font-bold">
          {userInitials}
        </div>
      </header>

      <main className="lg:mr-64 pt-16 lg:pt-5 pb-24 lg:pb-8 px-4 sm:px-5 lg:px-6">
        <div className="max-w-6xl mx-auto">{children}</div>
      </main>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface-elevated border-t border-divider z-40" dir="rtl">
        <div className="grid grid-cols-4">
          {primary.map((item) => {
            const Icon = item.icon;
            const active = activeId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={`flex flex-col items-center gap-1 py-3 min-h-[44px] cursor-pointer ${
                  active ? 'text-brand-primary' : 'text-text-muted'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px]">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
