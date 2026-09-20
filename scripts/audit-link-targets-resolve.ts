// scripts/audit-link-targets-resolve.ts
// The links point at real ROUTES (audit-dead-links.ts proves that). This asks
// the next question: do the IDs they carry resolve to a real RECORD?
//
// WHY THIS IS THE ONE THAT BITES. `/records/students/[studentNumber]` matches
// any string, so a link built from the wrong number is not a dead link — it is
// a live link to a page that calls `notFound()`. Until 2026-09-20 that rendered
// a blank screen, which is how it gets reported as "a dead link" and why a
// route-level audit finds nothing.
//
// The attendance audit log was one instance, already fixed: it built
// `/attendance/<attendance_daily id>` because `entity_id` is not a section id.
// This checks the rest of the identifier links the same way — against the data
// the surfaces actually render.
//
// Reads only. Usage:
//   npx tsx --env-file=.env.local scripts/audit-link-targets-resolve.ts

import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();
const AY = 'AY2026';

let problems = 0;
const note = (s: string) => console.log(`   ${s}`);
const bad = (s: string) => {
  problems++;
  console.log(`   🔴 ${s}`);
};
const good = (s: string) => console.log(`   ✅ ${s}`);

async function main() {
  // The sets each route resolves against.
  const { data: students } = await sb.from('students').select('student_number');
  const studentNumbers = new Set(
    (students ?? []).map((s: any) => s.student_number)
  );

  const { data: secs } = await sb.from('sections').select('id');
  const sectionIds = new Set((secs ?? []).map((s: any) => s.id));

  const { data: apps } = await sb
    .from(`${AY.toLowerCase()}_enrolment_applications`)
    .select('"enroleeNumber","studentNumber"');
  const enrolees = new Set((apps ?? []).map((a: any) => a.enroleeNumber));

  // ── 1. /records/students/[studentNumber] from an ADMISSIONS number ────────
  // Admissions surfaces link to a student record using the number on the
  // application. For the children whose two stores disagree, that number is not
  // the one `students` is keyed on, so the page 404s.
  // ⚠ THE GUARD IS PART OF THE LINK. cohort-table.tsx only builds a Records
  // URL when `scope === 'enrolled' && row.studentNumber`; otherwise it sends
  // you to the application. Ignoring that condition, a first version of this
  // check reported 48 unresolvable numbers — every one an applicant who was
  // never enrolled and is therefore never linked this way. Testing the
  // unguarded set measures a link the app does not make.
  console.log(
    '\n1. /records/students/[studentNumber] — the ENROLLED case the UI links'
  );
  const { data: statuses } = await sb
    .from(`${AY.toLowerCase()}_enrolment_status`)
    .select('"enroleeNumber","applicationStatus"');
  const enrolled = new Set(
    (statuses ?? [])
      .filter((s: any) => /enrol/i.test(String(s.applicationStatus ?? '')))
      .map((s: any) => s.enroleeNumber)
  );
  const linkable = (apps ?? [])
    .filter((a: any) => enrolled.has(a.enroleeNumber) && a.studentNumber)
    .map((a: any) => a.studentNumber as string);
  const unresolvable = linkable.filter((n) => !studentNumbers.has(n));
  if (unresolvable.length) {
    bad(
      `${unresolvable.length} of ${linkable.length} ENROLLED ${AY} students have a studentNumber with no students row`
    );
    note(`e.g. ${unresolvable.slice(0, 8).join(', ')}`);
    note('Clicking one of these from a cohort table lands on a 404.');
  } else {
    good(
      `all ${linkable.length} enrolled ${AY} student numbers resolve to a students row`
    );
  }

  // ── 2. /records/students/by-enrolee/[enroleeNumber] ───────────────────────
  // ⚠ NOT A 404 RISK, and the first version of this check wrongly said it was.
  // That route is a REDIRECT, not a page: it sends you to Records when the
  // child is in the grading schema and to the application when they are not,
  // so neither branch can miss. Recorded rather than dropped, so nobody
  // re-adds the check.
  console.log('\n2. /records/students/by-enrolee/[enroleeNumber]');
  good('a redirect with both branches covered — cannot 404, nothing to check');

  // ── 3. /attendance/[sectionId] and /classroom/[sectionId] ─────────────────
  console.log('\n3. Section links from the roster');
  const { data: rosterSecs } = await sb
    .from('section_students')
    .select('section_id');
  const usedSections = [
    ...new Set((rosterSecs ?? []).map((r: any) => r.section_id)),
  ];
  const deadSections = usedSections.filter((s) => !sectionIds.has(s));
  if (deadSections.length)
    bad(
      `${deadSections.length} roster rows point at a section that no longer exists`
    );
  else
    good(`all ${usedSections.length} sections referenced by the roster exist`);

  // ── 4. /records/students/[studentNumber] from the ROSTER ──────────────────
  console.log('\n4. /records/students/[studentNumber] from the roster');
  const { data: rosterStudents } = await sb
    .from('section_students')
    .select('students(student_number)');
  const rosterNums = (rosterStudents ?? [])
    .map((r: any) => r.students?.student_number)
    .filter(Boolean);
  const deadRoster = rosterNums.filter((n: string) => !studentNumbers.has(n));
  if (deadRoster.length)
    bad(
      `${deadRoster.length} roster rows carry a student number with no students row`
    );
  else
    good(
      `all ${rosterNums.length} roster student numbers resolve (this is the path most links take)`
    );

  // ── 5. Attendance audit log — the one already fixed, kept as a regression ──
  console.log('\n5. Attendance audit log "Open section" (fixed 2026-09-20)');
  const { attendanceAuditLink } = await import('../lib/audit/attendance-links');
  const { data: auditRows } = await sb
    .from('audit_log')
    .select('action,entity_type,entity_id,context')
    .in('action', [
      'attendance.daily.update',
      'attendance.daily.correct',
      'attendance.import.bulk',
    ])
    .limit(500);
  let offered = 0;
  let broken = 0;
  for (const r of (auditRows ?? []) as any[]) {
    const link = attendanceAuditLink(r);
    if (!link) continue;
    offered++;
    const id = link.href.split('/')[2].split('?')[0];
    if (!sectionIds.has(id)) broken++;
  }
  if (broken)
    bad(`${broken} of ${offered} audit links still point at a non-section`);
  else good(`${offered} links offered, every one lands on a real section`);

  console.log(
    problems === 0
      ? '\n✅ every identifier link checked resolves to a real record'
      : `\n🔴 ${problems} link source(s) can produce a 404`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
