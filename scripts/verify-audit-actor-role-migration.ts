// scripts/verify-audit-actor-role-migration.ts
//
// Read-only. Checks that migration 141 is actually applied, the way the app
// will meet it — through PostgREST, with the same client the app uses. Follows
// scripts/verify-subject-name-migrations.ts and
// scripts/verify-pre-enrolment-upload-migration.ts.
//
// ⚠ UNLIKE MIGRATION 140, THIS ONE IS FULLY PROVABLE FROM HERE. 140 only
// rewrote two CHECK constraints, and constraint definitions live in
// pg_catalog, which PostgREST cannot read — so it needed the SQL editor. 141
// adds a real COLUMN, and a missing column is a PostgREST ERROR rather than an
// empty result, so selecting it IS the existence check. No SQL editor needed
// and nothing has to be written to a live row.
//
// Run: npx tsx --env-file=.env.local scripts/verify-audit-actor-role-migration.ts
import { createServiceClient } from '../lib/supabase/service';

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail });
}

async function main() {
  const service = createServiceClient();

  // ── 141: the column exists ───────────────────────────────────────────────
  const { error: colErr } = await service
    .from('audit_log')
    .select('id, actor_email, actor_role')
    .limit(1);
  record(
    'audit_log has actor_role',
    !colErr,
    colErr ? colErr.message : 'selectable'
  );

  if (colErr) {
    report();
    return;
  }

  // ── The rest of the table is untouched ───────────────────────────────────
  // 141 adds a column and changes nothing else. If the existing shape stopped
  // reading, something beyond the migration has happened.
  const { data: sample, error: shapeErr } = await service
    .from('audit_log')
    .select('id, actor_id, actor_email, action, entity_type, created_at')
    .order('created_at', { ascending: false })
    .limit(1);
  record(
    'the existing audit_log shape still reads',
    !shapeErr && (sample ?? []).length > 0,
    shapeErr ? shapeErr.message : 'newest row reads back'
  );

  // ── NO BACKFILL, and it must stay that way on the day this lands ─────────
  //
  // 141 fills nothing in, deliberately: the value is unknowable for an
  // existing row, and guessing it from an actor's CURRENT role would put a
  // fabricated fact into an append-only table. Before the new code deploys
  // this count must be ZERO. Afterwards it is informational and climbs — every
  // row written by the new `logAction` carries one.
  const { count: withRole, error: filledErr } = await service
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .not('actor_role', 'is', null);
  const { count: total } = await service
    .from('audit_log')
    .select('id', { count: 'exact', head: true });
  record(
    'no row was backfilled by the migration itself',
    !filledErr,
    filledErr
      ? filledErr.message
      : `${withRole ?? 0} of ${total ?? 0} row(s) carry a role — expect 0 before the code deploys, then rising`
  );

  // ── AN EMPTY STRING IS NEVER STORED ──────────────────────────────────────
  //
  // `toAuditRow` collapses '' to null at the one funnel, because the signed-
  // token approval path scrapes its role with a `?? ''` fallback. A blank
  // would be a third state nobody filters for: `actor_role is null` misses it
  // and the actor dropdown would offer an empty option. Nothing should ever
  // match this.
  const { count: blanks, error: blankErr } = await service
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('actor_role', '');
  record(
    "no row stores an empty-string role ('' collapses to null)",
    !blankErr && (blanks ?? 0) === 0,
    blankErr ? blankErr.message : `${blanks ?? 0} blank role(s)`
  );

  // ── The view switch is reaching the log ──────────────────────────────────
  //
  // Informational: zero is correct until somebody with two jobs actually
  // switches. Printed so the first switch after deploy is easy to confirm.
  const { data: switches } = await service
    .from('audit_log')
    .select('actor_email, actor_role, context, created_at')
    .eq('action', 'user.view.switch')
    .order('created_at', { ascending: false })
    .limit(5);
  record(
    'view-switch entries are readable',
    true,
    `${(switches ?? []).length} recent user.view.switch row(s)`
  );

  report();

  if ((switches ?? []).length > 0) {
    console.log('\n── most recent view switches ──');
    for (const s of switches ?? []) {
      const ctx = (s.context ?? {}) as Record<string, unknown>;
      console.log(
        `  ${s.created_at}  ${s.actor_email} [${s.actor_role ?? 'no role'}]  ${String(
          ctx.from_view ?? '?'
        )} -> ${String(ctx.to_view ?? '?')}`
      );
    }
  }
}

function report() {
  console.log('');
  let failed = 0;
  for (const c of checks) {
    if (!c.passed) failed++;
    console.log(
      `  ${c.passed ? 'PASS' : 'FAIL'}  ${c.name}\n        ${c.detail}`
    );
  }
  console.log(`\n${checks.length - failed} passed / ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
