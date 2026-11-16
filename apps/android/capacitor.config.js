/**
 * The Android app is the Itqan website in a native shell, so the only setting that differs between a test build and
 * the real one is the website's address:
 *
 *   ITQAN_APP_URL=https://itqan.example.org pnpm --filter @itqan/android sync
 *
 * It must be https: Android blocks the microphone and plain-text traffic otherwise. ITQAN_ALLOW_HTTP=1 permits a
 * plain http address for a phone on the local network while developing.
 */
const url = (process.env.ITQAN_APP_URL || '').trim().replace(/\/+$/, '');
const allowHttp = process.env.ITQAN_ALLOW_HTTP === '1';

let host = null;
if (url) {
  try { host = new URL(url); } catch { throw new Error(`ITQAN_APP_URL is not a web address: ${url}`); }
  if (host.protocol !== 'https:' && !allowHttp) {
    throw new Error('ITQAN_APP_URL must start with https:// (ITQAN_ALLOW_HTTP=1 only for a local test).');
  }
}

module.exports = {
  appId: 'org.itqan.app',
  appName: 'إتقان',
  webDir: 'www',
  backgroundColor: '#FEFCF7',
  server: {
    androidScheme: 'https',
    errorPath: 'offline.html',
    ...(host ? { url, cleartext: host.protocol === 'http:', allowNavigation: [host.host] } : {}),
  },
  android: { allowMixedContent: false },
};
