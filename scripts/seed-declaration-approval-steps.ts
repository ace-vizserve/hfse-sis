// scripts/seed-declaration-approval-steps.ts
//
// Sets up the two approval steps for parent-filed absence and travel
// declarations (KD #196):
//
//   1. Form class adviser        — worked out from the child's class
//   2. Officer in charge         — Ms Lhen for PRIMARY, Ms Elaine for SECONDARY
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
// ── THE OFFICER IN CHARGE IS ONE STEP, WITH ONE OFFICER PER HALF ───────────
//
// ⚠ AN EARLIER VERSION OF THIS HEADER ARGUED SOMETHING WRONG, AND IT SEEDED
// PRODUCTION WRONG. It read the school's 2026-08-19 answer — "Form Class
// Adviser", then "Officer in Charge (Primary OR Secondary)" — as *either of
// two approvers, whoever acts first*, and put both people on the step sharing
// it. That let the SECONDARY officer approve a Primary child's absence and the
// primary officer a Secondary child's, across 15 primary and 6 secondary
// classes. The argument even cited the AEB's "Gary or Nina" as support, which
// is a different thing entirely: that really is two interchangeable people.
//
// "Primary or Secondary" is the YEAR CATEGORY. Mr Ace, 2026-08-27:
//
//   "the OIC is per year category hence Primary and Secondary — so if the
//    submitted approval by the parent is a student from primary then use the
//    OIC for Primary"
//
// So it stays ONE step, because it is one job in the sequence — but each
// person on it carries the half they hold (`applies_to_level_type`, migration
// 128), and the child decides which of them it goes to. If the school ever
// means a genuine order — Ms Lhen first, and only Ms Elaine if she is away —
// that is two steps, and it is three clicks at /sis/admin/approvers rather
// than a code change. That flexibility is the point of steps being
// configuration.
//
// IDEMPOTENT. Re-running adds nothing and changes nothing. Safe on production.
//
// Run:
//   npx tsx --env-file=.env.local scripts/seed-declaration-approval-steps.ts --apply
//
// Without `--apply` it reports what it would do and writes nothing.
import { getUserRoleSet } from '../lib/auth/roles';
import { createServiceClient } from '../lib/supabase/service';

const APPLY = process.argv.includes('--apply');

const FLOW = 'attendance.student_declaration';

type SeedApprover = {
  email: string;
  /** Which half of the school. `null` would mean every child. */
  appliesToLevelType: 'primary' | 'secondary' | 'preschool' | null;
};

const LADDER: Array<{
  label: string;
  resolver: 'named' | 'form_adviser';
  approvers: SeedApprover[];
}> = [
  {
    label: 'Form class adviser',
    resolver: 'form_adviser',
    // Derived from the child's own class every time somebody acts — including
    // a co-adviser and anyone covering the class that week. No list to keep.
    approvers: [],
  },
  {
    label: 'Officer in charge',
    resolver: 'named',
    approvers: [
      // ⚠ TWO POSTS, NOT TWO INTERCHANGEABLE APPROVERS. See the header.
      // ⚠ TWO ELAINES EXIST — elaine.fong@ is a different person (Sec 3
      // English). Never resolve "Ms Elaine" from a first name.
      {
        email: 'lhen.mendoza@hfse.edu.sg', // Ms Lhen — Hermilita Mendoza
        appliesToLevelType: 'primary',
      },
      {
        email: 'elaine.wee@hfse.edu.sg', // Ms Elaine — May Ling Elaine Wee
        appliesToLevelType: 'secondary',
      },
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
    for (const { email } of stage.approvers) {
      const user = byEmail.get(email.toLowerCase());
      if (!user) {
        missing.push(`${email} — no account`);
        continue;
      }
      // Every role the account holds — the question is whether this person is
      // staff at all, and an account that holds two is no less staff for it.
      const roles = getUserRoleSet(user);
      // ⚠ A role-less account is a PARENT. auth.users is shared with roughly
      // five hundred of them, and naming one here would make a parent the
      // approver of their own child's absence.
      if (roles.length === 0)
        missing.push(`${email} — has no staff role (parent account?)`);
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
    // ⚠ THE NO-OP IS WHY PRODUCTION CANNOT BE FIXED FROM HERE. The two live
    // rows were seeded before anybody carried a half, so they still read "every
    // child" — which is the bug. Set them on the approvers page; this script
    // will never overwrite what is already there.
    console.log(
      '⚠ If the officer in charge is not split into Primary and Secondary there,\n' +
        '  each of them can still approve the other half of the school’s children.'
    );
    return;
  }

  console.log(`Flow: ${FLOW}`);
  for (const [index, stage] of LADDER.entries()) {
    const people = stage.approvers
      .map((a) => {
        const resolved = byEmail.get(a.email.toLowerCase())?.email ?? a.email;
        return a.appliesToLevelType
          ? `${resolved} (${a.appliesToLevelType})`
          : `${resolved} (every child)`;
      })
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

    for (const approver of stage.approvers) {
      const user = byEmail.get(approver.email.toLowerCase())!;
      const { error: approverErr } = await service
        .from('approval_stage_approvers')
        .insert({
          stage_id: stageId,
          resolver: 'named',
          user_id: user.id,
          applies_to_level_type: approver.appliesToLevelType,
        });
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
