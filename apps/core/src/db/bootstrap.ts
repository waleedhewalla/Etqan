/**
 * Creates the first institution on a fresh deployment (production has no demo seed): the institution, its dean,
 * optionally a teacher and a halaqa. Staff sign in by an emailed magic link, so their emails must exist first.
 * Safe to run again: whatever already exists is left as it is.
 *
 *   node dist/bootstrap.mjs --slug azhar-pilot --name "كلية الأزهر للبنات" --plan madrasa_pro \
 *     --dean-email dean@example.org --dean-name "د. فلانة" \
 *     --teacher-email teacher@example.org --teacher-name "أ. فلانة" --halaqa "حلقة سورة البقرة"
 */
import 'dotenv/config';
import { randomInt } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, getDb, type Database } from './index';
import { sections, tenants, users } from './schema';

export interface BootstrapOptions {
  slug: string;
  nameAr: string;
  plan?: typeof tenants.$inferInsert['planTier'];
  deanEmail: string;
  deanNameAr: string;
  teacherEmail?: string;
  teacherNameAr?: string;
  halaqaNameAr?: string;
}

export interface BootstrapResult {
  tenantId: string;
  created: { tenant: boolean; dean: boolean; teacher: boolean; halaqa: boolean };
  /** The code students use to join the halaqa, when one was made or already exists. */
  joinCode: string | null;
}

const JOIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const joinCode = () => Array.from({ length: 8 }, () => JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)]).join('');
const normalizeEmail = (e: string) => e.trim().toLowerCase();

export async function bootstrapInstitution(db: Database, opts: BootstrapOptions): Promise<BootstrapResult> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(opts.slug)) throw new Error('--slug must be lowercase letters, digits and dashes');
  if (!opts.nameAr.trim()) throw new Error('--name is required');
  if ((opts.teacherEmail || opts.halaqaNameAr) && !opts.teacherEmail && !opts.deanEmail) throw new Error('a halaqa needs a teacher or dean');

  return db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    const created = { tenant: false, dean: false, teacher: false, halaqa: false };

    let [tenant] = await t.select().from(tenants).where(eq(tenants.slug, opts.slug)).limit(1);
    if (!tenant) {
      [tenant] = await t.insert(tenants).values({ slug: opts.slug, nameAr: opts.nameAr, planTier: opts.plan ?? 'free' }).returning();
      created.tenant = true;
    }

    const person = async (email: string, name: string, role: 'dean' | 'lecturer') => {
      const normalized = normalizeEmail(email);
      const [existing] = await t.select().from(users).where(sql`lower(${users.email}) = ${normalized}`).limit(1);
      if (existing) {
        if (existing.tenantId !== tenant.id) throw new Error(`${normalized} already belongs to another institution`);
        return { user: existing, made: false };
      }
      const [user] = await t.insert(users).values({ tenantId: tenant.id, role, displayNameAr: name, email: normalized }).returning();
      return { user, made: true };
    };

    const dean = await person(opts.deanEmail, opts.deanNameAr, 'dean');
    created.dean = dean.made;
    let teacher = dean;
    if (opts.teacherEmail) {
      teacher = await person(opts.teacherEmail, opts.teacherNameAr ?? opts.teacherEmail, 'lecturer');
      created.teacher = teacher.made;
    }

    let code: string | null = null;
    if (opts.halaqaNameAr) {
      const [existing] = await t.select().from(sections)
        .where(and(eq(sections.tenantId, tenant.id), eq(sections.nameAr, opts.halaqaNameAr))).limit(1);
      if (existing) {
        code = existing.joinCode;
      } else {
        const [made] = await t.insert(sections).values({ tenantId: tenant.id, nameAr: opts.halaqaNameAr, joinCode: joinCode(), teacherId: teacher.user.id }).returning();
        code = made.joinCode;
        created.halaqa = true;
      }
    }
    return { tenantId: tenant.id, created, joinCode: code };
  });
}

function args(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--') || argv[i + 1] === undefined) throw new Error(`Unexpected argument: ${key ?? ''}`);
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

if (/bootstrap\.(ts|mjs)$/.test(process.argv[1] ?? '')) {
  (async () => {
    const a = args(process.argv.slice(2));
    for (const required of ['slug', 'name', 'dean-email', 'dean-name']) if (!a[required]) throw new Error(`--${required} is required`);
    const plan = (a.plan ?? 'free') as BootstrapOptions['plan'];
    if (!['free', 'madrasa_basic', 'madrasa_pro', 'enterprise'].includes(plan!)) throw new Error('--plan must be free, madrasa_basic, madrasa_pro or enterprise');

    const r = await bootstrapInstitution(getDb(), {
      slug: a.slug, nameAr: a.name, plan, deanEmail: a['dean-email'], deanNameAr: a['dean-name'],
      teacherEmail: a['teacher-email'], teacherNameAr: a['teacher-name'], halaqaNameAr: a.halaqa,
    });
    const made = (k: keyof BootstrapResult['created'], label: string) => `${label}: ${r.created[k] ? 'created' : 'already there'}`;
    console.log([made('tenant', 'institution'), made('dean', 'dean'), a['teacher-email'] ? made('teacher', 'teacher') : null, a.halaqa ? made('halaqa', 'halaqa') : null]
      .filter(Boolean).join(' · '));
    if (r.joinCode) console.log(`Halaqa join code for students: ${r.joinCode}`);
    console.log(`Staff sign in at /auth/login/faculty with their email: a link is sent to it (needs SENDGRID_API_KEY).`);
    await closeDb();
  })().catch(async (err) => {
    console.error('Bootstrap failed:', err instanceof Error ? err.message : err);
    await closeDb();
    process.exit(1);
  });
}
