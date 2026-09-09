// scripts/fix-secondary-form-advisers.ts
//
// Three corrections to AY2026 secondary form advisers, from the school's
// deployment workbook (Teachers Deployment_Updated 29 Jun 26).
//
// WHAT WAS WRONG. Sharon Anne Menezes was stored as the adviser of
// Discipline 1. The workbook puts her on Discipline 2 and gives Discipline 1 to
// Jocelyn Saguid. One misplacement produced three symptoms: Sharon on the wrong
// class, Discipline 2 with no adviser, and Jocelyn with no class. Excellence
// separately had no adviser at all — the workbook says Medelyn Ruth Azucena.
//
// ⚠ A MOVE IS A DELETE PLUS A CREATE, NOT AN UPDATE. The audit vocabulary has
// `assignment.create` and `assignment.delete` and deliberately no update
// (lib/audit/log-action.ts), and `teacher_assignments_form_adviser_unique`
// allows one adviser per section — so Sharon's old row must be gone before
// Jocelyn's new one can land. Writing this as an in-place section_id change
// would save a round trip and leave a history that skips the fact that
// Discipline 1 changed hands.
//
// ⚠ CACHE. The API route busts markbook / evaluation / attendance drill tags
// after a write. `revalidateTag` needs the Next runtime and cannot be called
// from a script, so the affected pages fall back to their 60s TTL instead.
// Nothing to do — just do not expect the change to appear instantly.
//
// Run (preview — changes nothing):
//   npx tsx --env-file=.env.local scripts/fix-secondary-form-advisers.ts --actor=<superadmin-email>
// Run (apply):
//   ... --actor=<superadmin-email> --apply
import { logAction } from '../lib/audit/log-action';
import { getUserRoleSet } from '../lib/auth/roles';
import { createServiceClient } from '../lib/supabase/service';
import { listAllAuthUsers } from '../lib/supabase/paginate';

const AY = 'AY2026';

/** level code + section name, exactly as `sections` stores them. */
type Target = {
  level: string;
  section: string;
  email: string;
  who: string;
};

const TARGETS: Target[] = [
  {
    level: 'S1',
    section: 'Discipline 2',
    email: 'sharonanne.menezes@hfse.edu.sg',
    who: 'Sharon Anne Menezes',
  },
  {
    level: 'S1',
    section: 'Discipline 1',
    email: 'jocelyn.saguid@hfse.edu.sg',
    who: 'Jocelyn Saguid',
  },
  {
    level: 'S4',
    section: 'Excellence',
    email: 'medelyn.azucena@hfse.edu.sg',
    who: 'Medelyn Ruth Azucena',
  },
];

const CHANGE_REASON =
  'Corrected against the school deployment workbook (Teachers Deployment_Updated 29 Jun 26): Sharon Anne Menezes advises Discipline 2, not Discipline 1.';

type Sec = {
  id: string;
  name: string;
  levels: { code: string } | { code: string }[] | null;
};
const levelCodeOf = (s: Sec) =>
  (Array.isArray(s.levels) ? s.levels[0] : s.levels)?.code ?? '??';

async function main() {
  const apply = process.argv.includes('--apply');
  const actorEmail = process.argv
    .find((a) => a.startsWith('--actor='))
    ?.slice('--actor='.length);

  if (!actorEmail) {
    console.error(
      'Missing --actor=<superadmin-email>. Every change writes an audit row, and\nthat row records a real person.'
    );
    process.exit(1);
  }

  console.log(
    apply
      ? '=== APPLY ==='
      : '=== PREVIEW: nothing will be changed (add --apply to run for real) ===\n'
  );

  const service = createServiceClient();
  const users = await listAllAuthUsers(service);
  const byEmail = new Map(
    users.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u])
  );
  const emailById = new Map(users.map((u) => [u.id, u.email ?? '(no email)']));

  const actor = byEmail.get(actorEmail.toLowerCase());
  if (!actor) {
    console.error(`Actor "${actorEmail}" is not an account in this project.`);
    process.exit(1);
  }
  const actorRoles = getUserRoleSet(actor);
  if (!actorRoles.includes('superadmin')) {
    console.error(
      `Actor "${actorEmail}" holds "${actorRoles.join(' + ') || 'none'}" — this needs a superadmin.`
    );
    process.exit(1);
  }
  console.log(`Actor: ${actor.email} (${actorRoles.join(' + ')})\n`);

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id, ay_code')
    .eq('ay_code', AY)
    .maybeSingle();
  if (!ayRow) throw new Error(`No ${AY}`);

  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name, levels(code)')
    .eq('academic_year_id', (ayRow as { id: string }).id);
  const sections = (sectionRows ?? []) as unknown as Sec[];

  // Resolve everything BEFORE writing anything, so a typo fails on a read
  // rather than half way through a sequence of writes.
  const plan: { target: Target; sectionId: string; teacherId: string }[] = [];
  for (const t of TARGETS) {
    const sec = sections.find(
      (s) => levelCodeOf(s) === t.level && s.name === t.section
    );
    if (!sec) throw new Error(`No section ${t.level} ${t.section} in ${AY}`);
    const u = byEmail.get(t.email.toLowerCase());
    if (!u) throw new Error(`No account ${t.email}`);
    // The API route refuses an assignment to anyone without the teacher role
    // ("a teaching assignment requires the teacher role"). Same gate here, so
    // the script cannot write a row the app would have rejected.
    if (!getUserRoleSet(u).includes('teacher')) {
      throw new Error(
        `${t.email} holds "${getUserRoleSet(u).join(' + ') || 'none'}" — needs the teacher role first.`
      );
    }
    plan.push({ target: t, sectionId: sec.id, teacherId: u.id });
  }

  // What is stored right now for the three classes we are about to touch.
  const { data: existing } = await service
    .from('teacher_assignments')
    .select('id, section_id, teacher_user_id')
    .eq('role', 'form_adviser')
    .in(
      'section_id',
      plan.map((p) => p.sectionId)
    );
  const current = (existing ?? []) as {
    id: string;
    section_id: string;
    teacher_user_id: string;
  }[];

  // Sharon's stale row is on a class NOT in the plan (Discipline 1 is in the
  // plan, but as Jocelyn's). Find every adviser row held by a teacher we are
  // about to place elsewhere, anywhere in this AY.
  const { data: allAdvisers } = await service
    .from('teacher_assignments')
    .select('id, section_id, teacher_user_id')
    .eq('role', 'form_adviser')
    .in(
      'section_id',
      sections.map((s) => s.id)
    );
  const advisers = (allAdvisers ?? []) as {
    id: string;
    section_id: string;
    teacher_user_id: string;
  }[];

  const toDelete = advisers.filter((a) =>
    plan.some(
      (p) => p.teacherId === a.teacher_user_id && p.sectionId !== a.section_id
    )
  );
  // ⚠ EVERYTHING BELOW MUST REASON ABOUT THE STATE *AFTER* THE DELETES, not
  // the state on disk right now. Discipline 1 is occupied at this instant — by
  // Sharon, who is the very row being removed — so checking `current` directly
  // concludes the class is taken, silently drops Jocelyn from the plan, and
  // leaves the class empty. The preview is what caught it.
  const deletedIds = new Set(toDelete.map((d) => d.id));
  const afterDeletes = current.filter((c) => !deletedIds.has(c.id));

  const toCreate = plan.filter(
    (p) => !afterDeletes.some((c) => c.section_id === p.sectionId)
  );
  const alreadyRight = plan.filter((p) =>
    afterDeletes.some(
      (c) => c.section_id === p.sectionId && c.teacher_user_id === p.teacherId
    )
  );
  const occupied = afterDeletes.filter((c) =>
    plan.some(
      (p) => p.sectionId === c.section_id && p.teacherId !== c.teacher_user_id
    )
  );

  const nameOfSection = (id: string) => {
    const s = sections.find((x) => x.id === id);
    return s ? `${levelCodeOf(s)} ${s.name}` : id;
  };

  console.log('REMOVE:');
  toDelete.forEach((d) =>
    console.log(
      `  ${nameOfSection(d.section_id).padEnd(18)} ${emailById.get(d.teacher_user_id)}`
    )
  );
  if (toDelete.length === 0) console.log('  (none)');

  console.log('\nADD:');
  toCreate.forEach((p) =>
    console.log(
      `  ${`${p.target.level} ${p.target.section}`.padEnd(18)} ${p.target.email}`
    )
  );
  if (toCreate.length === 0) console.log('  (none)');

  if (alreadyRight.length) {
    console.log('\nALREADY CORRECT:');
    alreadyRight.forEach((p) =>
      console.log(
        `  ${`${p.target.level} ${p.target.section}`.padEnd(18)} ${p.target.email}`
      )
    );
  }
  if (occupied.length) {
    console.log(
      '\n⚠ HELD BY SOMEBODY ELSE — resolve by hand, this script will not evict them:'
    );
    occupied.forEach((c) =>
      console.log(
        `  ${nameOfSection(c.section_id).padEnd(18)} ${emailById.get(c.teacher_user_id)}`
      )
    );
  }

  if (!apply) {
    console.log('\nPreview only. Nothing was changed.');
    return;
  }

  // ── Writes. Deletes first: the unique index means Discipline 1 must be
  // vacant before Jocelyn can take it. ────────────────────────────────────
  const actorRef = {
    id: actor.id,
    email: actor.email ?? actorEmail,
    role: actorRoles.join(' + '),
  };

  for (const d of toDelete) {
    const { error } = await service
      .from('teacher_assignments')
      .delete()
      .eq('id', d.id);
    if (error) throw new Error(`Delete failed: ${error.message}`);
    await logAction({
      service,
      actor: actorRef,
      action: 'assignment.delete',
      entityType: 'teacher_assignment',
      entityId: d.id,
      context: {
        section_id: d.section_id,
        section_name: nameOfSection(d.section_id),
        teacher_user_id: d.teacher_user_id,
        role: 'form_adviser',
        change_reason: CHANGE_REASON,
      },
    });
    console.log(`  removed ${nameOfSection(d.section_id)}`);
  }

  for (const p of toCreate) {
    const { data, error } = await service
      .from('teacher_assignments')
      .insert({
        teacher_user_id: p.teacherId,
        section_id: p.sectionId,
        subject_id: null,
        role: 'form_adviser',
      })
      .select('id')
      .single();
    if (error) throw new Error(`Insert failed: ${error.message}`);
    await logAction({
      service,
      actor: actorRef,
      action: 'assignment.create',
      entityType: 'teacher_assignment',
      entityId: (data as { id: string }).id,
      context: {
        section_id: p.sectionId,
        section_name: `${p.target.level} ${p.target.section}`,
        teacher_user_id: p.teacherId,
        teacher_name: p.target.who,
        role: 'form_adviser',
        change_reason: CHANGE_REASON,
      },
    });
    console.log(
      `  added ${p.target.level} ${p.target.section} → ${p.target.who}`
    );
  }

  console.log(
    '\nDone. Drill caches were NOT busted (revalidateTag needs the Next runtime); the affected pages refresh on their 60s TTL.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
