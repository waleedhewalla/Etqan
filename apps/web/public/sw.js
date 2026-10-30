/*
 * Itqan service worker: lets the app open and run today's revision without a connection.
 *
 * - Pages the student has opened are kept (network first, so she always gets the newest when online).
 * - Scripts, styles, fonts and images are kept and served from the device (refreshed in the background).
 * - Nothing from the API is ever stored here: that data goes through the app's own offline store.
 *
 * Pages are only the app shell (the screens fill in their data from the API after they open), so
 * keeping them holds no personal information.
 */
const PAGES = 'itqan-pages-v1';
const STATIC = 'itqan-static-v1';
const OFFLINE_HTML = '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>إتقان</title><body style="font-family:sans-serif;text-align:center;padding:3rem 1rem;background:#FEFCF7;color:#1B4332"><h1>لا يوجد اتصال</h1><p>افتحي إتقان مرة واحدة وأنتِ متصلة بالإنترنت، ثم يعمل بلا اتصال.</p></body></html>';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== PAGES && key !== STATIC) await caches.delete(key);
    await self.clients.claim();
  })());
});

// The app asks us to keep the page it is on, so that page opens offline next time.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'cache-page') event.waitUntil(cachePage(event.data.path));
});

async function cachePage(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return;
  try {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (res.ok) await (await caches.open(PAGES)).put(path, res);
  } catch (_) { /* offline: nothing to refresh */ }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/v1/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(navigate(req, url));
  } else if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/images/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function navigate(req, url) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(url.pathname, res.clone());
    return res;
  } catch (_) {
    return (await cache.match(url.pathname)) || (await cache.match('/dashboard')) ||
      new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(req);
  const refresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => undefined);
  return cached || (await refresh) || Response.error();
}
