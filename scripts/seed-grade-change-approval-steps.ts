// scripts/seed-grade-change-approval-steps.ts
//
// Sets up the approval steps for grade change requests (KD #196, migration
// 144). There are two, and the teacher never chooses between them — the system
// does, from whether parents have already seen the grade on a report card:
//
//   markbook.grade_change       — before the report card is published
//     1. Grade change approvers  — everyone in today's two-approver pool
//                                  (`approver_assignments`, flow
//                                  'markbook.change_request'). Whoever acts
//                                  first carries it, which is how the pool
//                                  already behaved, so nothing changes for
//                                  anybody on day one.
//
//   markbook.grade_change_aeb   — after publication: the Academic and
//                                  Examination Board, in this order
//     1. Ms Chandana
//     2. Ms Christina
//     3. Ms Norma
//     4. Mr Gary or Ms Nina      — both on the one step; first to act carries it
//
// ── WHY A SCRIPT AND NOT A MIGRATION ───────────────────────────────────────
//
// The same reason as scripts/seed-declaration-approval-steps.ts: who approves
// is a fact about the school, not the schema, and it changes when people move
// post. After this runs once, the steps are edited at /sis/admin/approvers.
//
// ⚠ PEOPLE ARE RESOLVED BY EMAIL, NEVER BY UUID, and the Board's emails are
// passed on the command line rather than written here — so this file names
// jobs, not accounts.
//
// ⚠ STAFF ACCOUNTS ONLY. `auth.users` is shared with roughly five hundred
// PARENT accounts, which are exactly the role-less rows. The filter below is
// the one `listStagedApproverCandidates` (lib/approvals/config.ts) uses — at
// least one role, and not switched off — so this script can never put on a
// step somebody the approvers screen would refuse to offer.
//
// ⚠ RAW INSERTS, NOT `createStage` / `assignStageApprover`. Those live in
// lib/approvals/config.ts, which is `server-only`, and that package throws
// outright under tsx. The inserts below write the same columns those two
// functions write, in the same way: a new step goes on the end, and a person
// on a step is `resolver = 'named'`, covering every child.
//
// ── IDEMPOTENT ─────────────────────────────────────────────────────────────
//
// A flow that already has active steps is left exactly as it is, and the
// script says so. Re-running adds nothing and changes nothing. Safe on
// production.
//
// Run (dry run first — it prints the plan and writes nothing):
//
//   npx tsx --env-file=.env.local scripts/seed-grade-change-approval-steps.ts \
//     --aeb-chandana <email> --aeb-christina <email> --aeb-norma <email> \
//     --aeb-gary <email> --aeb-nina <email> --dry-run
//
// Then the same command without `--dry-run`. Leave all five `--aeb-*` flags
// off to seed only the before-publication flow.
import type { User } from '@supabase/supabase-js';

import { getUserRoleSet } from '../lib/auth/roles';
import { createServiceClient } from '../lib/supabase/service';

const DRY_RUN = process.argv.includes('--dry-run');

const NORMAL_FLOW = 'markbook.grade_change';
const AEB_FLOW = 'markbook.grade_change_aeb';
const POOL_FLOW = 'markbook.change_request';

const AEB_FLAGS = [
  'aeb-chandana',
  'aeb-christina',
  'aeb-norma',
  'aeb-gary',
  'aeb-nina',
] as const;
type AebFlag = (typeof AEB_FLAGS)[number];

/** The Board, in order. Step 4 holds two people; either one carries it. */
const AEB_STEPS: Array<{ label: string; flags: AebFlag[] }> = [
  { label: 'Ms Chandana', flags: ['aeb-chandana'] },
  { label: 'Ms Christina', flags: ['aeb-christina'] },
  { label: 'Ms Norma', flags: ['aeb-norma'] },
  { label: 'Mr Gary or Ms Nina', flags: ['aeb-gary', 'aeb-nina'] },
];

const NORMAL_STEP_LABEL = 'Grade change approvers';

type Service = ReturnType<typeof createServiceClient>;

type PlannedPerson = { userId: string; email: string };
type PlannedStep = { label: string; people: PlannedPerson[] };

/** Loud, and easy to spot in a wall of output. */
function loud(message: string) {
  console.log('');
  console.log(`!!! ${message}`);
  console.log('');
}

/** `--flag value` or `--flag=value`. */
function readFlag(name: string): string | null {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === `--${name}`) {
      const next = argv[i + 1];
      return next && !next.startsWith('--') ? next.trim() : '';
    }
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3).trim();
  }
  return null;
}

async function listEveryUser(service: Service): Promise<User[]> {
  const perPage = 1000;
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;
    const batch = data?.users ?? [];
    users.push(...batch);
    if (batch.length < perPage) return users;
  }
}

/**
 * Why this account cannot go on a step, or `null` if it can. Mirrors
 * `listStagedApproverCandidates`: a staff role, and not switched off.
 */
function whyNotUsable(user: User | undefined): string | null {
  if (!user) return 'no account with that email';
  // ⚠ A role-less account is a PARENT. See the header.
  if (getUserRoleSet(user).length === 0) {
    return 'the account has no staff role (a parent account?)';
  }
  if (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) {
    return 'the account is switched off';
  }
  return null;
}

async function activeSteps(service: Service, flow: string) {
  const { data, error } = await service
    .from('approval_stages')
    .select('id, stage_order, label, resolver')
    .eq('flow', flow)
    .eq('is_active', true)
    .order('stage_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    stage_order: number;
    label: string;
    resolver: string;
  }>;
}

function printPlan(flow: string, steps: PlannedStep[]) {
  console.log(`Flow: ${flow}`);
  for (const [index, step] of steps.entries()) {
    const people =
      step.people.length > 0
        ? step.people.map((p) => p.email).join(', ')
        : '(nobody — this step will block filing until someone is added)';
    console.log(`  ${index + 1}. ${step.label} — ${people}`);
  }
}

/** Prints the plan, then writes it unless this is a dry run. */
async function seedFlow(
  service: Service,
  flow: string,
  steps: PlannedStep[]
): Promise<void> {
  printPlan(flow, steps);
  if (DRY_RUN) {
    console.log('  (dry run — nothing written)\n');
    return;
  }

  // Empty flow, checked by the caller, so the steps are numbered from 1 — the
  // same "on the end" rule `createStage` applies.
  for (const [index, step] of steps.entries()) {
    const { data: created, error } = await service
      .from('approval_stages')
      .insert({
        flow,
        stage_order: index + 1,
        label: step.label,
        resolver: 'named',
        is_active: true,
        created_by: null,
      })
      .select('id')
      .single();
    if (error) {
      throw new Error(
        `Could not add step "${step.label}" to ${flow}: ${error.message}. ` +
          'Any steps already added are live — finish or remove them at ' +
          '/sis/admin/approvers, because re-running will leave this flow alone.'
      );
    }
    const stageId = (created as { id: string }).id;

    for (const person of step.people) {
      const { error: approverErr } = await service
        .from('approval_stage_approvers')
        .insert({
          stage_id: stageId,
          resolver: 'named',
          user_id: person.userId,
          // Every child. The Board and the pool are not split by half.
          applies_to_level_type: null,
          created_by: null,
        });
      // Already on this step — the same person passed twice. Not a failure.
      if (approverErr && approverErr.code !== '23505') {
        throw new Error(
          `Could not add ${person.email} to "${step.label}": ${approverErr.message}`
        );
      }
    }
  }
  console.log('  Written.\n');
}

async function main() {
  // ── Read the command line before touching anything ───────────────────────
  const aebEmails = new Map<AebFlag, string>();
  const missingFlags: string[] = [];
  for (const flag of AEB_FLAGS) {
    const value = readFlag(flag);
    if (value) aebEmails.set(flag, value.toLowerCase());
    else missingFlags.push(`--${flag}`);
  }
  const seedAeb = aebEmails.size > 0;
  if (seedAeb && missingFlags.length > 0) {
    // Some given and some not is a typo, not a choice. Refuse before writing
    // anything, rather than seed a Board with a hole in it by accident.
    console.error(
      `Missing ${missingFlags.join(', ')}. Give all five --aeb-* emails, or none of them to skip the Academic and Examination Board.`
    );
    process.exit(1);
  }

  const service = createServiceClient();

  const users = await listEveryUser(service);
  const byEmail = new Map(
    users
      .filter((u) => u.email)
      .map((u) => [u.email!.trim().toLowerCase(), u] as const)
  );
  const byId = new Map(users.map((u) => [u.id, u] as const));

  if (DRY_RUN) console.log('DRY RUN — nothing will be written.\n');

  // ── Before publication: one step, today's pool ───────────────────────────
  const normalExisting = await activeSteps(service, NORMAL_FLOW);
  if (normalExisting.length > 0) {
    console.log(`Flow: ${NORMAL_FLOW} — already has steps, left alone:`);
    for (const s of normalExisting) {
      console.log(`  ${s.stage_order}. ${s.label} (${s.resolver})`);
    }
    console.log('');
  } else {
    const { data: poolRows, error: poolErr } = await service
      .from('approver_assignments')
      .select('user_id, created_at')
      .eq('flow', POOL_FLOW)
      .order('created_at', { ascending: true });
    if (poolErr) throw poolErr;

    const people: PlannedPerson[] = [];
    const seen = new Set<string>();
    for (const row of (poolRows ?? []) as Array<{ user_id: string }>) {
      if (seen.has(row.user_id)) continue;
      seen.add(row.user_id);
      const user = byId.get(row.user_id);
      const problem = whyNotUsable(user);
      if (problem) {
        loud(
          `NOT ADDED to "${NORMAL_STEP_LABEL}": ${user?.email ?? row.user_id} — ${problem}.`
        );
        continue;
      }
      people.push({ userId: user!.id, email: user!.email ?? row.user_id });
    }
    if (people.length === 0) {
      loud(
        `The two-approver pool for ${POOL_FLOW} has nobody usable in it. The step is ` +
          'created empty, and teachers cannot file a grade change before publication ' +
          'until someone is added at /sis/admin/approvers.'
      );
    }

    await seedFlow(service, NORMAL_FLOW, [
      { label: NORMAL_STEP_LABEL, people },
    ]);
  }

  // ── After publication: the Academic and Examination Board ───────────────
  const aebExisting = await activeSteps(service, AEB_FLOW);
  if (aebExisting.length > 0) {
    console.log(`Flow: ${AEB_FLOW} — already has steps, left alone:`);
    for (const s of aebExisting) {
      console.log(`  ${s.stage_order}. ${s.label} (${s.resolver})`);
    }
    console.log('');
  } else if (!seedAeb) {
    console.log(
      `Flow: ${AEB_FLOW} — skipped, no --aeb-* emails given. It has no steps, so ` +
        'teachers cannot file a grade change after publication until it is set up.\n'
    );
  } else {
    const steps: PlannedStep[] = AEB_STEPS.map((step) => {
      const people: PlannedPerson[] = [];
      for (const flag of step.flags) {
        const email = aebEmails.get(flag)!;
        const user = byEmail.get(email);
        const problem = whyNotUsable(user);
        if (problem) {
          // ⚠ The step is still created — leaving it out would silently
          // shorten the Board. It is created without this person, and the
          // approvers screen will show it as having nobody on it.
          loud(
            `NOT ADDED to "${step.label}": ${email} (--${flag}) — ${problem}. ` +
              'The step is created without them. Add the right person at /sis/admin/approvers.'
          );
          continue;
        }
        people.push({ userId: user!.id, email: user!.email ?? email });
      }
      return { label: step.label, people };
    });

    await seedFlow(service, AEB_FLOW, steps);
  }

  if (DRY_RUN) {
    console.log('Dry run finished. Re-run without --dry-run to write.');
  } else {
    console.log('Done. Check it at /sis/admin/approvers.');
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
