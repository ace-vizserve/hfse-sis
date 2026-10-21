/**
 * Billing's one bulk job, run by hand (KD #232 update 2026-10-16 — Billing
 * Settings holds the QuickBooks connection only; nothing else is set up).
 *
 * Link students: match every unlinked student to their QuickBooks customer
 * (typed invoice number, sibling, same name); misses go to To review, and
 * each newly linked student's invoices and payments are loaded.
 *
 * --reclassify: instead, re-tie every stored invoice (lib/billing/tie.ts —
 * an invoice keeps the tie it has; one with none is tied to the Registration
 * / Fees stage whose typed invoice number is its number), then recompute the
 * stages. Needed once after the switch to ties (migration 195).
 *
 * Dry run by default; --apply saves. --actor names the staff account written
 * to the audit log (required).
 *
 *   npx tsx --conditions=react-server --env-file=<env file> \
 *     --import ./scripts/local/seed/harness/register.mjs \
 *     scripts/qbo/billing-link.ts \
 *     --actor ace.guevarra@vizserve.hfse.edu.sg [--reclassify] [--apply]
 *
 * The --import harness is required: without it every stage write fails
 * outside Next (tiptap's browser build, next/cache). It also blanks
 * RESEND_API_KEY, so the run sends no SIS email.
 */
import { runLink } from '@/lib/billing/link-run.server';
import { retieAndSyncTiles } from '@/lib/billing/maps.server';
import { createServiceClient } from '@/lib/supabase/service';
import { listAllAuthUsers } from '@/lib/supabase/paginate';

const service = createServiceClient();
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const apply = flag('apply');

async function main() {
  const email = value('actor');
  if (!email || email.startsWith('--'))
    throw new Error(
      '--actor <staff email> is required (it goes in the audit log).'
    );
  const users = await listAllAuthUsers(service);
  const user = users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (!user) throw new Error(`No account with email ${email}.`);

  const { data: conn, error } = await service
    .from('qbo_connection')
    .select('environment, company_name')
    .eq('id', 1)
    .maybeSingle();
  if (error)
    throw new Error(`QuickBooks connection lookup failed: ${error.message}`);
  if (!conn)
    throw new Error(
      'QuickBooks is not connected. Connect it in Billing → QuickBooks first.'
    );
  console.log(
    [
      `Supabase:   ${process.env.NEXT_PUBLIC_SUPABASE_URL}`,
      `QuickBooks: ${conn.company_name ?? '?'} (${conn.environment})`,
      `Actor:      ${user.email}`,
      apply ? 'APPLYING' : 'DRY RUN — add --apply to save',
      '',
    ].join('\n')
  );

  if (flag('reclassify')) {
    const r = await retieAndSyncTiles(service, { dryRun: !apply });
    const label = (ay: string | null, stages: string[]) =>
      ay && stages.length ? `${stages.join('+')} ${ay}` : '(no stage)';
    console.log(
      `Re-tie — stored invoices by reason: already tied ${r.reasons.kept} · typed number ${r.reasons.typed} · no tie ${r.reasons.none}`
    );
    console.log(
      `Invoices whose tie ${apply ? 'changed' : 'would change'}: ${r.moves.length} (${r.studentsAffected} students)`
    );
    for (const m of r.moves)
      console.log(
        `  ${(m.docNumber ?? m.id).padEnd(14)} ${m.studentNumber.padEnd(10)} ${label(m.fromAy, m.fromStages)} → ${label(m.toAy, m.toStages)} (${m.reason})`
      );
    if (r.tileErrors.length) {
      console.log('\nTile problems:');
      for (const e of r.tileErrors) console.log(`  ${e}`);
      process.exitCode = 1;
    }
    return;
  }

  const result = await runLink(service, {
    dryRun: !apply,
    actor: { id: user.id, email: user.email ?? null, role: 'superadmin' },
  });
  console.log('Link students:', JSON.stringify(result, null, 2));
  if (result.historyErrors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
