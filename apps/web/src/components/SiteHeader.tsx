'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@itqan/ui';
import { Menu, X } from 'lucide-react';
import { BrandMark } from './BrandMark';

const marketingLinks = [
  { href: '/#features', label: 'المميزات' },
  { href: '/#how-it-works', label: 'كيف تعمل' },
  { href: '/#trust', label: 'الثقة والأمان' },
];

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 right-0 left-0 z-40 transition-all duration-300 ${
        scrolled
          ? 'bg-surface-elevated shadow-sm border-b border-divider'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <nav className="container-main flex items-center justify-between h-16" dir="rtl">
        <Link href="/" className="cursor-pointer" aria-label="إتقان — الصفحة الرئيسية">
          <BrandMark size="sm" inverse={!scrolled} />
        </Link>

        {!compact && (
          <div className="hidden md:flex items-center gap-6">
            {marketingLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-medium transition-colors cursor-pointer ${
                  scrolled
                    ? 'text-text-secondary hover:text-brand-primary'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}

        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/auth/login/faculty"
            className={`text-sm font-medium transition-colors cursor-pointer ${
              scrolled
                ? 'text-text-secondary hover:text-brand-primary'
                : 'text-white/80 hover:text-white'
            }`}
          >
            دخول هيئة التدريس
          </Link>
          <Link href="/auth/join" className="cursor-pointer">
            <Button size="md" className={scrolled ? '' : 'bg-white text-brand-primary hover:bg-surface-canvas'}>
              انضمي كطالبة
            </Button>
          </Link>
        </div>

        <button
          className="md:hidden p-2 rounded-lg transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
        >
          {mobileOpen ? (
            <X className={`w-6 h-6 ${scrolled ? 'text-text-primary' : 'text-white'}`} />
          ) : (
            <Menu className={`w-6 h-6 ${scrolled ? 'text-text-primary' : 'text-white'}`} />
          )}
        </button>
      </nav>

      {mobileOpen && (
        <div className="md:hidden bg-surface-elevated border-t border-divider animate-fade-in">
          <div className="container-main py-4 space-y-3">
            {!compact && marketingLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block py-2 text-text-secondary hover:text-brand-primary transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <hr className="border-divider" />
            <Link
              href="/auth/login/faculty"
              className="block py-2 text-text-secondary hover:text-brand-primary transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              دخول هيئة التدريس
            </Link>
            <Link href="/auth/join" onClick={() => setMobileOpen(false)}>
              <Button size="md" className="w-full">انضمي كطالبة</Button>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
