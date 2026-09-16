// scripts/audit-withdrawn-without-class.ts
//
// WITHDRAWN STUDENTS WHO HAVE NO CLASS — and whether they are the index holes.
//
// ── WHY ────────────────────────────────────────────────────────────────────
//
// Mr Ace, 2026-09-16: "you cant be an enrolled student and be withdrawn with
// no class assignment."
//
// Hard Rule #6 is explicit: a withdrawn student KEEPS their `section_students`
// row with `enrollment_status = 'withdrawn'`. They are greyed out on the
// roster and their index number is retired, never reused. Vanishing from the
// roster is not what withdrawal means.
//
// Three children were found in that state one at a time — Jannat Ajmal
// (2026-09-15), then Ashley Rae Cama and Muhammad Ibrahim Ajmal (2026-09-16).
// Each looked like a one-off. Reading the withdrawal remarks turned up 21 more
// in a single pass, which is the point of this script: stop finding them one
// at a time.
//
// ── THE CONNECTION WORTH TESTING ───────────────────────────────────────────
//
// The index-number health note has carried "29 holes across 13 sections" for
// weeks with no explanation. S3 Consistency's holes were #5 and #25, and #5
// turned out to be Cama — a withdrawn student whose row was missing. So the
// hypothesis is that THE HOLES ARE THE MISSING WITHDRAWN STUDENTS, and the two
// open problems are one problem.
//
// This script tests that rather than assuming it: it lists every withdrawn
// student with no roster row, every hole, and says whether the counts and the
// sections line up.
//
// ⚠ IT PROPOSES NO PLACEMENT. Admissions may say which class a child belonged
// to, but a hole is only evidence that SOMEBODY is missing, not evidence of
// WHO. Matching a name to a number is Miss Jo's masterlist, not an inference.
//
// STRICTLY READ-ONLY. SELECTs only, no --fix.
//
// Run:
//   npx tsx --env-file=.env.local scripts/audit-withdrawn-without-class.ts
//   npx tsx --env-file=.env.local scripts/audit-withdrawn-without-class.ts --ay AY2026
import { createServiceClient } from '../lib/supabase/service';
import { createAdmissionsClient } from '../lib/supabase/admissions';

async function main() {
  const i = process.argv.indexOf('--ay');
  const onlyAy = i >= 0 ? process.argv[i + 1] : null;

  const svc = createServiceClient();
  const admissions = createAdmissionsClient();

  const { data: years } = await svc
    .from('academic_years')
    .select('id, ay_code')
    .order('ay_code');

  for (const y of (years ?? []) as { id: string; ay_code: string }[]) {
    if (onlyAy && y.ay_code !== onlyAy) continue;
    const prefix = `ay${y.ay_code.slice(2)}`;

    const { data: statusRows, error } = await admissions
      .from(`${prefix}_enrolment_status`)
      .select('enroleeNumber, enroleeName, applicationStatus, levelApplied')
      .eq('applicationStatus', 'Withdrawn');
    if (error) {
      console.log(`${y.ay_code}: ${error.message}`);
      continue;
    }
    const withdrawn = (statusRows ?? []) as {
      enroleeNumber: string;
      enroleeName: string | null;
      levelApplied: string | null;
    }[];
    if (withdrawn.length === 0) continue;

    const { data: apps } = await admissions
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, studentNumber, levelApplied')
      .in(
        'enroleeNumber',
        withdrawn.map((r) => r.enroleeNumber)
      );
    const appByEnrolee = new Map(
      (apps ?? []).map((a) => [
        (a as { enroleeNumber: string }).enroleeNumber,
        a as { studentNumber: string | null; levelApplied: string | null },
      ])
    );

    const numbers = withdrawn
      .map((r) => appByEnrolee.get(r.enroleeNumber)?.studentNumber)
      .filter((n): n is string => !!n);
    const { data: students } = await svc
      .from('students')
      .select('id, student_number')
      .in('student_number', numbers);
    const idByNumber = new Map(
      (students ?? []).map((s) => [
        (s as { student_number: string }).student_number,
        (s as { id: string }).id,
      ])
    );

    const { data: sections } = await svc
      .from('sections')
      .select('id, name, level:levels(code)')
      .eq('academic_year_id', y.id);
    const sectionIds = (sections ?? []).map((s) => (s as { id: string }).id);

    const { data: enrolments } = await svc
      .from('section_students')
      .select('student_id, section_id, index_number, enrollment_status')
      .in('section_id', sectionIds);
    const placed = new Set(
      (enrolments ?? []).map((e) => (e as { student_id: string }).student_id)
    );

    console.log(`\n${'='.repeat(74)}`);
    console.log(`${y.ay_code} — ${withdrawn.length} withdrawn in admissions`);
    console.log('='.repeat(74));

    const missing: { enrolee: string; name: string; level: string }[] = [];
    let noStudentRow = 0;
    for (const w of withdrawn) {
      const app = appByEnrolee.get(w.enroleeNumber);
      const sid = app?.studentNumber
        ? idByNumber.get(app.studentNumber)
        : undefined;
      if (!sid) noStudentRow += 1;
      if (sid && placed.has(sid)) continue;
      missing.push({
        enrolee: w.enroleeNumber,
        name: (w.enroleeName ?? '').trim(),
        level: app?.levelApplied ?? w.levelApplied ?? '?',
      });
    }

    console.log(`\n  Withdrawn with NO class row: ${missing.length}`);
    console.log(`  ...of which have no students row at all: ${noStudentRow}\n`);
    for (const m of missing.sort((a, b) => a.level.localeCompare(b.level))) {
      console.log(
        `    ${m.enrolee}  ${m.level.padEnd(18)} ${m.name.slice(0, 40)}`
      );
    }

    // ---- The holes, section by section ----------------------------------
    const bySection = new Map<string, number[]>();
    for (const e of (enrolments ?? []) as {
      section_id: string;
      index_number: number;
    }[]) {
      const list = bySection.get(e.section_id) ?? [];
      list.push(e.index_number);
      bySection.set(e.section_id, list);
    }

    let holeTotal = 0;
    let sectionsWithHoles = 0;
    const holeLines: string[] = [];
    for (const s of (sections ?? []) as {
      id: string;
      name: string;
      level: { code: string } | { code: string }[] | null;
    }[]) {
      const taken = new Set(bySection.get(s.id) ?? []);
      if (taken.size === 0) continue;
      const max = Math.max(...taken);
      const holes: number[] = [];
      for (let n = 1; n <= max; n++) if (!taken.has(n)) holes.push(n);
      if (holes.length === 0) continue;
      sectionsWithHoles += 1;
      holeTotal += holes.length;
      const lv = Array.isArray(s.level) ? s.level[0] : s.level;
      holeLines.push(
        `    ${`${lv?.code ?? '??'} ${s.name}`.padEnd(26)} #${holes.join(', #')}`
      );
    }

    console.log(
      `\n  Index holes: ${holeTotal} across ${sectionsWithHoles} section(s)\n`
    );
    for (const line of holeLines) console.log(line);

    console.log(
      `\n  ${'-'.repeat(70)}\n` +
        `  withdrawn with no class : ${missing.length}\n` +
        `  index holes             : ${holeTotal}\n` +
        (missing.length === holeTotal
          ? '  → the counts match. The holes are very likely these students.\n'
          : '  → the counts DIFFER, so the holes are not only these students.\n' +
            '    Do not assume one explains the other.\n')
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
