// Phase "staff": the staff accounts every later phase acts as, and the
// approver wiring production has, pointed at them.
//
// Accounts go through `auth.admin.createUser` with the metadata shape the app
// reads (`app_metadata.role` array + `active_role`, `user_metadata.display_name`;
// see lib/auth/roles.ts). Named approval steps are filled through the app's own
// `assignStageApprover` (lib/approvals/config.ts — a `server-only` module,
// which is the harness proof for this phase). The pooled change-request flow
// has no lib writer — its route inserts directly — so that insert is mirrored
// here, with the route's audit row.

import { assignStageApprover } from '@/lib/approvals/config';
import { logAction } from '@/lib/audit/log-action';
import type { Role } from '@/lib/auth/roles';
import { STAGED_FLOW_LABELS } from '@/lib/schemas/approval-flows';

import { LOCAL_EMAIL_DOMAIN, LOCAL_PASSWORD } from '../lib/constants';
import { must, service } from '../lib/local';
import { uuidFrom } from '../lib/random';

export type StaffKey =
  | 'superadmin'
  | 'coordScience'
  | 'coord'
  | 'oicPrimary'
  | 'oicSecondary'
  | 'asstPrincipal'
  | 'aeb'
  | 'admissions'
  | 'documents'
  | `teacher${number}`
  | 'relief';

type StaffSpec = {
  key: StaffKey;
  local: string; // email local part
  name: string;
  roles: Role[];
  note: string;
};

// ⚠ NO `p_file_officer`. That role was retired on 2026-09-10 (lib/auth/roles.ts:
// "admissions absorbed the whole document lifecycle"); `role_permissions` has
// no row for it. The documents officer is an `admissions` account instead.
export const STAFF: StaffSpec[] = [
  {
    key: 'superadmin',
    local: 'admin',
    name: 'Local Superadmin',
    roles: ['superadmin'],
    note: 'superadmin',
  },
  {
    key: 'coordScience',
    local: 'coordinator',
    name: 'Ms Priya Kapoor',
    roles: ['academic_coordinator', 'teacher'],
    note: 'academic coordinator + Science subject head (also teaches; two roles)',
  },
  {
    key: 'coord',
    local: 'coordinator2',
    name: 'Mr Daniel Velasco',
    roles: ['academic_coordinator'],
    note: 'academic coordinator',
  },
  {
    key: 'oicPrimary',
    local: 'oic.primary',
    name: 'Ms Hazel Mendoza',
    roles: ['school_admin'],
    note: 'officer in charge, Primary',
  },
  {
    key: 'oicSecondary',
    local: 'oic.secondary',
    name: 'Ms Isla Ong',
    roles: ['school_admin'],
    note: 'officer in charge, Secondary',
  },
  {
    key: 'asstPrincipal',
    local: 'asst.principal',
    name: 'Mr Gabriel Santos',
    roles: ['school_admin'],
    note: 'assistant principal',
  },
  {
    key: 'aeb',
    local: 'aeb.member',
    name: 'Ms Eliana Chen',
    roles: ['school_admin'],
    note: 'AEB member',
  },
  {
    key: 'admissions',
    local: 'admissions',
    name: 'Ms Bianca Reyes',
    roles: ['admissions'],
    note: 'admissions',
  },
  {
    key: 'documents',
    local: 'documents',
    name: 'Ms Faith Quinto',
    roles: ['admissions'],
    note: 'documents officer (the retired p_file_officer job)',
  },
  // 26 teaching accounts: with the Science subject head that is production's
  // 27 distinct people holding an AY2026 class (prod-profile: 21 advisers, 26
  // subject teachers, 3 co-teachers). Who teaches what: teachers.ts ALLOCATION.
  ...(
    [
      ['Ms Aaliyah Bautista', 'English'],
      ['Mr Caleb Fernandes', 'Mathematics'],
      ['Ms Chloe Garcia', 'Science'],
      ['Mr Ethan Hernandez', 'Filipino'],
      ['Ms Diya Jimenez', 'Mandarin'],
      ['Mr Jacob Lim', 'Social Studies'],
      ['Ms Lila Navarro', 'MAPEH'],
      ['Mr Mateo Patel', 'Computer'],
      ['Ms Olivia Tan', 'English'],
      ['Mr Noah Uy', 'Mathematics'],
      ['Ms Rania Wong', 'Science'],
      ['Mr Theo Xu', 'Physical Education'],
      ['Ms Uma Yamada', 'Primary generalist'],
      ['Ms Bea Dizon', 'Filipino'],
      ['Mr Paolo Santiago', 'Filipino (Secondary)'],
      ['Ms Keira Morales', 'Primary English'],
      ['Mr Rafael Cruz', 'Primary Mathematics'],
      ['Ms Nadia Rahman', 'Primary Science'],
      ['Ms Celine Tolentino', 'STAR'],
      ['Mr Liam Ocampo', 'Literature'],
      ['Ms Mei Ling Goh', 'Music and Arts'],
      ['Mr Arjun Nair', 'Physical Education'],
      ['Ms Hannah Reyes', 'Humanities'],
      ['Mr Samuel Tan', 'Humanities'],
      ['Ms Grace Villanueva', 'Primary English'],
      ['Ms Joy Castillo', 'Form adviser'],
    ] as const
  ).map(([name, subject], i) => ({
    key: `teacher${i + 1}` as StaffKey,
    local: `teacher${String(i + 1).padStart(2, '0')}`,
    name,
    roles: ['teacher'] as Role[],
    note: `teacher (${subject})`,
  })),
  {
    key: 'relief',
    local: 'relief',
    name: 'Ms Sofia Anand',
    roles: ['teacher'],
    note: 'relief teacher',
  },
];

export type StaffAccount = {
  id: string;
  email: string;
  name: string;
  roles: Role[];
};

export const emailOf = (s: StaffSpec) => `${s.local}@${LOCAL_EMAIL_DOMAIN}`;

/** Stable id per account, so every rebuild gives the same uuids. */
export const staffId = (s: StaffSpec) => uuidFrom(`staff:${emailOf(s)}`);

export async function runStaff(): Promise<Record<string, StaffAccount>> {
  const sb = service();
  const out: Record<string, StaffAccount> = {};

  for (const s of STAFF) {
    const email = emailOf(s);
    const { data, error } = await sb.auth.admin.createUser({
      id: staffId(s),
      email,
      password: LOCAL_PASSWORD,
      email_confirm: true,
      app_metadata: { role: s.roles, active_role: s.roles[0] },
      user_metadata: { display_name: s.name },
    });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    out[s.key] = { id: data.user.id, email, name: s.name, roles: s.roles };
  }

  const admin = out.superadmin;
  const actor = {
    id: admin.id,
    email: admin.email,
    role: 'superadmin' as const,
  };

  // The route's audit row for each account (app/api/sis/admin/users/route.ts).
  for (const s of STAFF) {
    const a = out[s.key];
    await logAction({
      service: sb,
      actor,
      action: 'user.create',
      entityType: 'user_account',
      entityId: a.id,
      context: {
        email: a.email,
        role: a.roles.join(', '),
        active_role: a.roles[0],
        display_name: a.name,
      },
    });
  }

  await wireStageApprovers(out, actor);
  await wirePooledApprovers(out, actor);

  console.log(
    `  ${STAFF.length} staff accounts (password "${LOCAL_PASSWORD}")`
  );
  return out;
}

// ── Named approval steps (approval_stage_approvers) ──────────────────────
//
// Production has 10 rows: 8 untagged + 1 Primary + 1 Secondary. The tagged
// pair is the officer in charge on the declaration flow (migration 128: one
// officer per half of the school, chosen by the child). The 8 untagged are
// the three grade-change approvers and the five AEB steps, one person each.
type StageAssignment = {
  flow: string;
  order: number;
  who: StaffKey;
  scope: 'primary' | 'secondary' | null;
};

const STAGE_APPROVERS: StageAssignment[] = [
  {
    flow: 'attendance.student_declaration',
    order: 3,
    who: 'oicPrimary',
    scope: 'primary',
  },
  {
    flow: 'attendance.student_declaration',
    order: 3,
    who: 'oicSecondary',
    scope: 'secondary',
  },
  {
    flow: 'markbook.grade_change',
    order: 1,
    who: 'asstPrincipal',
    scope: null,
  },
  { flow: 'markbook.grade_change', order: 1, who: 'oicPrimary', scope: null },
  { flow: 'markbook.grade_change', order: 1, who: 'oicSecondary', scope: null },
  { flow: 'markbook.grade_change_aeb', order: 1, who: 'aeb', scope: null },
  {
    flow: 'markbook.grade_change_aeb',
    order: 2,
    who: 'asstPrincipal',
    scope: null,
  },
  {
    flow: 'markbook.grade_change_aeb',
    order: 3,
    who: 'coordScience',
    scope: null,
  },
  {
    flow: 'markbook.grade_change_aeb',
    order: 4,
    who: 'oicSecondary',
    scope: null,
  },
  {
    flow: 'markbook.grade_change_aeb',
    order: 5,
    who: 'oicPrimary',
    scope: null,
  },
];

async function wireStageApprovers(
  staff: Record<string, StaffAccount>,
  actor: { id: string; email: string; role: 'superadmin' }
): Promise<void> {
  const sb = service();
  const stages = await must(
    'approval_stages',
    sb
      .from('approval_stages')
      .select('id, flow, stage_order, label, resolver')
      .eq('is_active', true)
  );
  for (const a of STAGE_APPROVERS) {
    const stage = (stages ?? []).find(
      (s) => s.flow === a.flow && s.stage_order === a.order
    );
    if (!stage) throw new Error(`No active stage ${a.flow} #${a.order}`);
    if (stage.resolver !== 'named') {
      throw new Error(`${a.flow} #${a.order} is not a named step`);
    }
    const person = staff[a.who];
    const result = await assignStageApprover(sb, {
      stageId: stage.id,
      userId: person.id,
      appliesToLevelType: a.scope,
      createdBy: actor.id,
      actor,
    });
    if (result.alreadyAssigned) {
      throw new Error(
        `${a.who} already on ${a.flow} #${a.order} — wipe did not run?`
      );
    }
    // The route's audit row (app/api/sis/admin/approval-stage-approvers).
    await logAction({
      service: sb,
      actor,
      action: 'approval_stage.approver.assign',
      entityType: 'approval_stage_approver',
      entityId: result.id,
      context: {
        stage_id: stage.id,
        stage_label: stage.label,
        stage_order: stage.stage_order,
        flow: stage.flow,
        flow_label:
          STAGED_FLOW_LABELS[stage.flow as keyof typeof STAGED_FLOW_LABELS] ??
          stage.flow,
        user_id: person.id,
        email: person.email,
        display_name: person.name,
        applies_to_level_type: a.scope,
        repointed_waiting: result.repointed,
      },
    });
  }
  console.log(`  ${STAGE_APPROVERS.length} named-step approvers`);
}

// ── Pooled change-request approvers (approver_assignments) ───────────────
//
// Production: 2 rows on `markbook.change_request`. Eligible = a role holding
// `grade_changes.approve`, which is school_admin only.
const POOLED: Array<{ flow: 'markbook.change_request'; who: StaffKey }> = [
  { flow: 'markbook.change_request', who: 'asstPrincipal' },
  { flow: 'markbook.change_request', who: 'oicSecondary' },
];

async function wirePooledApprovers(
  staff: Record<string, StaffAccount>,
  actor: { id: string; email: string; role: 'superadmin' }
): Promise<void> {
  const sb = service();
  for (const p of POOLED) {
    const person = staff[p.who];
    const row = await must(
      `approver_assignments ${p.who}`,
      sb
        .from('approver_assignments')
        .insert({ user_id: person.id, flow: p.flow, created_by: actor.id })
        .select('id')
        .single()
    );
    await logAction({
      service: sb,
      actor,
      action: 'approver.assign',
      entityType: 'approver_assignment',
      entityId: row.id,
      context: { user_id: person.id, flow: p.flow, email: person.email },
    });
  }
  console.log(`  ${POOLED.length} change-request approvers`);
}
