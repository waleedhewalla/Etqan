import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '../db';
import { sections, tenants, users } from '../db/schema';
import { bootstrapInstitution } from '../db/bootstrap';

describe.skipIf(!process.env.DATABASE_URL)('bootstrapInstitution', () => {
  const tag = randomUUID().slice(0, 8);
  const slug = `boot-${tag}`;
  const opts = {
    slug, nameAr: 'معهد البداية', plan: 'madrasa_pro' as const, deanEmail: `Dean-${tag}@Example.org`, deanNameAr: 'العميدة',
    teacherEmail: `teacher-${tag}@example.org`, teacherNameAr: 'المعلمة', halaqaNameAr: 'حلقة البداية',
  };
  afterAll(closeDb);

  it('creates the institution, its dean, a teacher and a halaqa with a join code', async () => {
    const r = await bootstrapInstitution(getDb(), opts);
    expect(r.created).toEqual({ tenant: true, dean: true, teacher: true, halaqa: true });
    expect(r.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    const db = getDb();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
    expect(tenant).toMatchObject({ nameAr: 'معهد البداية', planTier: 'madrasa_pro' });
    const people = await db.select().from(users).where(eq(users.tenantId, tenant.id));
    expect(people.map((p) => [p.role, p.email]).sort()).toEqual([['dean', `dean-${tag}@example.org`], ['lecturer', `teacher-${tag}@example.org`]]);
    const [halaqa] = await db.select().from(sections).where(eq(sections.tenantId, tenant.id));
    expect(halaqa.joinCode).toBe(r.joinCode);
    expect(people.find((p) => p.role === 'lecturer')!.id).toBe(halaqa.teacherId);
  });

  it('can be run again without making anything twice, and returns the same join code', async () => {
    const first = await bootstrapInstitution(getDb(), opts);
    expect(first.created).toEqual({ tenant: false, dean: false, teacher: false, halaqa: false });
    const db = getDb();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
    const halaqat = await db.select().from(sections).where(and(eq(sections.tenantId, tenant.id), eq(sections.nameAr, 'حلقة البداية')));
    expect(halaqat).toHaveLength(1);
    expect(first.joinCode).toBe(halaqat[0].joinCode);
  });

  it('works with just an institution and a dean', async () => {
    const r = await bootstrapInstitution(getDb(), { slug: `${slug}-min`, nameAr: 'معهد صغير', deanEmail: `min-${tag}@example.org`, deanNameAr: 'عميدة' });
    expect(r).toMatchObject({ created: { tenant: true, dean: true, teacher: false, halaqa: false }, joinCode: null });
    const [t] = await getDb().select().from(tenants).where(eq(tenants.slug, `${slug}-min`));
    expect(t.planTier).toBe('free');
  });

  it('refuses an email that belongs to another institution, and leaves nothing half-made', async () => {
    await expect(bootstrapInstitution(getDb(), { slug: `${slug}-two`, nameAr: 'معهد آخر', deanEmail: opts.deanEmail, deanNameAr: 'س' }))
      .rejects.toThrow(/another institution/);
    expect(await getDb().select().from(tenants).where(eq(tenants.slug, `${slug}-two`))).toEqual([]);
  });

  it('rejects a bad slug', async () => {
    await expect(bootstrapInstitution(getDb(), { ...opts, slug: 'Bad Slug!' })).rejects.toThrow(/slug/);
  });
});
