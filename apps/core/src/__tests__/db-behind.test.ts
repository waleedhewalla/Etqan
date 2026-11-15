/**
 * A database behind the code: the server says so (health, start-up, and a plain error on the request) instead of a vague 500.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { errorHandler } from '../lib/errors';
import { forgetMigrationStatus, readMigrationStatus } from '../lib/migrations';

describe.skipIf(!process.env.DATABASE_URL)('a database behind the code', () => {
  let app: FastifyInstance;
  let dir: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    dir = await mkdtemp(join(tmpdir(), 'journal-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await app?.close();
    await closeDb();
  });

  /** A migrations folder whose journal lists `extra` more migrations than the real one. */
  const folderWith = async (extra: number) => {
    const real = JSON.parse(await readFile('./drizzle/meta/_journal.json', 'utf8')) as { entries: object[] };
    const entries = [...real.entries, ...Array.from({ length: extra }, () => ({}))];
    await mkdir(join(dir, `f${extra}`, 'meta'), { recursive: true });
    await writeFile(join(dir, `f${extra}`, 'meta', '_journal.json'), JSON.stringify({ entries }));
    return join(dir, `f${extra}`);
  };

  it('counts the migrations the database lacks', async () => {
    expect(await readMigrationStatus(getDb())).toEqual({ pending: 0 });
    expect(await readMigrationStatus(getDb(), await folderWith(1))).toEqual({ pending: 1 });
    expect(await readMigrationStatus(getDb(), await folderWith(3))).toEqual({ pending: 3 });
  });

  it('does not guess when it cannot tell (no journal at hand)', async () => {
    expect(await readMigrationStatus(getDb(), join(dir, 'nowhere'))).toEqual({ pending: null });
  });

  it('is shown on the health check, which stays up', async () => {
    forgetMigrationStatus();
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', migrations: { pending: 0 } });
  });

  it('answers a missing column or table with a plain 503 and a code the screens understand', () => {
    for (const code of ['42703', '42P01']) {
      let sent: { status: number; body: Record<string, unknown> } | null = null;
      const reply = { code(status: number) { return { send(body: Record<string, unknown>) { sent = { status, body }; } }; } };
      const request = { id: 'r', url: '/v1/sections', method: 'GET', ip: '127.0.0.1', log: { error() {} } };
      errorHandler(Object.assign(new Error('column "x" does not exist'), { code }) as never, request as never, reply as never);
      expect(sent!.status).toBe(503);
      expect(sent!.body).toMatchObject({ code: 'DATABASE_OUT_OF_DATE' });
    }
  });

  it('leaves other errors as they were', () => {
    let status = 0;
    const reply = { code(s: number) { status = s; return { send() {} }; } };
    const request = { id: 'r', url: '/x', method: 'GET', ip: '127.0.0.1', log: { error() {} } };
    errorHandler(Object.assign(new Error('boom'), { code: '23505' }) as never, request as never, reply as never);
    expect(status).toBe(500);
  });
});
