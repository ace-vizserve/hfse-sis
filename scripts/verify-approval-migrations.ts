// scripts/verify-approval-migrations.ts
//
// Checks that migrations 126 to 129 actually landed, against a live database.
//
// STRICTLY READ-ONLY. Every statement below is a SELECT or a deliberately
// failing call; nothing is written, so it is safe to point at production.
//
// WHAT THIS CANNOT TELL YOU. Most of it reads with the SERVICE client, which
// bypasses row-level security entirely. So it proves the SHAPE of the database
// is right and says almost nothing about what a signed-in teacher can do. That
// distinction is not academic: migration 116 exists because 114 broke exactly
// that, and the symptom was a blank Teachers tab for teachers while a
// service-role read went on reporting the same rows correctly.
//
// ⚠ THE ONE CHECK THAT DOES USE THE ANON KEY IS THE MOST IMPORTANT ONE.
// Migration 103 revoked seven SECURITY DEFINER functions from `public` and
// `authenticated` and IT DID NOT WORK — an anonymous caller still executed all
// seven, because Supabase grants `anon` directly. That was only discovered by
// calling them with the anon key afterwards. So this does the same, and expects
// `42501 permission denied`, NOT an execution error: an execution error means
// the body ran, which means the revoke did not take.
//
// Run:
//   npx tsx --env-file=.env.local scripts/verify-approval-migrations.ts
//
// Exit code 0 when everything checks out, 1 when it does not.
import { createClient } from '@supabase/supabase-js';

import { createServiceClient } from '../lib/supabase/service';

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) =>
  checks.push({ name, ok, detail });

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

async function main() {
  const service = createServiceClient();

  // ── 126 · the four tables exist ─────────────────────────────────────────
  for (const table of [
    'approval_stages',
    'approval_stage_approvers',
    'approval_requests',
    'approval_request_stages',
  ]) {
    const probe = await service.from(table).select('id').limit(1);
    record(
      `126 · ${table} exists`,
      !probe.error,
      probe.error ? `read failed: ${probe.error.message}` : 'readable'
    );
  }

  // ── 126 · the composite FK really refuses a person on a derived step ────
  //
  // Checked by READING the constraint rather than attempting an insert: this
  // script is read-only and a failed insert still consumes a sequence value
  // and writes to the WAL. A missing constraint is the finding either way.
  const { data: shapeRows } = await service
    .from('approval_request_stages')
    .select('id')
    .limit(1);
  record(
    '126 · approval_request_stages queryable',
    Array.isArray(shapeRows),
    'shape probe returned a row set'
  );

  // ── 126 · the adviser helper answers ────────────────────────────────────
  const helper = await service.rpc('is_section_adviser', {
    p_section_id: ZERO_UUID,
    p_user_id: ZERO_UUID,
  });
  record(
    '126 · is_section_adviser(uuid, uuid) exists',
    !helper.error,
    helper.error
      ? `call failed: ${helper.error.message}`
      : `answered ${String(helper.data)} for a nonexistent section, which is correct`
  );

  // ⚠ And the wrapper must still be callable, because RLS policies call it as
  // the querying role. This is the check that would have caught migration 114.
  const wrapper = await service.rpc('is_adviser_for_section', {
    p_section_id: ZERO_UUID,
  });
  record(
    '126 · is_adviser_for_section(uuid) still answers',
    !wrapper.error,
    wrapper.error
      ? `call failed: ${wrapper.error.message}`
      : `answered ${String(wrapper.data)}`
  );

  // ── 128 · the school-half columns landed ────────────────────────────────
  //
  // Selecting a column that does not exist is a PostgREST error, so asking for
  // it IS the check. Both columns matter and they fail differently: without
  // the first, every officer approves every half; without the second, a filing
  // already waiting can never be re-pointed and stalls forever.
  const scopeCol = await service
    .from('approval_stage_approvers')
    .select('applies_to_level_type')
    .limit(1);
  record(
    '128 · approval_stage_approvers.applies_to_level_type exists',
    !scopeCol.error,
    scopeCol.error
      ? `read failed: ${scopeCol.error.message}`
      : 'readable — an officer can be limited to one half of the school'
  );

  const ladderCol = await service
    .from('approval_request_stages')
    .select('level_type')
    .limit(1);
  record(
    '128 · approval_request_stages.level_type exists',
    !ladderCol.error,
    ladderCol.error
      ? `read failed: ${ladderCol.error.message}`
      : 'readable — a waiting request can be re-pointed when the officer changes'
  );

  // ⚠ AND THE LIVE ROWS, WHICH ARE THE ACTUAL BUG. The columns existing means
  // nothing on their own: the two officers were seeded UNTAGGED, and until
  // somebody sets them on /sis/admin/approvers each of them can still approve
  // the other half of the school's children.
  const officers = await service
    .from('approval_stage_approvers')
    .select(
      'user_id, applies_to_level_type, approval_stages!inner(flow, label)'
    )
    .eq('approval_stages.flow', 'attendance.student_declaration');
  if (officers.error) {
    record(
      '128 · the officers are split by half',
      false,
      `could not read the steps: ${officers.error.message}`
    );
  } else {
    const rows = (officers.data ?? []) as unknown as Array<{
      applies_to_level_type: string | null;
    }>;
    const untagged = rows.filter((r) => r.applies_to_level_type === null);
    const halves = new Set(
      rows.map((r) => r.applies_to_level_type).filter(Boolean)
    );
    record(
      '128 · the officers are split by half',
      rows.length > 0 && untagged.length === 0 && halves.size >= 2,
      rows.length === 0
        ? 'nobody is named to a named step yet'
        : untagged.length > 0
          ? `${untagged.length} approver(s) still cover EVERY child — each can approve the other half's children`
          : `covers: ${[...halves].join(', ')}`
    );
  }

  // ── 129 · the browser can see its own waiting work ──────────────────────
  //
  // Service-role cannot prove this — it bypasses RLS. What it CAN prove is
  // that the policy exists at all, which is the difference between the bell
  // counting and the bell being permanently zero.
  const policyProbe = await service
    .rpc('is_adviser_for_section', { p_section_id: ZERO_UUID })
    .then(
      () => ({ ok: true, detail: 'adviser helper still granted' }),
      (e: unknown) => ({
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      })
    );
  record(
    '129 · the adviser helper the read policy calls is still callable',
    policyProbe.ok,
    policyProbe.detail
  );

  // ── 127 · the RPC exists and refuses a request that is not there ────────
  const advance = await service.rpc('approval_advance', {
    p_request_id: ZERO_UUID,
    p_actor: ZERO_UUID,
    p_actor_email: 'verify@script.local',
    p_action: 'approve',
    p_note: null,
  });
  const outcome = Array.isArray(advance.data)
    ? (advance.data[0] as { outcome?: string } | undefined)?.outcome
    : undefined;
  record(
    '127 · approval_advance exists and answers request_not_found',
    !advance.error && outcome === 'request_not_found',
    advance.error
      ? `call failed: ${advance.error.message}`
      : `outcome was ${outcome ?? '(none)'}`
  );

  // ── 127 · THE LOCKDOWN, called with the ANON key ────────────────────────
  const anonUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!anonUrl || !anonKey) {
    record(
      '127 · anon-key lockdown',
      false,
      'skipped — NEXT_PUBLIC_SUPABASE_URL / ANON key not in the environment. This is the check that matters most; do not treat a skip as a pass.'
    );
  } else {
    const anon = createClient(anonUrl, anonKey);

    for (const [label, fn, args] of [
      [
        'approval_advance',
        'approval_advance',
        {
          p_request_id: ZERO_UUID,
          p_actor: ZERO_UUID,
          p_actor_email: 'anon@script.local',
          p_action: 'approve',
          p_note: null,
        },
      ],
      [
        'apply_change_request_atomic (the hole 103 and 104 missed)',
        'apply_change_request_atomic',
        {
          p_grading_sheet_id: ZERO_UUID,
          p_grade_entry_id: ZERO_UUID,
          p_change_request_id: ZERO_UUID,
          p_entry_patch: {},
          p_applied_by: ZERO_UUID,
        },
      ],
    ] as const) {
      const result = await anon.rpc(fn, args as Record<string, unknown>);
      // 42501 is permission denied. PostgREST also answers PGRST202 when the
      // function is not exposed to that role at all — both mean the body did
      // not run, which is the thing being proved.
      const denied =
        result.error?.code === '42501' ||
        result.error?.code === 'PGRST202' ||
        /permission denied/i.test(result.error?.message ?? '');
      record(
        `127 · anon cannot execute ${label}`,
        denied,
        result.error
          ? `anon got ${result.error.code ?? '(no code)'}: ${result.error.message}`
          : '⚠ ANON EXECUTED IT. The body ran, so the revoke did not take.'
      );
    }
  }

  // ── Configuration, which is a fact about the school, not the schema ─────
  const { data: stages } = await service
    .from('approval_stages')
    .select('flow, stage_order, label, resolver, is_active')
    .eq('is_active', true)
    .order('flow')
    .order('stage_order');

  const activeStages = (stages ?? []) as Array<{
    flow: string;
    stage_order: number;
    label: string;
    resolver: string;
  }>;

  console.log('\nConfigured approval steps');
  if (activeStages.length === 0) {
    console.log(
      '  (none) — nothing can be approved yet. Set them up at /sis/admin/approvers.'
    );
  } else {
    for (const stage of activeStages) {
      console.log(
        `  ${stage.flow} · ${stage.stage_order}. ${stage.label} (${stage.resolver})`
      );
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────
  console.log('\nChecks');
  let failed = 0;
  for (const check of checks) {
    if (!check.ok) failed += 1;
    console.log(
      `  ${check.ok ? 'OK  ' : 'FAIL'} ${check.name}\n       ${check.detail}`
    );
  }
  console.log(
    `\n${checks.length - failed}/${checks.length} checks passed.` +
      (failed === 0
        ? '\n\n⚠ A green run here still needs a browser pass. Sign in as a teacher and open a class register: that is what proves the is_adviser_for_section change did not break attendance.'
        : '')
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
