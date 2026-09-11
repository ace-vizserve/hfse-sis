// scripts/audit-ay2026-unplaced-students.ts
// Read-only. Karl Miguel Cacao turned out to be a child with an AY2025 class
// and no AY2026 class, whose AY2026 application never got past "Submitted" —
// yet he is on the paper register and attending.
//
// This asks how many others look like that: every student with an AY2025
// placement but none for AY2026, with what Admissions says about their AY2026
// application, so the "didn't come back" cases can be told apart from the
// "attending but never enrolled" ones.
//
// Run: npx tsx --env-file=.env.local scripts/audit-ay2026-unplaced-students.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../lib/supabase/service';
import { parseWorkbookT3 } from '../lib/sis/backfill/attendance/attendance-workbook-t3';

const OUT = 'scripts/audit-ay2026-unplaced-students-report.txt';
const T3_WORKBOOK = 'AY2026 Term 3 Attendance Latest.xlsx';

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .join(' ');
}

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

async function main() {
  const svc = createServiceClient();

  const { data: years } = await svc
    .from('academic_years')
    .select('id, ay_code')
    .in('ay_code', ['AY2025', 'AY2026']);
  const ayId = new Map((years as any[]).map((y) => [y.ay_code, y.id]));

  const placements = await page<any>(
    svc,
    'section_students',
    'index_number, enrollment_status, students!inner(student_number, last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code), academic_years!inner(ay_code))',
    (q: any) =>
      q.in('sections.academic_year_id', [
        ayId.get('AY2025'),
        ayId.get('AY2026'),
      ])
  );

  const ay25 = new Map<string, any>();
  const ay26 = new Set<string>();
  for (const p of placements) {
    const sn = p.students?.student_number;
    if (!sn) continue;
    if (p.sections.academic_years.ay_code === 'AY2025') ay25.set(sn, p);
    else ay26.add(sn);
  }

  const status = await page<any>(
    svc,
    'ay2026_enrolment_status',
    '"enroleeNumber", "enroleeName", "applicationStatus", "applicationRemarks", "levelApplied"'
  );
  const apps = await page<any>(
    svc,
    'ay2026_enrolment_applications',
    '"enroleeNumber", "studentNumber"'
  );
  const snToEnrolee = new Map<string, string>();
  for (const a of apps)
    if (a.studentNumber) snToEnrolee.set(a.studentNumber, a.enroleeNumber);
  const statusByEnrolee = new Map(status.map((s) => [s.enroleeNumber, s]));

  // who is on the T3 paper register, by name
  const registerNames = new Set<string>();
  for (const s of parseWorkbookT3(T3_WORKBOOK))
    for (const st of s.section.students) registerNames.add(norm(st.fullName));

  const L: string[] = [];
  const say = (s = '') => {
    L.push(s);
    console.log(s);
  };

  say('AY2026 — students with an AY2025 class but no AY2026 class (read-only)');
  say('');
  say(`AY2025 placements: ${ay25.size}`);
  say(`AY2026 placements: ${ay26.size}`);
  say('');

  const buckets = new Map<string, string[]>();
  for (const [sn, p] of ay25) {
    if (ay26.has(sn)) continue;
    const enrolee = snToEnrolee.get(sn);
    const st = enrolee ? statusByEnrolee.get(enrolee) : null;
    const applicationStatus =
      st?.applicationStatus ?? '(no AY2026 application)';
    const name = `${p.students.last_name}, ${p.students.first_name}`;
    const onRegister = registerNames.has(norm(name));
    const line =
      `  ${sn}  ${name.padEnd(36)} was ${p.sections.levels.code} ${p.sections.name} #${p.index_number}` +
      (onRegister ? '   <<< ON THE T3 REGISTER AND ATTENDING' : '');
    buckets.set(applicationStatus, [
      ...(buckets.get(applicationStatus) ?? []),
      line,
    ]);
  }

  let attendingTotal = 0;
  for (const [k, v] of [...buckets].sort((a, b) => b[1].length - a[1].length)) {
    const attending = v.filter((l) => l.includes('ON THE T3 REGISTER')).length;
    attendingTotal += attending;
    say(
      `=== AY2026 application status: ${k} — ${v.length} student(s), ${attending} still on the register ===`
    );
    v.sort().forEach((l) => say(l));
    say('');
  }

  say(
    `SUMMARY: ${attendingTotal} child(ren) have no AY2026 class yet appear on the Term 3 register.`
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
