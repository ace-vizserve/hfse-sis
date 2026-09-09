// scripts/import-teacher-assignments.ts
//
// Writes the subject-teacher assignments the school's deployment workbook
// describes into `teacher_assignments`. Form advisers are NOT touched — those
// were resolved separately and are already stored.
//
// The parsing lives in lib/sis/deployment-workbook.ts, shared with
// scripts/probe-teacher-deployment.ts, so the thing that reports and the thing
// that writes cannot disagree about what the workbook says.
//
// ⚠ WHAT THIS REFUSES TO DO, AND WHY IT MATTERS MORE THAN WHAT IT DOES.
//
//   1. A class+subject claimed by TWO teachers is SKIPPED, never picked. The
//      school splits some classes by day ("Sec 3 Humanities Tue" for one
//      teacher, other days for another) and `teacher_assignments` has no day
//      dimension, so only one of them can be recorded. That is a school
//      decision. Choosing for them would look identical to a correct row.
//
//   2. Anyone without the `teacher` role is SKIPPED. This mirrors the gate in
//      POST /api/teacher-assignments — "a teaching assignment requires the
//      teacher role" — so this script cannot write a row the app would refuse.
//
//   3. Rows already stored are SKIPPED rather than duplicated, which makes a
//      re-run safe.
//
// ⚠ CACHE. The API route busts markbook / evaluation / attendance drill tags
// after a write. `revalidateTag` needs the Next runtime and cannot be called
// from a script, so those pages fall back to their 60s TTL.
//
// Run (preview — writes nothing):
//   npx tsx --env-file=.env.local scripts/import-teacher-assignments.ts --actor=<superadmin-email> --ay=AY2026
// Run (apply):
//   ... --actor=<superadmin-email> --ay=AY2026 --apply
import { logActions } from '../lib/audit/log-action';
import { getUserRoleSet } from '../lib/auth/roles';
import {
  ALIASES,
  buildResolvers,
  levelCodeOf,
  readWorkbookCells,
  type SectionLite,
  type SubjectLite,
} from '../lib/sis/deployment-workbook';
import { createServiceClient } from '../lib/supabase/service';
import { listAllAuthUsers } from '../lib/supabase/paginate';

type Row = {
  teacherId: string;
  email: string;
  sectionId: string;
  sectionLabel: string;
  subjectId: string;
  subjectName: string;
};

async function main() {
  const apply = process.argv.includes('--apply');
  const arg = (k: string) =>
    process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const actorEmail = arg('actor');
  const ayCode = (arg('ay') ?? '').toUpperCase();

  if (!actorEmail) {
    console.error(
      'Missing --actor=<superadmin-email>. Every assignment writes an audit row,\nand that row records a real person.'
    );
    process.exit(1);
  }
  if (!/^AY\d{4}$/.test(ayCode)) {
    console.error('Missing or malformed --ay=AY2026.');
    process.exit(1);
  }

  console.log(
    apply
      ? '=== APPLY ==='
      : '=== PREVIEW: nothing will be written (add --apply to run for real) ==='
  );

  const service = createServiceClient();
  const users = await listAllAuthUsers(service);
  const byEmail = new Map(
    users.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u])
  );

  const actor = byEmail.get(actorEmail.toLowerCase());
  if (!actor) {
    console.error(`Actor "${actorEmail}" is not an account in this project.`);
    process.exit(1);
  }
  const actorRoles = getUserRoleSet(actor);
  if (!actorRoles.includes('superadmin')) {
    console.error(`Actor "${actorEmail}" is not a superadmin.`);
    process.exit(1);
  }
  console.log(`Actor: ${actor.email} (${actorRoles.join(' + ')})`);

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id, ay_code')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ayRow) throw new Error(`No ${ayCode}`);

  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name, levels(code)')
    .eq('academic_year_id', (ayRow as { id: string }).id);
  const sections = (sectionRows ?? []) as unknown as SectionLite[];

  const { data: subjectRows } = await service
    .from('subjects')
    .select('id, name');
  const subjects = (subjectRows ?? []) as SubjectLite[];

  const { pairsIn } = buildResolvers(sections, subjects);
  const { subjectCells } = readWorkbookCells();

  console.log(
    `${ayCode}: ${sections.length} sections, ${subjects.length} subjects\n`
  );

  // ── Extract, dedupe, and note who claims what ────────────────────────────
  const wanted = new Map<string, Row>();
  const claims = new Map<string, Set<string>>();
  const skippedNoAccount = new Set<string>();
  const skippedNotTeacher = new Set<string>();

  for (const { teacher, text } of subjectCells) {
    const email = ALIASES[teacher];
    if (!email) {
      skippedNoAccount.add(teacher);
      continue;
    }
    const u = byEmail.get(email.toLowerCase());
    if (!u) {
      skippedNoAccount.add(`${teacher} (${email})`);
      continue;
    }
    if (!getUserRoleSet(u).includes('teacher')) {
      skippedNotTeacher.add(`${teacher} (${email})`);
      continue;
    }
    for (const p of pairsIn(text)) {
      const slot = `${p.section.id}|${p.subjectId}`;
      if (!claims.has(slot)) claims.set(slot, new Set());
      claims.get(slot)!.add(email);
      wanted.set(`${u.id}|${slot}`, {
        teacherId: u.id,
        email,
        sectionId: p.section.id,
        sectionLabel: p.label,
        subjectId: p.subjectId,
        subjectName: p.subject,
      });
    }
  }

  // ── What is already stored ───────────────────────────────────────────────
  const { data: existingRows } = await service
    .from('teacher_assignments')
    .select('teacher_user_id, section_id, subject_id, role')
    .eq('role', 'subject_teacher')
    .in(
      'section_id',
      sections.map((s) => s.id)
    );
  const existing = (existingRows ?? []) as {
    teacher_user_id: string;
    section_id: string;
    subject_id: string;
    role: string;
  }[];
  // ⚠ WHO holds the slot, not just whether it is held. Asking only "is this
  // class+subject taken?" would report a slot held by the WRONG teacher as
  // "already stored" and leave it there — which is precisely how Sharon Anne
  // Menezes sat on Discipline 1 for months while Discipline 2 had nobody.
  const holderOfSlot = new Map(
    existing.map((e) => [`${e.section_id}|${e.subject_id}`, e.teacher_user_id])
  );

  const contested: Row[] = [];
  const already: Row[] = [];
  const disagrees: { row: Row; storedTeacherId: string }[] = [];
  const toWrite: Row[] = [];

  for (const row of wanted.values()) {
    const slot = `${row.sectionId}|${row.subjectId}`;
    const holder = holderOfSlot.get(slot);
    if ((claims.get(slot)?.size ?? 0) > 1) contested.push(row);
    else if (holder === undefined) toWrite.push(row);
    else if (holder === row.teacherId) already.push(row);
    else disagrees.push({ row, storedTeacherId: holder });
  }

  toWrite.sort((a, b) =>
    `${a.sectionLabel}${a.subjectName}`.localeCompare(
      `${b.sectionLabel}${b.subjectName}`
    )
  );

  console.log(`TO WRITE (${toWrite.length}):`);
  for (const r of toWrite)
    console.log(
      `  ${r.sectionLabel.padEnd(18)} ${r.subjectName.padEnd(34)} ${r.email}`
    );

  if (already.length)
    console.log(
      `\nALREADY STORED and agreeing with the workbook (${already.length}) — left alone.`
    );

  if (disagrees.length) {
    const emailById = new Map(
      users.map((u) => [u.id, u.email ?? '(no email)'])
    );
    console.log(
      `\n⚠ STORED, BUT A DIFFERENT TEACHER THAN THE WORKBOOK SAYS (${disagrees.length}). NOT changed by this script — an import that silently re-seats teachers is how you lose a correction somebody made by hand:`
    );
    for (const { row, storedTeacherId } of disagrees)
      console.log(
        `  ${row.sectionLabel.padEnd(18)} ${row.subjectName.padEnd(34)} stored: ${emailById.get(storedTeacherId)}  workbook: ${row.email}`
      );
  }

  if (contested.length) {
    console.log(
      `\n⚠ SKIPPED — claimed by more than one teacher (${contested.length} rows). One subject teacher per class is a unique index, so the school has to choose:`
    );
    const bySlot = new Map<string, Row[]>();
    for (const r of contested) {
      const k = `${r.sectionLabel}|${r.subjectName}`;
      if (!bySlot.has(k)) bySlot.set(k, []);
      bySlot.get(k)!.push(r);
    }
    for (const [k, rows] of bySlot) {
      const [sec, subj] = k.split('|');
      console.log(
        `  ${sec.padEnd(18)} ${subj.padEnd(34)} ${rows.map((r) => r.email).join(' vs ')}`
      );
    }
  }

  if (skippedNotTeacher.size)
    console.log(
      `\nSKIPPED — no teacher role: ${[...skippedNotTeacher].join(', ')}`
    );
  if (skippedNoAccount.size)
    console.log(`SKIPPED — no account: ${[...skippedNoAccount].join(', ')}`);

  const covered = new Set(
    toWrite
      .concat(already)
      .concat(disagrees.map((d) => d.row))
      .map((r) => r.sectionId)
  );
  const bare = sections
    .filter((s) => !covered.has(s.id))
    .map((s) => `${levelCodeOf(s)} ${s.name}`);
  if (bare.length)
    console.log(`\nClasses with no subject teacher at all: ${bare.join(', ')}`);

  if (!apply) {
    console.log('\nPreview only. Nothing was written.');
    return;
  }
  if (toWrite.length === 0) {
    console.log('\nNothing to write.');
    return;
  }

  // One insert, so it is all-or-nothing — the same reasoning as the API route.
  // Every column is spelled out on every row: PostgREST takes the union of keys
  // across a multi-row insert and fills a missing one with NULL rather than the
  // column default.
  const { data: created, error } = await service
    .from('teacher_assignments')
    .insert(
      toWrite.map((r) => ({
        teacher_user_id: r.teacherId,
        section_id: r.sectionId,
        subject_id: r.subjectId,
        role: 'subject_teacher' as const,
      }))
    )
    .select('id, teacher_user_id, section_id, subject_id');
  if (error) throw new Error(`Insert failed: ${error.message}`);

  const rows = (created ?? []) as {
    id: string;
    teacher_user_id: string;
    section_id: string;
    subject_id: string;
  }[];

  // One audit row per assignment, not one per batch — each is removed and
  // changed on its own afterwards, so its creation belongs on its own timeline.
  const byKey = new Map(
    toWrite.map((r) => [`${r.teacherId}|${r.sectionId}|${r.subjectId}`, r])
  );
  await logActions(
    service,
    {
      id: actor.id,
      email: actor.email ?? actorEmail,
      role: actorRoles.join(' + '),
    },
    rows.map((a) => {
      const r = byKey.get(
        `${a.teacher_user_id}|${a.section_id}|${a.subject_id}`
      );
      return {
        action: 'assignment.create' as const,
        entityType: 'teacher_assignment' as const,
        entityId: a.id,
        context: {
          teacher_user_id: a.teacher_user_id,
          section_id: a.section_id,
          subject_id: a.subject_id,
          role: 'subject_teacher',
          ...(r
            ? { section_name: r.sectionLabel, subject_name: r.subjectName }
            : {}),
          source: 'Teachers Deployment_Updated 29 Jun 26 workbook',
        },
      };
    })
  );

  console.log(`\nWrote ${rows.length} assignments.`);
  console.log(
    'Drill caches were NOT busted (revalidateTag needs the Next runtime); the affected pages refresh on their 60s TTL.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
