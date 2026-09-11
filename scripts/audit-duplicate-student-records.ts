// scripts/audit-duplicate-student-records.ts
// Read-only. `studentNumber` is the only stable student ID (Hard Rule #4) and
// is what links a child across academic years. If the same child was created
// again with a NEW studentNumber for AY2026, that link is broken: last year's
// grades, attendance and files no longer belong to the same person, and the
// child reads as "left" in AY2025 and "new" in AY2026.
//
// This looks for exactly that: children who appear in both AY2025 and AY2026
// under DIFFERENT student numbers, matched on name.
//
// Run: npx tsx --env-file=.env.local scripts/audit-duplicate-student-records.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../lib/supabase/service';

const OUT = 'scripts/audit-duplicate-student-records-report.txt';

function key(last: string, first: string): string {
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
    .order('ay_code');
  const ayById = new Map((years as any[]).map((y) => [y.id, y.ay_code]));

  const placements = await page<any>(
    svc,
    'section_students',
    'index_number, enrollment_status, students!inner(id, student_number, last_name, first_name, middle_name), sections!inner(name, academic_year_id, levels!inner(code))'
  );

  // name -> { ay_code -> [placement] }
  const byName = new Map<string, Map<string, any[]>>();
  for (const p of placements) {
    const ay = ayById.get(p.sections.academic_year_id);
    if (!ay) continue;
    const k = key(p.students.last_name, p.students.first_name);
    const m = byName.get(k) ?? new Map<string, any[]>();
    m.set(ay, [...(m.get(ay) ?? []), p]);
    byName.set(k, m);
  }

  const L: string[] = [];
  const say = (s = '') => {
    L.push(s);
    console.log(s);
  };

  say('Duplicate student records across academic years (read-only)');
  say(
    'The same child under two different student numbers breaks cross-year linking.'
  );
  say('');
  const perAy = new Map<string, number>();
  for (const p of placements) {
    const ay = ayById.get(p.sections.academic_year_id) ?? '?';
    perAy.set(ay, (perAy.get(ay) ?? 0) + 1);
  }
  say('placements per academic year:');
  for (const [k, v] of [...perAy].sort()) say(`  ${k}: ${v}`);
  say('');

  const dupes: string[] = [];
  const cleanCarryOver: string[] = [];
  for (const [k, byAy] of byName) {
    const numbers = new Set<string>();
    for (const [, list] of byAy)
      for (const p of list) numbers.add(p.students.student_number);
    if (byAy.size < 2) continue;
    if (numbers.size === 1) {
      cleanCarryOver.push(k);
      continue;
    }
    const [last, first] = k.split('|');
    const detail = [...byAy]
      .sort()
      .map(
        ([ay, list]) =>
          `${ay}: ${list.map((p) => `${p.sections.levels.code} ${p.sections.name} #${p.index_number} (${p.students.student_number}${p.enrollment_status !== 'active' ? `, ${p.enrollment_status}` : ''})`).join(' + ')}`
      )
      .join('    ');
    dupes.push(`  ${last}, ${first}\n      ${detail}`);
  }

  say(
    `children appearing in more than one year: ${cleanCarryOver.length + dupes.length}`
  );
  say(`  linked correctly (one student number):  ${cleanCarryOver.length}`);
  say(`  SPLIT ACROSS TWO NUMBERS:               ${dupes.length}`);
  say('');
  say('=== split records ===');
  if (dupes.length === 0) say('  none');
  dupes.sort().forEach((d) => say(d));

  // same student number used twice in one year
  say('');
  say('=== same student number placed twice in one academic year ===');
  const perAyNumber = new Map<string, any[]>();
  for (const p of placements) {
    const ay = ayById.get(p.sections.academic_year_id);
    const k = `${ay}|${p.students.student_number}`;
    perAyNumber.set(k, [...(perAyNumber.get(k) ?? []), p]);
  }
  let multi = 0;
  for (const [k, list] of perAyNumber) {
    if (list.length < 2) continue;
    multi++;
    say(
      `  ${k}  "${list[0].students.last_name}, ${list[0].students.first_name}" -> ${list.map((p) => `${p.sections.levels.code} ${p.sections.name} #${p.index_number}`).join(', ')}`
    );
  }
  if (multi === 0) say('  none');

  writeFileSync(OUT, L.join('\n') + '\n');
  console.log(`\nWrote ${OUT}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
