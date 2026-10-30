'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Registers the service worker (production only: in development it would serve stale code) and asks it
 * to keep each page she visits, so the app opens without a connection.
 */
export function ServiceWorker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_ENABLE_SW !== 'true') return;

    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => reg.active?.postMessage({ type: 'cache-page', path: pathname }))
      .catch(() => undefined);
  }, [pathname]);

  return null;
}
