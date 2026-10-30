/**
 * How well does the automatic check agree with teachers? Reads reviewed recitations from the database
 * and prints flag precision overall, by kind of flag, and per student (numbered, not named), so you can
 * see whether it works on your students' voices before relying on it.
 *
 *   pnpm --filter @itqan/core asr:eval [--tenant <slug>]
 *
 * It uses only the teachers' confirm/dismiss decisions: no audio is read or kept for this.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../db';
import { tasmiSubmissions, tenants, users } from '../db/schema';
import { summarizeEval, type EvalRow } from '../lib/asr/eval';
import type { FlaggedWord } from '../lib/asr/types';

const pct = (n: number | null) => (n === null ? 'n/a' : `${n}%`);

async function main() {
  const slugAt = process.argv.indexOf('--tenant');
  const slug = slugAt > -1 ? process.argv[slugAt + 1] : undefined;
  const db = getDb();

  const query = db.select({
    studentId: tasmiSubmissions.studentId, aiStatus: tasmiSubmissions.aiStatus, flags: tasmiSubmissions.aiFlaggedErrors,
    reviewVerdict: tasmiSubmissions.reviewVerdict, aiReadyForApproval: tasmiSubmissions.aiReadyForApproval,
  })
    .from(tasmiSubmissions)
    .innerJoin(users, eq(users.id, tasmiSubmissions.studentId))
    .innerJoin(tenants, eq(tenants.id, users.tenantId));
  const rows = (slug ? await query.where(eq(tenants.slug, slug)) : await query)
    .map((r): EvalRow => ({ ...r, flags: (r.flags ?? []) as FlaggedWord[] }));

  const r = summarizeEval(rows);
  console.log(`Recitations checked: ${r.checked} (reviewed by a teacher: ${r.reviewed}); could not hear: ${r.unclear}; failed: ${r.failed}`);
  console.log(`Flags decided: ${r.flags.confirmed + r.flags.dismissed} — confirmed ${r.flags.confirmed}, dismissed ${r.flags.dismissed}; undecided on reviewed recitations: ${r.flags.undecided}`);
  console.log(`Flag precision: ${pct(r.flags.precision)}`);
  for (const [type, t] of Object.entries(r.byType)) {
    const total = t.confirmed + t.dismissed;
    console.log(`  ${type.padEnd(8)} ${String(total).padStart(4)} decided  precision ${pct(total ? Math.round((t.confirmed / total) * 1000) / 10 : null)}`);
  }
  console.log(`Disputed by students: ${r.disputes.total} (teacher agreed with the student on ${r.disputes.dismissed})`);
  console.log(`"Ready for approval" hints: ${r.ready.total} (teacher approved ${r.ready.approved})`);
  console.log('Per student:');
  for (const s of r.perStudent) console.log(`  ${s.student}: ${s.reviewed} reviewed, ${s.decided} flags decided, precision ${pct(s.precision)}`);
  if (r.flags.confirmed + r.flags.dismissed < 30) {
    console.log('\nToo few decided flags to conclude anything yet: aim for at least 30 per kind of flag before judging accuracy.');
  }
}

main().then(() => closeDb()).catch(async (err) => {
  console.error('asr:eval failed:', err instanceof Error ? err.message : err);
  await closeDb();
  process.exit(1);
});
