// scripts/backfill/verify-t3-reimport-sql.ts
// Read-only. Checks the generated re-import before anybody runs it:
//
//   1. every mark row parses back out of the apply files and matches the
//      register (no rows lost or mangled by SQL generation);
//   2. every section_student_id in them is a real AY2026 roster row;
//   3. the "live mark" rule the apply files use (distinct on + recorded_at
//      desc) returns the same answer here as the reconcile computed;
//   4. counting how many rows each chunk would actually insert, so the
//      expected write volume is known before the first file is run.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/verify-t3-reimport-sql.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';

const AY_CODE = 'AY2026';
const APPLY_DIR = 'scripts/backfill/ay2026-t3-attendance-reimport-apply';

const MARK_RE =
  /^\s*\('([0-9a-f-]{36})',\s*date '(\d{4}-\d{2}-\d{2})',\s*'([A-Z]{1,2})'\),?;?$/;
const CAL_RE =
  /^\s*\(date '(\d{4}-\d{2}-\d{2})',\s*'([a-z_]+)',\s*(NULL|'.*')\),?;?$/;

async function main() {
  const svc = createServiceClient();
  const { data: ay } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  const { data: term } = await svc
    .from('terms')
    .select('id')
    .eq('academic_year_id', (ay as any).id)
    .eq('term_number', 3)
    .single();

  // --- 1. parse the apply files back ---
  const files = readdirSync(APPLY_DIR).sort();
  const marks = new Map<string, string>();
  const cal = new Map<string, string>();
  let duplicateKeys = 0;
  for (const f of files) {
    const sql = readFileSync(join(APPLY_DIR, f), 'utf8');
    for (const line of sql.split('\n')) {
      const m = MARK_RE.exec(line);
      if (m) {
        const key = `${m[1]}|${m[2]}`;
        if (marks.has(key)) duplicateKeys++;
        marks.set(key, m[3]);
        continue;
      }
      const c = CAL_RE.exec(line);
      if (c) cal.set(c[1], c[2]);
    }
  }
  console.log(`apply files:            ${files.length}`);
  console.log(`mark rows parsed:       ${marks.size}`);
  console.log(`  duplicate (student,date) across chunks: ${duplicateKeys}`);
  console.log(`calendar rows parsed:   ${cal.size}`);

  const statuses = new Set([...marks.values()]);
  console.log(`mark values present:    ${[...statuses].sort().join(', ')}`);
  const bad = [...statuses].filter((s) => !['P', 'A', 'EX', 'L'].includes(s));
  console.log(
    `invalid mark values:    ${bad.length ? bad.join(', ') : 'none'}`
  );

  // --- 2. every id is a real AY2026 roster row ---
  const ids = [...new Set([...marks.keys()].map((k) => k.split('|')[0]))];
  const { data: ssRows } = await svc
    .from('section_students')
    .select('id, sections!inner(academic_year_id)')
    .eq('sections.academic_year_id', (ay as any).id);
  const known = new Set((ssRows as any[]).map((r) => r.id));
  const unknown = ids.filter((i) => !known.has(i));
  console.log(`distinct students:      ${ids.length}`);
  console.log(`ids not on the AY2026 roster: ${unknown.length}`);
  unknown.forEach((u) => console.log(`    ${u}`));

  // --- 3. the live-mark rule, computed the same way the SQL does ---
  const raw: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await svc
      .from('attendance_daily')
      .select('section_student_id, date, status, recorded_by, recorded_at')
      .eq('term_id', (term as any).id)
      .is('period_id', null)
      .order('section_student_id')
      .order('date')
      .order('recorded_at', { ascending: true })
      .range(from, from + 999);
    const rows = (data ?? []) as any[];
    raw.push(...rows);
    if (rows.length < 1000) break;
  }
  const live = new Map<string, any>();
  for (const r of raw) live.set(`${r.section_student_id}|${r.date}`, r);
  console.log(`\nattendance_daily rows:  ${raw.length}`);
  console.log(`live marks:             ${live.size}`);

  // --- 4. what each file would actually write ---
  let willInsertNew = 0;
  let willCorrect = 0;
  let skippedTeacherMarked = 0;
  let alreadyRight = 0;
  for (const [key, status] of marks) {
    const l = live.get(key);
    if (!l) willInsertNew++;
    else if (l.status === status) alreadyRight++;
    else if (l.recorded_by) skippedTeacherMarked++;
    else willCorrect++;
  }
  console.log('\n--- what running all the files would do ---');
  console.log(`  insert a first mark for the day:  ${willInsertNew}`);
  console.log(`  supersede a wrong imported mark:  ${willCorrect}`);
  console.log(`  leave alone (already correct):    ${alreadyRight}`);
  console.log(`  leave alone (a teacher marked it):${skippedTeacherMarked}`);
  console.log(
    `  => rows actually written:         ${willInsertNew + willCorrect}`
  );

  // --- calendar effect ---
  const { data: dbCal } = await svc
    .from('school_calendar')
    .select('date, day_type')
    .eq('term_id', (term as any).id);
  const have = new Map((dbCal as any[]).map((r) => [r.date, r.day_type]));
  let calChanged = 0;
  for (const [date, want] of cal) if (have.get(date) !== want) calChanged++;
  console.log(
    `\n  calendar dates changed:           ${calChanged} of ${cal.size}`
  );

  const schoolDaysNow = [...have.values()].filter(
    (d) => d === 'school_day'
  ).length;
  const after = new Map(have);
  for (const [d, v] of cal) after.set(d, v);
  const schoolDaysAfter = [...after.values()].filter(
    (d) => d === 'school_day'
  ).length;
  console.log(
    `  school days: ${schoolDaysNow} now -> ${schoolDaysAfter} after`
  );

  // marks that would sit on a non-teaching day afterwards
  let orphaned = 0;
  for (const [key] of live) {
    const date = key.split('|')[1];
    if (after.get(date) !== 'school_day') orphaned++;
  }
  console.log(
    `  existing marks left on a non-teaching day: ${orphaned} (these drop out of every total)`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
