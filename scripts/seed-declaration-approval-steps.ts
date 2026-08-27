// scripts/seed-declaration-approval-steps.ts
//
// Sets up the two approval steps for parent-filed absence and travel
// declarations (KD #196):
//
//   1. Form class adviser        — worked out from the child's class
//   2. Officer in charge         — Ms Lhen OR Ms Elaine, first to act carries it
//
// ── WHY A SCRIPT AND NOT A MIGRATION ───────────────────────────────────────
//
// Because the answer is a fact about the school, not about the schema, and it
// changes when the school changes. A migration would freeze two people into
// version control and then be wrong the first time somebody moves post.
//
// ⚠ PEOPLE ARE RESOLVED BY EMAIL, NEVER BY UUID. That is the whole reason this
// file is safe to commit: it names a job and an address, both of which are
// already public inside the school, and holds no account identifier at all.
//
// ── WHY THE OFFICER IN CHARGE IS ONE STEP AND NOT TWO ──────────────────────
//
// The school's own answer (2026-08-19) was "Form Class Adviser" then "Officer
// in Charge (Primary OR Secondary)" — the `or` is theirs. Mr Ace named the two
// holders on 2026-08-27 as "Primary OIC" and "Secondary OIC", which is how the
// SCHOOL labels the post, not a sequence: it matches his own description of the
// engine (a stage holds one or more approvers and the first to act carries it)
// and his own AEB worked example, which ends "4. Gary or Nina" as one stage.
//
// So both sit on step 2 and either can approve it. If the school later means a
// genuine order — Ms Lhen first, and only Ms Elaine if she is away — that is
// two steps, and it is three clicks at /sis/admin/approvers, not a code change.
// That flexibility is the point of the steps being configuration.
//
// IDEMPOTENT. Re-running adds nothing and changes nothing. Safe on production.
//
// Run:
//   npx tsx --env-file=.env.local scripts/seed-declaration-approval-steps.ts --apply
//
// Without `--apply` it reports what it would do and writes nothing.
import { createServiceClient } from '../lib/supabase/service';

const APPLY = process.argv.includes('--apply');

const FLOW = 'attendance.student_declaration';

const LADDER = [
  {
    label: 'Form class adviser',
    resolver: 'form_adviser' as const,
    // Derived from the child's own class every time somebody acts — including
    // a co-adviser and anyone covering the class that week. No list to keep.
    approverEmails: [] as string[],
  },
  {
    label: 'Officer in charge',
    resolver: 'named' as const,
    approverEmails: [
      'lhen.mendoza@hfse.edu.sg', // Ms Lhen — Hermilita Mendoza
      'elaine.wee@hfse.edu.sg', // Ms Elaine — May Ling Elaine Wee
    ],
  },
];

async function main() {
  const service = createServiceClient();

  // ── Resolve the people, and refuse to guess ──────────────────────────────
  const { data: userData, error: userErr } = await service.auth.admin.listUsers(
    { perPage: 1000 }
  );
  if (userErr) throw userErr;

  const byEmail = new Map(
    (userData?.users ?? [])
      .filter((u) => u.email)
      .map((u) => [u.email!.trim().toLowerCase(), u])
  );

  const missing: string[] = [];
  for (const stage of LADDER) {
    for (const email of stage.approverEmails) {
      const user = byEmail.get(email.toLowerCase());
      if (!user) {
        missing.push(`${email} — no account`);
        continue;
      }
      const role =
        (user.app_metadata as { role?: string } | null)?.role ??
        (user.user_metadata as { role?: string } | null)?.role ??
        null;
      // ⚠ A role-less account is a PARENT. auth.users is shared with roughly
      // five hundred of them, and naming one here would make a parent the
      // approver of their own child's absence.
      if (!role) missing.push(`${email} — has no staff role (parent account?)`);
    }
  }
  if (missing.length > 0) {
    console.error('Cannot seed — these people are not usable as approvers:');
    for (const m of missing) console.error(`  ${m}`);
    process.exit(1);
  }

  // ── What is already there ────────────────────────────────────────────────
  const { data: existingStages, error: stageErr } = await service
    .from('approval_stages')
    .select('id, stage_order, label, resolver')
    .eq('flow', FLOW)
    .eq('is_active', true)
    .order('stage_order', { ascending: true });
  if (stageErr) throw stageErr;

  const existing = (existingStages ?? []) as Array<{
    id: string;
    stage_order: number;
    label: string;
    resolver: string;
  }>;

  if (existing.length > 0) {
    console.log('Steps already configured for this flow:');
    for (const s of existing) {
      console.log(`  ${s.stage_order}. ${s.label} (${s.resolver})`);
    }
    console.log(
      '\nNothing to do. Edit them at /sis/admin/approvers rather than re-running this.'
    );
    return;
  }

  console.log(`Flow: ${FLOW}`);
  for (const [index, stage] of LADDER.entries()) {
    const people = stage.approverEmails
      .map((e) => byEmail.get(e.toLowerCase())?.email ?? e)
      .join(', ');
    console.log(
      `  ${index + 1}. ${stage.label} (${stage.resolver})${people ? ` — ${people}` : ''}`
    );
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write these.');
    return;
  }

  for (const [index, stage] of LADDER.entries()) {
    const { data: created, error } = await service
      .from('approval_stages')
      .insert({
        flow: FLOW,
        stage_order: index + 1,
        label: stage.label,
        resolver: stage.resolver,
        is_active: true,
      })
      .select('id')
      .single();
    if (error) throw error;
    const stageId = (created as { id: string }).id;

    for (const email of stage.approverEmails) {
      const user = byEmail.get(email.toLowerCase())!;
      const { error: approverErr } = await service
        .from('approval_stage_approvers')
        .insert({ stage_id: stageId, resolver: 'named', user_id: user.id });
      if (approverErr) throw approverErr;
    }
  }

  console.log('\nDone. Check it at /sis/admin/approvers.');
  console.log(
    '⚠ Anything parents filed BEFORE this has no approval ladder. Run\n' +
      '  npx tsx --env-file=.env.local scripts/repair-declaration-approvals.ts --apply\n' +
      'to put those on it.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
