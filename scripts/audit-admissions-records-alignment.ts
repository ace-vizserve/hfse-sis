// scripts/audit-admissions-records-alignment.ts
// Read-only. Compares what Admissions says about every AY2026 enrolee against
// what Records actually holds, and reports every disagreement.
//
// The link between the two sides is `studentNumber` (Hard Rule #4 — never
// `enroleeNumber`, which resets each AY). It lives on
// ay2026_enrolment_applications, so the chain is:
//
//   ay2026_enrolment_status.enroleeNumber
//     -> ay2026_enrolment_applications.enroleeNumber
//       -> .studentNumber
//         -> students.student_number
//           -> section_students (+ sections, levels) for the placement
//
// Four things are checked per enrolee:
//   A. Admissions says Enrolled, but there is no student record at all
//   B. Admissions says Enrolled, but the child is in no section
//   C. Admissions and Records disagree on level or section
//   D. Admissions does NOT say Enrolled, yet the child sits in a section
// plus the reverse sweep: children in a section with no admissions row.
//
// Run: npx tsx --env-file=.env.local scripts/audit-admissions-records-alignment.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../lib/supabase/service';

const AY_CODE = 'AY2026';
const OUT = 'scripts/audit-admissions-records-alignment-report.txt';

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

async function page<T>(
  svc: any,
  table: string,
  select: string,
  build?: (q: any) => any
): Promise<T[]> {
  const out: T[] = [];
  const SIZE = 1000;
  for (let from = 0; ; from += SIZE) {
    let q = svc
      .from(table)
      .select(select)
      .range(from, from + SIZE - 1);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < SIZE) break;
  }
  return out;
}

async function main() {
  const svc = createServiceClient();

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  // --- admissions ---
  const status = await page<any>(
    svc,
    'ay2026_enrolment_status',
    '"enroleeNumber", "enroleeName", "applicationStatus", "classStatus", "classLevel", "classSection", "levelApplied"'
  );
  const apps = await page<any>(
    svc,
    'ay2026_enrolment_applications',
    '"enroleeNumber", "studentNumber"'
  );
  const studentNumberFor = new Map<string, string | null>();
  for (const a of apps) studentNumberFor.set(a.enroleeNumber, a.studentNumber);

  // --- records ---
  const ss = await page<any>(
    svc,
    'section_students',
    'id, index_number, enrollment_status, students!inner(student_number, last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code, label))',
    (q: any) => q.eq('sections.academic_year_id', (ay as any).id)
  );
  const placementBySN = new Map<string, any[]>();
  for (const r of ss) {
    const sn = r.students?.student_number;
    if (!sn) continue;
    placementBySN.set(sn, [...(placementBySN.get(sn) ?? []), r]);
  }

  const allStudents = await page<any>(
    svc,
    'students',
    'id, student_number, last_name, first_name'
  );
  const studentBySN = new Map(allStudents.map((s) => [s.student_number, s]));

  const L: string[] = [];
  const say = (s = '') => {
    L.push(s);
    console.log(s);
  };

  say('AY2026 — Admissions vs Records alignment (read-only)');
  say('');
  say(`admissions enrolee rows: ${status.length}`);
  say(`application rows:        ${apps.length}`);
  say(`section placements:      ${ss.length}`);
  say(`student records:         ${allStudents.length}`);
  say('');

  const noStudentNumber: string[] = [];
  const noStudentRecord: string[] = [];
  const noPlacement: string[] = [];
  const placementMismatch: string[] = [];
  const placedButNotEnrolled: string[] = [];
  const multiPlacement: string[] = [];
  const aligned: string[] = [];

  const seenSN = new Set<string>();

  for (const a of status) {
    const sn = studentNumberFor.get(a.enroleeNumber) ?? null;
    const enrolled = a.applicationStatus === 'Enrolled';
    const label = `${a.enroleeNumber} "${a.enroleeName}" [${a.applicationStatus}]`;
    const admPlacement = `${a.classLevel ?? '-'} / ${a.classSection ?? '-'}`;

    if (!sn) {
      if (enrolled)
        noStudentNumber.push(`  ${label}  admissions says ${admPlacement}`);
      continue;
    }
    seenSN.add(sn);

    if (!studentBySN.has(sn)) {
      if (enrolled)
        noStudentRecord.push(
          `  ${label}  studentNumber=${sn}  admissions says ${admPlacement}`
        );
      continue;
    }

    const places = placementBySN.get(sn) ?? [];
    if (places.length === 0) {
      if (enrolled)
        noPlacement.push(
          `  ${label}  studentNumber=${sn}  admissions says ${admPlacement}, Records has no section`
        );
      continue;
    }
    if (places.length > 1) {
      multiPlacement.push(
        `  ${label}  studentNumber=${sn}  in ${places.length} sections: ${places.map((p) => `${p.sections.levels.code} ${p.sections.name}`).join(', ')}`
      );
    }

    const p = places[0];
    const recLevel = p.sections.levels.label;
    const recSection = p.sections.name;

    if (!enrolled) {
      placedButNotEnrolled.push(
        `  ${label}  studentNumber=${sn}  Records has them in ${recLevel} / ${recSection} (#${p.index_number}, ${p.enrollment_status})`
      );
      continue;
    }

    const levelSame = norm(a.classLevel) === norm(recLevel);
    const sectionSame = norm(a.classSection) === norm(recSection);
    if (levelSame && sectionSame) {
      aligned.push(sn);
    } else {
      placementMismatch.push(
        `  ${label}  studentNumber=${sn}\n` +
          `      Admissions: ${a.classLevel ?? '-'} / ${a.classSection ?? '-'}   (classStatus=${a.classStatus ?? '-'}, levelApplied=${a.levelApplied ?? '-'})\n` +
          `      Records:    ${recLevel} / ${recSection}  #${p.index_number}  ${p.enrollment_status}` +
          (levelSame ? '   <- section differs' : '   <- LEVEL differs')
      );
    }
  }

  // reverse sweep
  const orphanPlacements: string[] = [];
  for (const [sn, places] of placementBySN) {
    if (seenSN.has(sn)) continue;
    const p = places[0];
    orphanPlacements.push(
      `  ${p.sections.levels.code} ${p.sections.name} #${p.index_number} "${p.students.last_name}, ${p.students.first_name}"  studentNumber=${sn}  ${p.enrollment_status}`
    );
  }

  const section = (title: string, rows: string[]) => {
    say(`=== ${title}: ${rows.length} ===`);
    rows.sort();
    rows.forEach((r) => say(r));
    say('');
  };

  say(`ALIGNED (admissions and records agree): ${aligned.length}`);
  say('');
  section(
    'A. Enrolled, but no studentNumber recorded on the application',
    noStudentNumber
  );
  section('B. Enrolled, but no student record exists', noStudentRecord);
  section('C. Enrolled, but Records has them in no section', noPlacement);
  section(
    'D. Enrolled, but Admissions and Records disagree on the class',
    placementMismatch
  );
  section(
    'E. NOT Enrolled in Admissions, yet sitting in a class',
    placedButNotEnrolled
  );
  section('F. In more than one section', multiPlacement);
  section(
    'G. In a class, but no admissions enrolee row links to them',
    orphanPlacements
  );

  writeFileSync(OUT, L.join('\n') + '\n');
  console.log(`\nWrote ${OUT}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
