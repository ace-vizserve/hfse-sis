// scripts/audit-post-merge-health.ts
// Read-only. Cross-module health check after the AY2026 T3 attendance
// re-import, the 37-child duplicate merge and the 9 mid-year withdrawals.
//
// The merge repointed `section_students.student_id`. Grades and attendance
// hang off `section_students.id`, which did not change — this verifies that
// claim against the data instead of restating it, and checks each module for
// rows left pointing at nothing.
//
// Run: npx tsx --env-file=.env.local scripts/audit-post-merge-health.ts
import { createServiceClient } from '../lib/supabase/service';

const AY_CODE = 'AY2026';

async function page<T>(
  svc: any,
  table: string,
  select: string,
  build?: (q: any) => any
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = svc
      .from(table)
      .select(select)
      .range(from, from + 999);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

function nameKey(last: string, first: string): string {
  const clean = (s: string) =>
    (s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .join(' ');
  return `${clean(last)}|${clean(first)}`;
}

const problems: string[] = [];
function check(ok: boolean, label: string, detail: string) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
  if (!ok) problems.push(`${label} — ${detail}`);
}

async function main() {
  const svc = createServiceClient();

  const { data: years } = await svc
    .from('academic_years')
    .select('id, ay_code');
  const ayById = new Map((years as any[]).map((y) => [y.id, y.ay_code]));
  const ay2026 = (years as any[]).find((y) => y.ay_code === AY_CODE)!.id;

  const placements = await page<any>(
    svc,
    'section_students',
    'id, index_number, enrollment_status, student_id, students!inner(id, student_number, last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
  );
  const ssById = new Map(placements.map((p) => [p.id, p]));
  const studentIds = new Set(placements.map((p) => p.student_id));

  // ---------------------------------------------------------------- RECORDS
  console.log('\n=== RECORDS ===');
  const byName = new Map<string, Set<string>>();
  for (const p of placements) {
    const k = nameKey(p.students.last_name, p.students.first_name);
    const s = byName.get(k) ?? new Set<string>();
    s.add(p.students.student_number.trim().toUpperCase());
    byName.set(k, s);
  }
  const split = [...byName].filter(([, nums]) => nums.size > 1);
  check(
    split.length === 0,
    'children split across two student numbers',
    `${split.length}`
  );
  split.forEach(([k, n]) => console.log(`        ${k}: ${[...n].join(' + ')}`));

  const perAy = new Map<string, number>();
  for (const p of placements) {
    const ay = ayById.get(p.sections.academic_year_id) ?? '?';
    perAy.set(ay, (perAy.get(ay) ?? 0) + 1);
  }
  console.log(
    `        placements: ${[...perAy]
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join('  ')}`
  );

  const withdrawn = placements.filter(
    (p) =>
      p.sections.academic_year_id === ay2026 &&
      p.enrollment_status === 'withdrawn'
  );
  check(
    withdrawn.every((p) => p.index_number != null),
    'withdrawn children keep their index number',
    `${withdrawn.length} withdrawn in AY2026`
  );

  // ------------------------------------------------------------- ATTENDANCE
  console.log('\n=== ATTENDANCE ===');
  const { data: t3 } = await svc
    .from('terms')
    .select('id')
    .eq('academic_year_id', ay2026)
    .eq('term_number', 3)
    .single();

  const daily = await page<any>(
    svc,
    'attendance_daily',
    'section_student_id, date, status, recorded_at',
    (q: any) => q.eq('term_id', (t3 as any).id).is('period_id', null)
  );
  const orphanMarks = daily.filter((d) => !ssById.has(d.section_student_id));
  check(
    orphanMarks.length === 0,
    'attendance rows pointing at no roster row',
    `${orphanMarks.length}`
  );

  const live = new Map<string, any>();
  for (const d of [...daily].sort((a, b) =>
    a.recorded_at < b.recorded_at ? -1 : 1
  ))
    live.set(`${d.section_student_id}|${d.date}`, d);
  const liveMarks = [...live.values()].filter((d) => d.status !== null);
  console.log(
    `        T3: ${daily.length} ledger rows, ${liveMarks.length} live marks`
  );

  const { data: cal } = await svc
    .from('school_calendar')
    .select('date, day_type')
    .eq('term_id', (t3 as any).id);
  const schoolDays = (cal as any[]).filter((c) => c.day_type === 'school_day');
  check(
    schoolDays.length === 50,
    'T3 school days',
    `${schoolDays.length} (expected 50)`
  );

  const rollups = await page<any>(
    svc,
    'attendance_records',
    'section_student_id, school_days, days_present, days_late, days_excused, days_absent, attendance_pct',
    (q: any) => q.eq('term_id', (t3 as any).id)
  );
  const orphanRollups = rollups.filter(
    (r) => !ssById.has(r.section_student_id)
  );
  check(
    orphanRollups.length === 0,
    'rollups pointing at no roster row',
    `${orphanRollups.length}`
  );

  // does each rollup match the live ledger?
  const liveByStudent = new Map<string, any[]>();
  for (const d of liveMarks)
    liveByStudent.set(d.section_student_id, [
      ...(liveByStudent.get(d.section_student_id) ?? []),
      d,
    ]);
  let drift = 0;
  const driftExamples: string[] = [];
  for (const r of rollups) {
    const marks = liveByStudent.get(r.section_student_id) ?? [];
    const onSchoolDay = marks.filter((m) =>
      schoolDays.some((s) => s.date === m.date)
    );
    // late enrollees prorate from enrollment_date, so only flag where the
    // rollup claims MORE days than the ledger can justify
    if (r.school_days > onSchoolDay.length) {
      drift++;
      if (driftExamples.length < 5) {
        const p = ssById.get(r.section_student_id);
        driftExamples.push(
          `        ${p?.sections.levels.code} ${p?.sections.name} #${p?.index_number} ${p?.students.last_name}: rollup says ${r.school_days}, ledger has ${onSchoolDay.length}`
        );
      }
    }
  }
  check(
    drift === 0,
    'rollups never claim more days than the ledger holds',
    `${drift} drifted`
  );
  driftExamples.forEach((e) => console.log(e));

  const pcts = rollups
    .map((r) => Number(r.attendance_pct))
    .filter((n) => !Number.isNaN(n));
  const allSame = new Set(pcts).size <= 1;
  check(
    !allSame && pcts.length > 0,
    'attendance percentages vary (not all 0 or 100)',
    `${pcts.length} rollups, min ${Math.min(...pcts).toFixed(2)}, max ${Math.max(...pcts).toFixed(2)}`
  );

  // ---------------------------------------------------------------- GRADING
  console.log('\n=== GRADING SHEETS ===');
  const entries = await page<any>(
    svc,
    'grade_entries',
    'id, section_student_id, grading_sheet_id'
  );
  const orphanEntries = entries.filter(
    (e) => !ssById.has(e.section_student_id)
  );
  check(
    orphanEntries.length === 0,
    'grade entries pointing at no roster row',
    `${orphanEntries.length}`
  );
  console.log(`        ${entries.length} grade entries total`);

  const sheets = await page<any>(
    svc,
    'grading_sheets',
    'id, section_id, term_id, is_locked'
  );
  const sheetIds = new Set(sheets.map((s) => s.id));
  const orphanBySheet = entries.filter(
    (e) => !sheetIds.has(e.grading_sheet_id)
  );
  check(
    orphanBySheet.length === 0,
    'grade entries pointing at no grading sheet',
    `${orphanBySheet.length}`
  );
  console.log(
    `        ${sheets.length} grading sheets, ${sheets.filter((s) => s.is_locked).length} locked`
  );

  // the 37 merged children: are their AY2025 grades reachable from today's record?
  const merged = placements.filter(
    (p) => ayById.get(p.sections.academic_year_id) === 'AY2025'
  );
  const entriesBySs = new Map<string, number>();
  for (const e of entries)
    entriesBySs.set(
      e.section_student_id,
      (entriesBySs.get(e.section_student_id) ?? 0) + 1
    );

  let reachable = 0;
  let ay25WithGrades = 0;
  for (const p of merged) {
    const n = entriesBySs.get(p.id) ?? 0;
    if (n === 0) continue;
    ay25WithGrades++;
    // reachable means: the student record on this AY2025 placement also holds
    // an AY2026 placement, i.e. one record spans both years
    const alsoThisYear = placements.some(
      (q) =>
        q.student_id === p.student_id && q.sections.academic_year_id === ay2026
    );
    if (alsoThisYear) reachable++;
  }
  console.log(
    `        AY2025 placements holding grades: ${ay25WithGrades}; of those, ${reachable} belong to a record that also has an AY2026 class`
  );

  // -------------------------------------------------------------- ADMISSIONS
  console.log('\n=== ADMISSIONS ===');
  const status = await page<any>(
    svc,
    'ay2026_enrolment_status',
    '"enroleeNumber", "enroleeName", "applicationStatus", "classLevel", "classSection"'
  );
  const apps = await page<any>(
    svc,
    'ay2026_enrolment_applications',
    '"enroleeNumber", "studentNumber"'
  );
  const snFor = new Map(apps.map((a) => [a.enroleeNumber, a.studentNumber]));
  // A child can hold a withdrawn placement alongside their live one (moved
  // class mid-year). Compare admissions against the ACTIVE placement, or the
  // comparison picks whichever row happened to come last.
  const placedBySn = new Map<string, any>();
  for (const p of placements) {
    if (p.sections.academic_year_id !== ay2026) continue;
    const sn = p.students.student_number.trim().toUpperCase();
    const held = placedBySn.get(sn);
    if (
      !held ||
      (held.enrollment_status === 'withdrawn' &&
        p.enrollment_status !== 'withdrawn')
    )
      placedBySn.set(sn, p);
  }

  let aligned = 0;
  const mismatch: string[] = [];
  const enrolled = status.filter((s) => s.applicationStatus === 'Enrolled');
  for (const a of enrolled) {
    const sn = (snFor.get(a.enroleeNumber) ?? '').trim().toUpperCase();
    const p = placedBySn.get(sn);
    if (!p) {
      mismatch.push(
        `        ${a.enroleeNumber} "${a.enroleeName}" — no AY2026 class`
      );
      continue;
    }
    const lvlOk =
      (a.classSection ?? '').trim().toUpperCase() ===
      p.sections.name.trim().toUpperCase();
    if (lvlOk) aligned++;
    else
      mismatch.push(
        `        ${a.enroleeNumber} "${a.enroleeName}" — admissions ${a.classSection}, records ${p.sections.name}`
      );
  }
  check(
    mismatch.length === 0,
    'enrolled children agree between admissions and records',
    `${aligned}/${enrolled.length}`
  );
  mismatch.slice(0, 10).forEach((m) => console.log(m));

  const unusedStudents = [...studentIds].length;
  console.log(
    `        ${unusedStudents} student records hold at least one placement`
  );

  // ------------------------------------------------------------------ RESULT
  console.log('\n=== RESULT ===');
  if (problems.length === 0) {
    console.log('  all checks passed');
  } else {
    console.log(`  ${problems.length} problem(s):`);
    problems.forEach((p) => console.log(`    ${p}`));
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
