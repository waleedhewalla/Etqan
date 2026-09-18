'use client';

import Link from 'next/link';
import { Button } from '@itqan/ui';
import { BrandMark } from './BrandMark';

const marketingLinks = [
  { href: '/#features', label: 'المميزات' },
  { href: '/#how-it-works', label: 'كيف تعمل' },
  { href: '/#trust', label: 'الثقة والأمان' },
];

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className="fixed top-0 right-0 left-0 z-40 bg-surface-elevated/90 backdrop-blur-sm border-b border-divider">
      <nav className="container-main flex items-center justify-between h-14" dir="rtl">
        <Link href="/" className="cursor-pointer" aria-label="إتقان — الصفحة الرئيسية">
          <BrandMark size="sm" />
        </Link>
        {!compact && (
          <div className="hidden md:flex items-center gap-5">
            {marketingLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-text-secondary hover:text-brand-primary transition-colors cursor-pointer"
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3">
          <Link
            href="/auth/login/faculty"
            className="text-text-secondary hover:text-brand-primary transition-colors text-sm cursor-pointer"
          >
            دخول هيئة التدريس
          </Link>
          <Link href="/auth/join" className="cursor-pointer">
            <Button size="md">انضمي كطالبة</Button>
          </Link>
        </div>
      </nav>
    </header>
  );
}
