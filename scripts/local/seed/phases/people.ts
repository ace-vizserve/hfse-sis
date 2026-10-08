// Phase "people": admissions rows for AY2025–AY2027, the children who joined a
// class, their class lists, houses and school numbers.
//
// Write paths, in order of preference (plan ground rule 2):
//   * Admissions tables — the parent portal owns them, so rows go in directly,
//     shaped like production (./people/rows.ts), mess included.
//   * students + section_students — ONLY through the app's own
//     `syncOneStudent` (lib/sync/students.ts), one call per enrolled child, so
//     the student row, the class row and its first index number come from the
//     same code production runs. A returning child is the same studentNumber
//     on next year's application, and the sync finds the existing student.
//   * Index numbers — the `generate_section_index_numbers` RPC (what the
//     "Generate" button calls), run once per class after the on-time intake.
//   * The one transfer — the `transfer_student_section` RPC, plus the
//     transfer route's admissions mirror and its `student.section.transfer`
//     audit row.
//   * Late-enrollee tags and withdrawals — no lib writer exists (the PATCH
//     route at app/api/sections/[id]/students/[enrolmentId] writes them
//     inline), so the route's writes are mirrored: the class-list row; for a
//     withdrawal the admissions patch from the route's own exported
//     `buildWithdrawalAdmissionsPatch` (KD #220); and, for AY2026 (the SIS
//     era), the route's two audit rows.
//   * Houses and school numbers — the routes write `students` directly; so
//     does this, with the house route's `sis.house.update` audit row each.
//   * Index holes — production's AY2026 has numbers missing outright: a few
//     children placed and then taken off the list (admissions put back to
//     not Enrolled). No app path deletes a class row; this deletes directly.
//
// Fixed dates throughout. Where the app stamps "today" (the sync's
// enrollment_date, the admissions touch trigger), the value is overwritten
// with the date production's shape calls for, so two rebuilds match.

import { buildWithdrawalAdmissionsPatch } from '@/app/api/sections/[id]/students/[enrolmentId]/route';
import { logAction, logActions } from '@/lib/audit/log-action';
import { houseAuditContext } from '@/lib/sis/house-audit';
import { getTermForDate } from '@/lib/sis/terms';
import { syncOneStudent, NOT_ENROLLED_REASON } from '@/lib/sync/students';
import type { PreloadedSyncSnapshot } from '@/lib/sync/students';

import { allocate } from '../lib/distribution';
import { must, service, sql, sqlRows } from '../lib/local';
import { STAFF, emailOf, staffId, type StaffKey } from './staff';
import { rng } from '../lib/random';
import {
  addDays,
  buildPlan,
  dateBetween,
  type AppSpec,
  type Plan,
  type SectionInfo,
  type TermInfo,
} from '../people/plan';
import {
  applicationRow,
  discountCodeRows,
  documentsRow,
  statusRow,
} from '../people/rows';
import { AYS, type Ay, type LevelCode } from '../people/vocab';

type Actor = { id: string; email: string; role: string };
const actorOf = (key: StaffKey): Actor => {
  const s = STAFF.find((x) => x.key === key);
  if (!s) throw new Error(`no staff ${key}`);
  return { id: staffId(s), email: emailOf(s), role: s.roles[0] };
};
/** Who withdraws, moves and un-places children (the registrar's role). */
const REGISTRAR = actorOf('coord');
/** Who sets houses (a school_admin, as in production). */
const HOUSE_ADMIN = actorOf('asstPrincipal');
/** Who edits admissions rows in Directus. */
const ADMISSIONS = actorOf('admissions');

const tbl = (ay: Ay, kind: 'applications' | 'status' | 'documents') =>
  `ay${ay.slice(2)}_enrolment_${kind}`;

/** Status rows an edit after insert touched (kept first when stamps are thinned). */
const touched: Record<Ay, Set<string>> = {
  AY2025: new Set(),
  AY2026: new Set(),
  AY2027: new Set(),
};

async function insertAll(table: string, rows: Record<string, unknown>[]) {
  const sb = service();
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from(table).insert(rows.slice(i, i + 200));
    if (error) throw new Error(`insert ${table}: ${error.message}`);
  }
}

/**
 * An edit to an admissions status row, the way Directus / the SIS stage
 * routes make one — then the touch trigger's "today" stamps replaced with the
 * edit's own (fixed) date.
 */
async function editStatus(
  ay: Ay,
  enrolee: string,
  patch: Record<string, unknown>,
  day: string
): Promise<void> {
  const sb = service();
  const t = tbl(ay, 'status');
  touched[ay].add(enrolee);
  const { error } = await sb.from(t).update(patch).eq('enroleeNumber', enrolee);
  if (error) throw new Error(`${t} ${enrolee}: ${error.message}`);
  const stamps: Record<string, unknown> = { applicationUpdatedDate: day };
  if (Object.keys(patch).some((k) => k.startsWith('class'))) {
    stamps.classUpdatedDate = day;
  }
  const { error: e2 } = await sb
    .from(t)
    .update(stamps)
    .eq('enroleeNumber', enrolee);
  if (e2) throw new Error(`${t} ${enrolee} stamps: ${e2.message}`);
}

type Setup = {
  sections: SectionInfo[];
  terms: TermInfo[];
  teachingDays: Record<Ay, string[]>;
};

function loadSetup(): Setup {
  const sections = sqlRows(
    `select s.id, ay.ay_code, l.code, s.name from sections s
       join academic_years ay on ay.id = s.academic_year_id
       join levels l on l.id = s.level_id
      where ay.ay_code in ('AY2025','AY2026','AY2027')
      order by ay.ay_code, l.code, s.name`
  ).map(([id, ay, level, name]) => ({
    id,
    ay: ay as Ay,
    level: level as LevelCode,
    name,
  }));
  const terms = sqlRows(
    `select ay.ay_code, t.term_number, t.start_date, t.end_date from terms t
       join academic_years ay on ay.id = t.academic_year_id
      where t.start_date is not null order by 1, 2`
  ).map(([ay, term, start, end]) => ({
    ay: ay as Ay,
    term: Number(term),
    start,
    end,
  }));
  const teachingDays: Record<Ay, string[]> = {
    AY2025: [],
    AY2026: [],
    AY2027: [],
  };
  for (const [ay, day] of sqlRows(
    `select a.ay_code, c.date from school_calendar c
       join terms t on t.id = c.term_id
       join academic_years a on a.id = t.academic_year_id
      where c.day_type = 'school_day' and a.ay_code in ('AY2025','AY2026','AY2027')
      order by 1, 2`
  ))
    teachingDays[ay as Ay].push(day);
  return { sections, terms, teachingDays };
}

/** The first school day on or after `day`. */
function schoolDayFrom(setup: Setup, ay: Ay, day: string): string {
  const d = setup.teachingDays[ay].find((x) => x >= day);
  if (!d) throw new Error(`No ${ay} school day on or after ${day}`);
  return d;
}

async function preload(ay: Ay): Promise<PreloadedSyncSnapshot> {
  const sb = service();
  const [levels, secs, aliases] = await Promise.all([
    must('levels', sb.from('levels').select('id, label')),
    must(
      'sections',
      sb
        .from('sections')
        .select(
          'id, level_id, name, academic_year:academic_years!inner(ay_code)'
        )
        .eq('academic_year.ay_code', ay)
    ),
    must(
      'level_aliases',
      sb.from('level_aliases').select('raw_label, level_id')
    ),
  ]);
  return {
    levels,
    sections: secs.map((s) => ({
      id: s.id,
      level_id: s.level_id,
      name: s.name,
    })),
    levelAliases: aliases,
  };
}

/** The app's own single-student sync; anything but the expected result stops the run. */
async function sync(
  a: AppSpec,
  pre: PreloadedSyncSnapshot,
  expect: 'enrolled' | { heldBecause: string }
): Promise<void> {
  const sb = service();
  const res = await syncOneStudent(sb, sb, a.enroleeNumber, a.ay, pre);
  const ok =
    expect === 'enrolled'
      ? res.ok && res.change === 'enrolled'
      : !res.ok && res.reason === expect.heldBecause;
  if (!ok) {
    throw new Error(
      `syncOneStudent ${a.ay} ${a.enroleeNumber}: expected ${JSON.stringify(expect)}, got ${JSON.stringify(res)}`
    );
  }
}

type SsRow = {
  id: string;
  section_id: string;
  index_number: number;
  enrolee_number: string;
};

function classRows(ay: Ay): SsRow[] {
  return sqlRows(
    `select ss.id, ss.section_id, ss.index_number, coalesce(ss.enrolee_number,'')
       from section_students ss join sections s on s.id = ss.section_id
       join academic_years a on a.id = s.academic_year_id
      where a.ay_code = '${ay}' order by ss.section_id, ss.index_number`
  ).map(([id, section_id, idx, enrolee_number]) => ({
    id,
    section_id,
    index_number: Number(idx),
    enrolee_number,
  }));
}

async function updateEnrolment(id: string, patch: Record<string, unknown>) {
  const { error } = await service()
    .from('section_students')
    .update(patch)
    .eq('id', id);
  if (error) throw new Error(`section_students ${id}: ${error.message}`);
}

// ── One academic year ─────────────────────────────────────────────────────

async function runAy(ay: Ay, plan: Plan, setup: Setup) {
  const specs = plan.apps[ay];
  await insertAll(
    tbl(ay, 'applications'),
    specs.filter((a) => a.hasApp).map(applicationRow)
  );
  await insertAll(
    tbl(ay, 'status'),
    specs.filter((a) => a.hasStatus).map(statusRow)
  );
  await insertAll(
    tbl(ay, 'documents'),
    specs.filter((a) => a.hasDocs && a.hasApp).map(documentsRow)
  );

  const pre = await preload(ay);
  const enrolled = specs.filter((a) => a.outcome === 'enrolled');
  const onTime = enrolled.filter((a) => !a.late);
  const late = enrolled
    .filter((a) => a.late)
    .sort((x, y) => x.late!.date.localeCompare(y.late!.date));

  // 1. The on-time intake, through the app's sync.
  for (const a of onTime) await sync(a, pre, 'enrolled');

  // 2. The sync stamps today's date on every class row. Production's on-time
  //    rows carry none (only late enrollees and transfers have one) — and a
  //    date after T1 would make the index RPC treat everyone as mid-year.
  //    AY2027 (no term dates yet) keeps a date, as its 4 production rows do.
  const aySectionIds = setup.sections
    .filter((s) => s.ay === ay)
    .map((s) => `'${s.id}'`)
    .join(',');
  if (ay === 'AY2027') {
    const r = rng('people:ay2027:dates');
    for (const row of classRows(ay)) {
      await updateEnrolment(row.id, {
        enrollment_date: dateBetween(r, '2026-05-28', '2026-09-24'),
      });
    }
  } else {
    sql(
      `update section_students set enrollment_date = null where section_id in (${aySectionIds})`
    );
  }

  // 3. Index numbers: the Generate button's RPC, once per class.
  const sectionIds = [
    ...new Set(classRows(ay).map((r) => r.section_id)),
  ].sort();
  for (const id of sectionIds) {
    const { error } = await service().rpc('generate_section_index_numbers', {
      p_section_id: id,
      p_dry_run: false,
    });
    if (error)
      throw new Error(`generate_section_index_numbers ${id}: ${error.message}`);
  }

  // 4. Late enrollees: synced (appended at the bottom of the class), then
  //    tagged as the class-list PATCH route tags them.
  for (const a of late) {
    await sync(a, pre, 'enrolled');
    const row = classRows(ay).find((r) => r.enrolee_number === a.enroleeNumber);
    if (!row)
      throw new Error(`late enrollee ${a.enroleeNumber} has no class row`);
    await updateEnrolment(row.id, {
      enrollment_status: 'late_enrollee',
      enrollment_date: a.late!.date,
      late_enrollee_term_number: a.late!.term,
    });
  }

  // 5. Year-specific stories.
  if (ay === 'AY2025') await ay2025Story(plan, pre);
  if (ay === 'AY2026') await ay2026Story(plan, pre, setup);
  if (ay === 'AY2027') await ay2027Story(plan, pre);

  // 6. Production's AY2025/AY2026 stage stamps are mostly empty (Directus
  //    and the old import never wrote them); AY2027's are full and stay.
  if (ay !== 'AY2027') hollowStageStamps(ay);

  console.log(
    `  ${ay}: ${specs.filter((a) => a.hasApp && !a.dropAppAfterSync).length} applications, ${specs.filter((a) => a.hasStatus).length} status, ${specs.filter((a) => a.hasDocs && a.hasApp).length} documents; synced ${onTime.length} on-time + ${late.length} late through syncOneStudent`
  );
}

async function withdraw(
  ay: Ay,
  a: AppSpec,
  row: SsRow,
  opts: {
    date: string | null;
    approved?: string | null;
    reason?: string | null;
    notes?: string | null;
    /** Write the route's audit rows (the SIS era — AY2026). */
    audit: boolean;
  }
) {
  const sb = service();
  // The route's pre-image read (same select), for the audit row's `before`.
  const { data: beforeRow, error: bErr } = await sb
    .from('section_students')
    .select(
      'id, section_id, index_number, enrolee_number, bus_no, classroom_officer_role, academics_notes, admin_notes, enrollment_status, enrollment_date, withdrawal_date, withdrawal_approved_date, withdrawal_reason, withdrawal_notes, late_enrollee_term_number, student:students(student_number, first_name, middle_name, last_name), section:sections(name)'
    )
    .eq('id', row.id)
    .single();
  if (bErr) throw new Error(`section_students ${row.id}: ${bErr.message}`);
  const before = beforeRow as unknown as Record<string, unknown> & {
    student: {
      student_number: string;
      first_name: string | null;
      middle_name: string | null;
      last_name: string | null;
    };
    section: { name: string };
  };

  const patch = {
    enrollment_status: 'withdrawn',
    withdrawal_date: opts.date,
    withdrawal_approved_date: opts.approved ?? null,
    withdrawal_reason: opts.reason ?? null,
    withdrawal_notes: opts.notes ?? null,
  };
  await updateEnrolment(row.id, patch);

  // KD #220: a withdrawal in Records sets admissions to Withdrawn too — the
  // route's own patch builder, fed what the route reads first.
  const day = opts.date ?? addDays(a.createdAt.slice(0, 10), 120);
  const { data: adm, error: aErr } = await sb
    .from(tbl(ay, 'status'))
    .select('applicationTerminalReason, applicationStatus')
    .eq('enroleeNumber', a.enroleeNumber)
    .maybeSingle();
  if (aErr) throw new Error(`${tbl(ay, 'status')}: ${aErr.message}`);
  const cur = adm as {
    applicationTerminalReason: string | null;
    applicationStatus: string | null;
  } | null;
  const alreadyTerminal = cur?.applicationTerminalReason != null;
  const statusUpdate = buildWithdrawalAdmissionsPatch({
    actorEmail: REGISTRAR.email,
    todayIso: day,
    admissionsAlreadyTerminal: alreadyTerminal,
    admissionsStatus: cur?.applicationStatus ?? null,
    withdrawalReason: opts.reason ?? null,
    withdrawalNotes: opts.notes ?? null,
  });
  await editStatus(ay, a.enroleeNumber, statusUpdate, day);

  if (!opts.audit) return;
  const st = before.student;
  const studentName = [st.first_name, st.middle_name, st.last_name]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const common = {
    studentNumber: st.student_number,
    ...(studentName ? { studentName } : {}),
    enroleeNumber: a.enroleeNumber,
    section_name: before.section.name,
    index_number: before.index_number,
  };
  await logAction({
    service: sb,
    actor: REGISTRAR,
    action: 'student.withdrawal.cascade',
    entityType: 'enrolment_status',
    entityId: a.enroleeNumber,
    context: {
      ay_code: ay,
      trigger: 'section_student.withdrawn',
      ...common,
      section_student_id: row.id,
      section_id: row.section_id,
      withdrawal_date: patch.withdrawal_date,
      withdrawal_approved_date: patch.withdrawal_approved_date,
      withdrawal_reason: patch.withdrawal_reason,
      admissions_patch: statusUpdate,
      applicationStatus_before: cur?.applicationStatus ?? null,
      ...(alreadyTerminal
        ? { terminalCascadeSkipped: 'admissions-already-terminal' }
        : {}),
    },
  });
  const beforeCols = [
    'bus_no',
    'classroom_officer_role',
    'academics_notes',
    'admin_notes',
    'enrollment_status',
    'enrollment_date',
    'late_enrollee_term_number',
    'withdrawal_date',
    'withdrawal_approved_date',
    'withdrawal_reason',
    'withdrawal_notes',
  ];
  await logAction({
    service: sb,
    actor: REGISTRAR,
    action: 'enrolment.metadata.update',
    entityType: 'section_student',
    entityId: row.id,
    context: {
      section_id: row.section_id,
      ay_code: ay,
      ...common,
      before: Object.fromEntries(beforeCols.map((k) => [k, before[k] ?? null])),
      after: patch,
      ...(opts.reason || opts.notes
        ? {
            withdrawal_reason: opts.reason ?? null,
            withdrawal_notes: opts.notes ?? null,
            withdrawalReason: opts.reason ?? null,
            withdrawalNotes: opts.notes ?? null,
          }
        : {}),
      ...(alreadyTerminal
        ? { terminalCascadeSkipped: 'admissions-already-terminal' }
        : {}),
    },
  });
}

async function ay2025Story(plan: Plan, pre: PreloadedSyncSnapshot) {
  const specs = plan.apps.AY2025;
  const rows = classRows('AY2025');
  const byEnrolee = new Map(rows.map((r) => [r.enrolee_number, r]));
  // 18 withdrawn. Production's AY2025 withdrawals carry no dates and no
  // audit rows (pre-SIS import); admissions reads Withdrawn on every one.
  for (const a of specs.filter((x) => x.withdraw)) {
    await withdraw('AY2025', a, byEnrolee.get(a.enroleeNumber)!, {
      date: null,
      audit: false,
    });
  }
  // Submitted rows Directus already gave a class: the sync must hold them back.
  for (const a of specs.filter((x) => x.presetSection)) {
    await sync(a, pre, { heldBecause: NOT_ENROLLED_REASON });
  }
  // The legacy import lost ~70 enrolled children's application rows; the
  // status row (with its class) and the class list survived.
  const drop = specs
    .filter((x) => x.dropAppAfterSync)
    .map((x) => x.enroleeNumber);
  const { error } = await service()
    .from(tbl('AY2025', 'applications'))
    .delete()
    .in('enroleeNumber', drop);
  if (error) throw new Error(`drop AY2025 applications: ${error.message}`);
}

async function ay2026Story(
  plan: Plan,
  pre: PreloadedSyncSnapshot,
  setup: Setup
) {
  const ay: Ay = 'AY2026';
  const specs = plan.apps[ay];
  const sections = setup.sections;
  const sb = service();

  // The transfer: P3 Courageous → Responsibility, through the RPC the
  // Records "Move class" action calls, with the route's admissions mirror
  // (lib/sis/section-transfer.ts) and its audit row
  // (app/api/sis/students/[enroleeNumber]/transfer-section/route.ts).
  const tr = specs.find(
    (a) => a.child.key === plan.transferKey && a.outcome === 'enrolled'
  )!;
  const source = sections.find(
    (s) => s.ay === ay && s.level === 'P3' && s.name === 'Courageous'
  )!;
  const target = sections.find(
    (s) => s.ay === ay && s.level === 'P3' && s.name === 'Responsibility'
  )!;
  const src = classRows(ay).find((r) => r.enrolee_number === tr.enroleeNumber)!;
  const transferDay = '2026-08-14';
  const { data: trData, error: trErr } = await sb.rpc(
    'transfer_student_section',
    {
      p_source_enrolment_id: src.id,
      p_target_section_id: target.id,
      p_enrolee_number: tr.enroleeNumber,
      p_today: transferDay,
    }
  );
  if (trErr) throw new Error(`transfer_student_section: ${trErr.message}`);
  const levelLabel = sql(`select label from levels where code = 'P3'`);
  await editStatus(
    ay,
    tr.enroleeNumber,
    {
      classSection: target.name,
      classLevel: levelLabel,
      classStatus: 'Finished',
      classUpdatedby: REGISTRAR.email,
    },
    transferDay
  );
  {
    const rpc = (trData ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    const numOr = (v: unknown) => (typeof v === 'number' ? v : null);
    // Names through supabase-js, never psql's line-and-`|` output (free text).
    const [st] = await must(
      `people: student ${tr.child.studentNumber}`,
      sb
        .from('students')
        .select('student_number, first_name, middle_name, last_name')
        .eq('student_number', tr.child.studentNumber)
    );
    const studentNumber = st.student_number as string;
    const studentName = [st.first_name, st.middle_name, st.last_name]
      .map((p) => ((p as string | null) ?? '').trim())
      .filter(Boolean)
      .join(' ');
    const term = await getTermForDate(transferDay, ay, sb);
    await logAction({
      service: sb,
      actor: REGISTRAR,
      action: 'student.section.transfer',
      entityType: 'enrolment_status',
      entityId: tr.enroleeNumber,
      context: {
        ay_code: ay,
        enroleeNumber: tr.enroleeNumber,
        studentNumber,
        ...(studentName ? { studentName } : {}),
        fromSection: source.name,
        fromLevel: levelLabel,
        toSection: target.name,
        toLevel: levelLabel,
        targetSectionId: target.id,
        transferDate: transferDay,
        termNumber: term?.termNumber ?? null,
        termLabel: term?.termLabel ?? null,
        from_section_student_id: src.id,
        from_index_number: numOr(rpc.source_index_number),
        from_withdrawal_date: str(rpc.source_withdrawal_date) ?? transferDay,
        to_section_student_id: str(rpc.new_enrolment_id),
        to_index_number: numOr(rpc.index_number),
        returned_to_previous_section: rpc.reused_enrolment === true,
      },
    });
  }

  // Withdrawals, picked now that index numbers exist: 11 children across 7
  // classes, never the last number in the class, so each leaves a visible
  // gap in the class's active numbering (production: 8 of 22 classes).
  const r = rng('people:ay2026:withdraw');
  const rows = classRows(ay);
  const maxBySection = new Map<string, number>();
  for (const row of rows)
    maxBySection.set(
      row.section_id,
      Math.max(maxBySection.get(row.section_id) ?? 0, row.index_number)
    );
  const specByEnrolee = new Map(specs.map((a) => [a.enroleeNumber, a]));
  const eligible = rows.filter((row) => {
    const a = specByEnrolee.get(row.enrolee_number);
    return (
      a &&
      a.outcome === 'enrolled' &&
      !a.protected &&
      !a.late &&
      row.index_number > 1 &&
      row.index_number < maxBySection.get(row.section_id)!
    );
  });
  const bySection = new Map<string, SsRow[]>();
  for (const row of eligible)
    bySection.set(row.section_id, [
      ...(bySection.get(row.section_id) ?? []),
      row,
    ]);
  const chosenSections = r
    .shuffle(
      [...bySection.keys()]
        .filter((id) => bySection.get(id)!.length >= 4)
        .sort()
    )
    .slice(0, 7);
  const quota = [2, 2, 2, 2, 1, 1, 1];
  const picks: SsRow[] = [];
  chosenSections.forEach((id, i) =>
    picks.push(...r.shuffle(bySection.get(id)!).slice(0, quota[i]))
  );
  for (let i = 0; i < picks.length; i++) {
    const row = picks[i];
    const a = specByEnrolee.get(row.enrolee_number)!;
    const dated = i < 9; // production: most AY2026 withdrawals carry a last day
    const date = dated ? dateBetween(r, '2026-02-26', '2026-08-13') : null;
    await withdraw(ay, a, row, {
      date,
      approved: i === 0 ? addDays(date!, 7) : null,
      reason: i === 0 ? 'other' : null,
      notes:
        i === 0
          ? 'Family moving back to Manila at the end of the term; parent emailed the office and collected the report book.'
          : null,
      // Every withdrawal flips admissions (KD #220). Production's single
      // "withdrawn on the class list, Enrolled in admissions" row is the
      // transfer's source row above — a move, not a withdrawal from school.
      audit: true,
    });
  }

  // One Term 3 late enrollee who later left too (the earliest to join, so a
  // month of school still fits before the last day).
  {
    const lateSpec = specs
      .filter((x) => x.late && x.outcome === 'enrolled')
      .sort((x, y) => x.late!.date.localeCompare(y.late!.date))[0];
    const row = classRows(ay).find(
      (x) => x.enrolee_number === lateSpec.enroleeNumber
    )!;
    await withdraw(ay, lateSpec, row, {
      date: schoolDayFrom(setup, ay, addDays(lateSpec.late!.date, 28)),
      audit: true,
    });
  }

  // Youngstarters: on the class list, admissions back at Submitted with the
  // class blank — level and class both (production: all 15 AY2026
  // Youngstarters).
  for (const a of specs.filter((x) => x.ysSubmittedFlip)) {
    await editStatus(
      ay,
      a.enroleeNumber,
      {
        applicationStatus: 'Submitted',
        classLevel: null,
        classSection: null,
        classStatus: null,
      },
      '2026-09-28'
    );
  }

  // Classes preset on Submitted rows: the sync must hold them back.
  for (const a of specs.filter((x) => x.presetSection)) {
    await sync(a, pre, { heldBecause: NOT_ENROLLED_REASON });
  }

  await unplaceSome(plan, setup);
}

/**
 * Production's AY2026 has 16 index numbers missing outright (max − count of
 * distinct numbers) across 8 of 22 classes; AY2025 has none. The likely
 * history: a child placed, numbered, then taken off the list when admissions
 * put them back to not Enrolled (class cleared with it). So: after
 * numbering, a few new children's class rows are removed, never the
 * last number in a class (the next sync would otherwise just reuse it).
 */
async function unplaceSome(plan: Plan, setup: Setup) {
  const ay: Ay = 'AY2026';
  const r = rng('people:ay2026:unplace');
  const rows = classRows(ay);
  const maxBySection = new Map<string, number>();
  for (const row of rows)
    maxBySection.set(
      row.section_id,
      Math.max(maxBySection.get(row.section_id) ?? 0, row.index_number)
    );
  const status = new Map(
    sqlRows(
      `select ss.id, ss.enrollment_status from section_students ss join sections s on s.id = ss.section_id
         join academic_years a on a.id = s.academic_year_id where a.ay_code = '${ay}'`
    ).map(([id, s]) => [id, s])
  );
  const specByEnrolee = new Map(plan.apps[ay].map((a) => [a.enroleeNumber, a]));
  const bySection = new Map<string, SsRow[]>();
  for (const row of rows) {
    const a = specByEnrolee.get(row.enrolee_number);
    if (
      !a ||
      a.outcome !== 'enrolled' ||
      a.category !== 'New' ||
      a.protected ||
      a.late ||
      status.get(row.id) !== 'active' ||
      row.index_number >= maxBySection.get(row.section_id)!
    )
      continue;
    bySection.set(row.section_id, [
      ...(bySection.get(row.section_id) ?? []),
      row,
    ]);
  }
  const quota = [2, 2, 1, 1, 1, 1, 1, 1];
  const chosen = r.shuffle([...bySection.keys()].sort()).slice(0, quota.length);
  const picks: SsRow[] = [];
  chosen.forEach((id, i) =>
    picks.push(...r.shuffle(bySection.get(id)!).slice(0, quota[i]))
  );
  for (let i = 0; i < picks.length; i++) {
    const row = picks[i];
    const { error } = await service()
      .from('section_students')
      .delete()
      .eq('id', row.id);
    if (error) throw new Error(`unplace ${row.id}: ${error.message}`);
    await editStatus(
      ay,
      row.enrolee_number,
      {
        applicationStatus: i % 2 === 0 ? 'Submitted' : 'Cancelled',
        applicationUpdatedBy: ADMISSIONS.email,
        // The class comes off with the seat (production's not-Enrolled rows
        // holding a class are already accounted for by withdrawals + presets).
        classLevel: null,
        classSection: null,
        classStatus: null,
        classAY: null,
      },
      schoolDayFrom(setup, ay, dateBetween(r, '2026-01-12', '2026-02-27'))
    );
  }
}

/** The AY2027 application the portal re-issued (ay2027Story), and its new enrolee number. */
function ay2027Reissue(plan: Plan): { app: AppSpec; renumbered: string } {
  const app = plan.apps.AY2027.find(
    (x) => x.outcome === 'enrolled' && x.category === 'New' && x.level === 'P1'
  )!;
  return {
    app,
    renumbered: `E27${String(plan.apps.AY2027.length + 1).padStart(4, '0')}`,
  };
}

let seededPlan: Plan | null = null;

/**
 * Every documents row exactly as this phase INSERTED it, by enrolee number —
 * re-derived from the same seeded plan, never read back from the table. The
 * pfiles phase plans each slot's history from this: the live row is not a
 * stable input, because the app's freshen jobs flip a lapsed `Valid` to
 * `Expired` whenever a page reads the slot.
 */
export function seededDocumentRows(
  ay: Ay
): Map<string, Record<string, unknown>> {
  if (!seededPlan) {
    const setup = loadSetup();
    seededPlan = buildPlan(setup.sections, setup.terms, setup.teachingDays);
  }
  const reissue = ay === 'AY2027' ? ay2027Reissue(seededPlan) : null;
  const out = new Map<string, Record<string, unknown>>();
  for (const a of seededPlan.apps[ay]) {
    if (!a.hasDocs || !a.hasApp || !a.enroleeNumber) continue;
    const enrolee =
      reissue && a === reissue.app ? reissue.renumbered : a.enroleeNumber;
    out.set(enrolee, documentsRow(a));
  }
  return out;
}

async function ay2027Story(plan: Plan, pre: PreloadedSyncSnapshot) {
  const ay: Ay = 'AY2027';
  // Enrolled with no class on the admissions row: the sync has nothing to place.
  for (const a of plan.apps[ay].filter(
    (x) => x.outcome === 'enrolled_unplaced'
  )) {
    await sync(a, pre, { heldBecause: 'missing classLevel or classSection' });
  }

  // Production: one AY2027 class row whose enrolee number has no status row,
  // while the child's Enrolled admissions row has no class row. The child
  // was placed by the sync, then the portal re-issued the application under a
  // new enrolee number. Reproduced that way: sync first (done above), then
  // renumber the three admissions rows.
  const { app: a, renumbered } = ay2027Reissue(plan);
  const sb = service();
  for (const kind of ['applications', 'documents'] as const) {
    const { error } = await sb
      .from(tbl(ay, kind))
      .update({ enroleeNumber: renumbered })
      .eq('enroleeNumber', a.enroleeNumber);
    if (error) throw new Error(`${tbl(ay, kind)} renumber: ${error.message}`);
  }
  // The status row: same edit, then the touch trigger's "today" put back.
  const t = tbl(ay, 'status');
  const { data: before, error: bErr } = await sb
    .from(t)
    .select('applicationUpdatedDate')
    .eq('enroleeNumber', a.enroleeNumber)
    .single();
  if (bErr) throw new Error(`${t}: ${bErr.message}`);
  const { error: e1 } = await sb
    .from(t)
    .update({ enroleeNumber: renumbered })
    .eq('enroleeNumber', a.enroleeNumber);
  if (e1) throw new Error(`${t} renumber: ${e1.message}`);
  const { error: e2 } = await sb
    .from(t)
    .update({
      applicationUpdatedDate: (
        before as { applicationUpdatedDate: string | null }
      ).applicationUpdatedDate,
    })
    .eq('enroleeNumber', renumbered);
  if (e2) throw new Error(`${t} stamps: ${e2.message}`);
}

/**
 * Production's per-column fill of the stage `*UpdatedDate` / `*Updatedby`
 * stamps (filled / status rows; prod-profile.md §1a). AY2025 came from the
 * old system with some stages stamped; AY2026 was worked in Directus, which
 * never stamped them (~1%). Columns the profile does not list (the
 * application / registration / document / class `by` columns) follow their
 * date column. AY2027 is left as built (its stamps are ~full in production).
 */
const STAMP_FILL: Record<
  'AY2025' | 'AY2026',
  { n: number; cols: Array<[string, number, string, number | null]> }
> = {
  AY2025: {
    n: 828,
    cols: [
      ['applicationUpdatedDate', 80, 'applicationUpdatedBy', null],
      ['registrationUpdateDate', 152, 'registrationUpdatedby', null],
      ['documentUpdatedDate', 580, 'documentUpdatedby', null],
      ['assessmentUpdatedDate', 120, 'assessmentUpdatedby', 120],
      ['contractUpdatedDate', 551, 'contractUpdatedby', 551],
      ['feeUpdatedDate', 530, 'feeUpdatedby', 530],
      ['classUpdatedDate', 1, 'classUpdatedby', null],
      ['suppliesUpdatedDate', 85, 'suppliesUpdatedby', 85],
      ['orientationUpdatedDate', 0, 'orientationUpdateby', 0],
    ],
  },
  AY2026: {
    n: 496,
    cols: [
      ['applicationUpdatedDate', 55, 'applicationUpdatedBy', null],
      ['registrationUpdateDate', 6, 'registrationUpdatedby', null],
      ['documentUpdatedDate', 4, 'documentUpdatedby', null],
      ['assessmentUpdatedDate', 4, 'assessmentUpdatedby', 2],
      ['contractUpdatedDate', 4, 'contractUpdatedby', 2],
      ['feeUpdatedDate', 3, 'feeUpdatedby', 2],
      ['classUpdatedDate', 36, 'classUpdatedby', null],
      ['suppliesUpdatedDate', 1, 'suppliesUpdatedby', 1],
      ['orientationUpdatedDate', 0, 'orientationUpdateby', 0],
    ],
  },
};
export const STAMP_COLUMNS = STAMP_FILL;

/**
 * Thins each stamp column to production's fill rate: keeps that many of the
 * filled rows (rows a story edit touched first, then a fixed hash order) and
 * blanks the rest, date and `by` together. Only stamp columns change, which
 * the touch trigger (migration 087) excludes, so nothing re-stamps.
 */
function hollowStageStamps(ay: 'AY2025' | 'AY2026') {
  const t = `public.${tbl(ay, 'status')}`;
  const rowsN = Number(sql(`select count(*) from ${t}`));
  const kept = [...touched[ay]].map((e) => `'${e}'`).join(',') || `''`;
  const { n, cols } = STAMP_FILL[ay];
  const stmts: string[] = [];
  const thin = (col: string, keep: number, alsoNull: string[]) =>
    `with ranked as (
       select id, row_number() over (
         order by (coalesce("enroleeNumber",'') in (${kept})) desc,
                  md5(coalesce("enroleeNumber",'') || id::text || '${col}')) rn
         from ${t} where "${col}" is not null)
     update ${t} x set ${[col, ...alsoNull].map((c) => `"${c}" = null`).join(', ')}
       from ranked where ranked.id = x.id and ranked.rn > ${keep};`;
  for (const [date, dateN, by, byN] of cols) {
    stmts.push(thin(date, Math.round((dateN / n) * rowsN), [by]));
    if (byN !== null) stmts.push(thin(by, Math.round((byN / n) * rowsN), []));
    // A `by` never outlives its date.
    stmts.push(`update ${t} set "${by}" = null where "${date}" is null;`);
  }
  sql(stmts.join('\n'));
}

// ── Records extras ────────────────────────────────────────────────────────

async function insertOrphans(plan: Plan) {
  await insertAll(
    'students',
    plan.orphans.map((o) => ({
      student_number: o.studentNumber,
      first_name: o.first,
      middle_name: o.middle,
      last_name: o.last,
      is_active: o.isActive,
    }))
  );
}

/**
 * Houses and the school's own numbers — both AY2026 class-list children only
 * (production: every housed student is on the AY2026 list, 399 of its 431;
 * school numbers on 221 of them — all 15 Youngstarters with a `Y` number,
 * 206 `H`). Each house is written as the house route writes it, with its
 * `sis.house.update` audit row (app/api/sis/students/[enroleeNumber]/house).
 */
async function housesAndSchoolNumbers(): Promise<{
  housed: number;
  numbered: number;
  ay2026: number;
  total: number;
}> {
  const r = rng('people:houses');
  const total = Number(sql(`select count(*) from students`));
  // One row per AY2026 child (the transfer's two rows share an enrolee).
  const kids = sqlRows(
    `select distinct on (st.id) st.id, st.student_number, ss.enrolee_number,
            ss.enrollment_status, l.code
       from section_students ss
       join students st on st.id = ss.student_id
       join sections s on s.id = ss.section_id
       join levels l on l.id = s.level_id
       join academic_years a on a.id = s.academic_year_id
      where a.ay_code = 'AY2026'
      order by st.id, (ss.enrollment_status = 'withdrawn'), ss.index_number`
  )
    .map(([id, number, enrolee, status, level]) => ({
      id,
      number,
      enrolee,
      withdrawn: status === 'withdrawn',
      ys: level === 'YS',
    }))
    .sort((a, b) => a.number.localeCompare(b.number));

  // Houses: ~92.6% of the list, the children still on it first.
  const target = Math.round((kids.length * 399) / 431);
  const chosen = [
    ...r.shuffle(kids.filter((k) => !k.withdrawn)),
    ...r.shuffle(kids.filter((k) => k.withdrawn)),
  ].slice(0, target);
  const houses = sqlRows(`select id, code, name from houses order by code`);
  const byCode = new Map(houses.map(([id, code]) => [code, id]));
  const nameById = new Map(houses.map(([id, , name]) => [id, name]));
  const codes = allocate(
    r,
    [
      ['H1', 1],
      ['H2', 1],
      ['H3', 1],
      ['H4', 1],
    ],
    chosen.length
  );
  const values = chosen
    .map((k, i) => `('${k.id}'::uuid,'${byCode.get(codes[i])}'::uuid)`)
    .join(',');
  sql(`update students st set house_id = v.house
         from (values ${values}) v(sid, house) where st.id = v.sid`);
  await logActions(
    service(),
    HOUSE_ADMIN,
    chosen.map((k, i) => ({
      action: 'sis.house.update' as const,
      entityType: 'enrolment_application' as const,
      entityId: k.enrolee,
      context: houseAuditContext({
        enroleeNumber: k.enrolee,
        studentNumber: k.number,
        studentId: k.id,
        before: null,
        after: byCode.get(codes[i])!,
        nameById,
      }),
    }))
  );

  // The school's own numbers: every Youngstarter (its `Y` class-list
  // number), and about half the rest — mostly agreeing with the SIS number,
  // the others from the school's own count from 1 (same H{YY}{NNNN} shape).
  const nTarget = Math.round((kids.length * 221) / 431);
  const ys = kids.filter((k) => k.ys);
  const rest = r
    .shuffle(kids.filter((k) => !k.ys))
    .slice(0, Math.max(0, nTarget - ys.length));
  const used = new Set<string>();
  const vals: string[] = [];
  ys.forEach((k, i) => {
    const v = `Y26${String(i + 1).padStart(4, '0')}`;
    used.add(v);
    vals.push(`('${k.id}'::uuid,'${v}')`);
  });
  let seq = 0;
  for (const k of rest) {
    let v: string;
    if (/^H\d{6}$/.test(k.number) && r.chance(0.6) && !used.has(k.number)) {
      v = k.number;
    } else {
      do v = `H26${String(++seq).padStart(4, '0')}`;
      while (used.has(v) || v === k.number);
    }
    used.add(v);
    vals.push(`('${k.id}'::uuid,'${v}')`);
  }
  sql(`update students st set school_student_number = v.ssn
         from (values ${vals.join(',')}) v(sid, ssn) where st.id = v.sid`);
  return {
    housed: chosen.length,
    numbered: vals.length,
    ay2026: kids.length,
    total,
  };
}

// ── Entry point ───────────────────────────────────────────────────────────

export async function runPeople(): Promise<void> {
  for (const ay of AYS) touched[ay].clear();
  const setup = loadSetup();
  const plan = buildPlan(setup.sections, setup.terms, setup.teachingDays);

  await insertAll('ay2026_discount_codes', discountCodeRows('AY2026'));
  await insertAll('ay2027_discount_codes', discountCodeRows('AY2027'));

  for (const ay of AYS) await runAy(ay, plan, setup);

  await insertOrphans(plan);
  const extras = await housesAndSchoolNumbers();
  console.log(
    `  ${extras.total} students (${plan.orphans.length} legacy with no class row); of ${extras.ay2026} AY2026 children: house ${extras.housed}, school number ${extras.numbered}`
  );
}
