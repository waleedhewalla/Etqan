/** Behind a reverse proxy the client's address comes from X-Forwarded-For, but only when told to trust the proxy. */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server';
import { config } from '../config';

const setTrust = (v: boolean) => { (config as { TRUST_PROXY: boolean }).TRUST_PROXY = v; };

async function requestCodes(app: FastifyInstance, forwardedFor: (i: number) => string, count = 7) {
  const statuses: number[] = [];
  for (let i = 0; i < count; i++) {
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/otp/request',
      // the proxy's address on the container network (localhost is exempt from rate limiting)
      remoteAddress: '172.18.0.2',
      headers: { 'x-forwarded-for': forwardedFor(i) },
      payload: { whatsapp: `+2010000${String(90000 + i)}` },
    });
    statuses.push(res.statusCode);
  }
  return statuses;
}

describe('TRUST_PROXY', () => {
  const apps: FastifyInstance[] = [];
  afterEach(() => setTrust(false));
  afterAll(async () => { await Promise.all(apps.map((a) => a.close())); });

  it('ignores X-Forwarded-For when off, so it cannot be used to dodge the login-code limit', async () => {
    setTrust(false);
    const app = await buildApp(); apps.push(app); await app.ready();
    const statuses = await requestCodes(app, (i) => `203.0.113.${i + 1}`);
    expect(statuses.slice(0, 5)).not.toContain(429);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('counts each real client separately when on, and still limits a single one', async () => {
    setTrust(true);
    const app = await buildApp(); apps.push(app); await app.ready();
    expect(await requestCodes(app, (i) => `198.51.100.${i + 1}`)).not.toContain(429);
    const same = await requestCodes(app, () => '198.51.100.200');
    expect(same.slice(5)).toEqual([429, 429]);
  });
});
