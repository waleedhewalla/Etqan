import type { Metadata, Viewport } from 'next';
import { Amiri, Noto_Naskh_Arabic, Inter } from 'next/font/google';
import { Providers } from './providers';
import { ToastProvider } from '@itqan/ui';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const amiri = Amiri({
  subsets: ['arabic', 'latin'],
  weight: ['400', '700'],
  variable: '--font-amiri',
  display: 'swap',
});

const notoNaskh = Noto_Naskh_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto-naskh',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'إتقان - منصة حفظ القرآن الكريم',
    template: '%s | إتقان',
  },
  description: 'منصة تفاعلية لحفظ القرآن الكريم والتلاوة والمتابعة الأكاديمية',
  keywords: ['قرآن', 'حفظ', 'تلاوة', 'متشابهات', 'إتقان', 'أزهر'],
  authors: [{ name: 'إتقان' }],
  creator: 'إتقان',
  publisher: 'إتقان',
  robots: 'index, follow',
  openGraph: {
    type: 'website',
    locale: 'ar_EG',
    siteName: 'إتقان',
    title: 'إتقان - منصة حفظ القرآن الكريم',
    description: 'منصة تفاعلية لحفظ القرآن الكريم والتلاوة والمتابعة الأكاديمية',
  },
};

export const viewport: Viewport = {
  themeColor: '#1B4332',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${inter.variable} ${amiri.variable} ${notoNaskh.variable} font-body`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="bg-surface-canvas text-text-primary antialiased min-h-screen flex flex-col">
        <Providers>
          <ToastProvider>
            {children}
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
