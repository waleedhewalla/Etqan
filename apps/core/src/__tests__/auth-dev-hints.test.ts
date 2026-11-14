/**
 * Sign-in codes and links are handed back to the browser only on a developer's machine
 * (NODE_ENV=development with no sender configured). Anywhere else they must never appear in a response.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { tenants, users } from '../db/schema';
import { config } from '../config';

describe.skipIf(!process.env.DATABASE_URL)('sign-in hints for development', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const phone = `+2011${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const email = `hint-${tag}@example.test`;
  const original = config.NODE_ENV;
  const ip = () => `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const otp = () => app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { whatsapp: phone }, remoteAddress: ip() });
  const link = () => app.inject({ method: 'POST', url: '/v1/auth/magic-link', payload: { email }, remoteAddress: ip() });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `hint-${tag}`, nameAr: 'معهد' }).returning();
    await db.insert(users).values([
      { tenantId: tenant.id, role: 'student', displayNameAr: 'طالبة', whatsappE164: phone },
      { tenantId: tenant.id, role: 'lecturer', displayNameAr: 'معلمة', email },
    ]);
  });

  afterAll(async () => {
    (config as { NODE_ENV: string }).NODE_ENV = original;
    await app?.close();
    await closeDb();
  });

  it('never returns the code or the link outside development', async () => {
    expect(config.NODE_ENV).not.toBe('development');
    const a = await otp();
    expect(a.statusCode).toBe(200);
    expect(a.json()).not.toHaveProperty('devCode');
    const b = await link();
    expect(b.statusCode).toBe(200);
    expect(b.json()).not.toHaveProperty('devLink');
    expect(b.body).not.toContain('token=');
  });

  it('returns them in development when nothing can be sent, and still nothing for an unknown email', async () => {
    (config as { NODE_ENV: string }).NODE_ENV = 'development';
    expect((await otp()).json().devCode).toMatch(/^\d{4}$/);
    expect((await link()).json().devLink).toContain('/auth/login/faculty?token=');
    const unknown = await app.inject({ method: 'POST', url: '/v1/auth/magic-link', payload: { email: `nobody-${tag}@example.test` }, remoteAddress: ip() });
    expect(unknown.json()).not.toHaveProperty('devLink');
  });
});
