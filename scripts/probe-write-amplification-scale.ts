// scripts/probe-write-amplification-scale.ts
//
// Phase 5 (app-wide query/write pass) — sizes every write loop that
// `scripts/audit/row-at-a-time-writes.ts` enumerates, against PRODUCTION, so
// each row of the reconciliation is exempted on a measured number rather than
// on how the loop reads.
//
// The rule this exists to serve: a loop over three rows is not a finding. The
// only way to tell a three-row loop from a three-hundred-row one is to count
// the rows at HFSE's actual scale, and several estimates on this pass have
// already been wrong by an order of magnitude in both directions.
//
// STRICTLY READ-ONLY. Every statement below is a `select`; nothing here
// inserts, updates, upserts or calls an RPC.
//
// Modelled on scripts/probe-import-rollup-cost.ts, which established this
// pass's read-only probe discipline.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-write-amplification-scale.ts
//
// Exit code is always 0 — this reports, it does not gate a build.
import { createServiceClient } from '../lib/supabase/service';

async function main() {
  const svc = createServiceClient();
  const line = (label: string, value: string | number) =>
    console.log(`  ${label.padEnd(58)} ${value}`);

  console.log(
    '\n=============================================================================='
  );
  console.log('WRITE-LOOP SCALE — production row counts behind each exemption');
  console.log(
    '=============================================================================='
  );

  // ── academic_years / terms ────────────────────────────────────────────────
  // Bounds app/api/sis/ay-setup/accepting-applications/route.ts (the
  // close-others loop) and app/api/sections/[id]/students/[enrolmentId]
  // (one rollup RPC per term of the section's AY).
  const { data: ays } = await svc
    .from('academic_years')
    .select('id, ay_code, accepting_applications')
    .order('ay_code');
  const ayRows = (ays ?? []) as Array<{
    id: string;
    ay_code: string;
    accepting_applications: boolean | null;
  }>;
  console.log('\n-- academic years / terms --');
  line('academic_years rows', ayRows.length);
  line(
    'academic_years with accepting_applications = true',
    ayRows.filter((a) => a.accepting_applications).length
  );
  for (const ay of ayRows) {
    const { count } = await svc
      .from('terms')
      .select('id', { count: 'exact', head: true })
      .eq('academic_year_id', ay.id);
    line(`terms in ${ay.ay_code}`, count ?? 0);
  }

  // ── grading sheets ────────────────────────────────────────────────────────
  // Bounds lib/grading/sync-config-sheets.ts (the qa_total settle loop runs
  // over the UNLOCKED sheets of ONE subject config) and
  // app/api/grading-sheets/lock-overdue (already chunked at 200).
  console.log('\n-- grading sheets --');
  const { count: sheetsTotal } = await svc
    .from('grading_sheets')
    .select('id', { count: 'exact', head: true });
  const { count: sheetsUnlocked } = await svc
    .from('grading_sheets')
    .select('id', { count: 'exact', head: true })
    .eq('is_locked', false);
  line('grading_sheets, all years', sheetsTotal ?? 0);
  line('grading_sheets unlocked, all years', sheetsUnlocked ?? 0);

  // Worst-case fan-out of the qa_total loop: the most unlocked sheets any one
  // subject_config owns. Sheets reach a config via their subject_config_id.
  const { data: openSheets } = await svc
    .from('grading_sheets')
    .select('id, subject_config_id')
    .eq('is_locked', false)
    .limit(2000);
  const perConfig = new Map<string, number>();
  for (const s of (openSheets ?? []) as Array<{
    subject_config_id: string | null;
  }>) {
    const k = s.subject_config_id ?? '(none)';
    perConfig.set(k, (perConfig.get(k) ?? 0) + 1);
  }
  const worstConfig = [...perConfig.values()].reduce(
    (a, b) => Math.max(a, b),
    0
  );
  line('distinct subject_configs holding an unlocked sheet', perConfig.size);
  line('MOST unlocked sheets under any ONE subject_config', worstConfig);

  // ── approval ladders ──────────────────────────────────────────────────────
  // Bounds lib/approvals/materialise.ts (repointWaitingStages walks the open
  // named-resolver stages of one flow) and lib/approvals/config.ts (a fixed
  // three-write park/swap, listed for completeness).
  console.log('\n-- approval ladders --');
  const { count: stagesTotal } = await svc
    .from('approval_request_stages')
    .select('id', { count: 'exact', head: true });
  const { count: stagesOpenNamed } = await svc
    .from('approval_request_stages')
    .select('id', { count: 'exact', head: true })
    .eq('resolver', 'named')
    .in('status', ['pending', 'waiting']);
  const { count: stagesConfigured } = await svc
    .from('approval_stages')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);
  line('approval_request_stages, all', stagesTotal ?? 0);
  line("open named stages (the repoint loop's ceiling)", stagesOpenNamed ?? 0);
  line('active configured approval_stages', stagesConfigured ?? 0);

  // ── p-files expiring slots ────────────────────────────────────────────────
  // freshen-document-statuses fans out 2 writes per expiring slot, in ONE
  // Promise.all. The count is a code constant, not a data one — printed here
  // only so the reconciliation's "fixed at 16" is checkable.
  console.log('\n-- p-files --');
  line(
    'freshen fan-out is a code constant (EXPIRING_SLOTS x 2)',
    'see lib/p-files/document-config.ts — 8 slots carry an expiryCol, so 16'
  );

  // ── AY2025 backfill scale (item 7) ────────────────────────────────────────
  // The one-off backfill upserts subject_configs and grading_sheets ONE ROW AT
  // A TIME with the chunked form twenty lines below. These are the counts that
  // loop actually produced.
  console.log('\n-- AY2025 backfill (scripts/backfill/ay2025-grades.ts) --');
  const ay2025 = ayRows.find((a) => a.ay_code === 'AY2025');
  if (!ay2025) {
    line('AY2025', 'not found');
  } else {
    const { count: cfgCount } = await svc
      .from('subject_configs')
      .select('id', { count: 'exact', head: true })
      .eq('academic_year_id', ay2025.id);
    const { data: ay2025Sections } = await svc
      .from('sections')
      .select('id')
      .eq('academic_year_id', ay2025.id);
    const sectionIds = ((ay2025Sections ?? []) as Array<{ id: string }>).map(
      (s) => s.id
    );
    const { count: sheetCount } = await svc
      .from('grading_sheets')
      .select('id', { count: 'exact', head: true })
      .in('section_id', sectionIds);
    line('subject_configs rows the backfill upserts one-by-one', cfgCount ?? 0);
    line(
      'grading_sheets rows the backfill upserts one-by-one',
      sheetCount ?? 0
    );
    line('AY2025 sections', sectionIds.length);
  }

  // ── students sync (item 7 / item 8) ───────────────────────────────────────
  // syncOneStudent plans from ONE admissions row, so its three write loops are
  // per-student, not per-roster. The bulk route is the roster-sized one.
  console.log('\n-- students sync --');
  const { count: studentCount } = await svc
    .from('students')
    .select('id', { count: 'exact', head: true });
  line(
    'public.students rows (the bulk sync’s snapshot read)',
    studentCount ?? 0
  );

  console.log(
    '\n------------------------------------------------------------------------------'
  );
  console.log('Read-only. Nothing above writes.');
  console.log(
    '------------------------------------------------------------------------------\n'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(0);
});
