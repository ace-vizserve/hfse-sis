// scripts/audit-student-number-hygiene.ts
// Read-only. Two follow-ups to the split-record audit:
//
//   1. How many student_number values are not clean strings — leading or
//      trailing whitespace, inner spaces, lowercase. One split record
//      (Pangilinan, Rafael Noah) is literally the same number with a trailing
//      space, which means the column is not normalised anywhere.
//   2. For each child split across two numbers, how much AY2025 history is
//      stranded on the old number: grades, attendance and documents that no
//      longer belong to the record the school now uses.
//
// Run: npx tsx --env-file=.env.local scripts/audit-student-number-hygiene.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../lib/supabase/service';

const OUT = 'scripts/audit-student-number-hygiene-report.txt';

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
  const L: string[] = [];
  const say = (s = '') => {
    L.push(s);
    console.log(s);
  };

  // --- 1. hygiene ---
  const students = await page<any>(
    svc,
    'students',
    'id, student_number, last_name, first_name'
  );
  say('Student number hygiene (read-only)');
  say('');
  say(`student records: ${students.length}`);

  const dirty = students.filter(
    (s) => s.student_number && s.student_number !== s.student_number.trim()
  );
  const lower = students.filter(
    (s) => s.student_number && /[a-z]/.test(s.student_number)
  );
  const innerSpace = students.filter(
    (s) => s.student_number && /\s/.test(s.student_number.trim())
  );
  say(`  with leading/trailing whitespace: ${dirty.length}`);
  dirty.forEach((s) =>
    say(`    "${s.student_number}"  ${s.last_name}, ${s.first_name}`)
  );
  say(`  containing a lowercase letter:    ${lower.length}`);
  lower.forEach((s) =>
    say(`    "${s.student_number}"  ${s.last_name}, ${s.first_name}`)
  );
  say(`  with an inner space:              ${innerSpace.length}`);
  innerSpace.forEach((s) =>
    say(`    "${s.student_number}"  ${s.last_name}, ${s.first_name}`)
  );

  // numbers that collide once trimmed/uppercased
  const norm = new Map<string, any[]>();
  for (const s of students) {
    if (!s.student_number) continue;
    const k = s.student_number.trim().toUpperCase();
    norm.set(k, [...(norm.get(k) ?? []), s]);
  }
  const collisions = [...norm].filter(([, v]) => v.length > 1);
  say(`  numbers that collide once tidied: ${collisions.length}`);
  for (const [k, v] of collisions)
    say(
      `    ${k} -> ${v.map((s) => `"${s.student_number}" (${s.last_name}, ${s.first_name})`).join('  +  ')}`
    );
  say('');

  // --- 2. stranded history ---
  const { data: years } = await svc
    .from('academic_years')
    .select('id, ay_code');
  const ayById = new Map((years as any[]).map((y) => [y.id, y.ay_code]));

  const placements = await page<any>(
    svc,
    'section_students',
    'id, index_number, students!inner(id, student_number, last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
  );
  const byName = new Map<string, Map<string, any[]>>();
  for (const p of placements) {
    const ay = ayById.get(p.sections.academic_year_id);
    if (!ay) continue;
    const k = nameKey(p.students.last_name, p.students.first_name);
    const m = byName.get(k) ?? new Map<string, any[]>();
    m.set(ay, [...(m.get(ay) ?? []), p]);
    byName.set(k, m);
  }

  const split: { name: string; old: any; recent: any }[] = [];
  for (const [k, byAy] of byName) {
    if (!byAy.has('AY2025') || !byAy.has('AY2026')) continue;
    const a = byAy.get('AY2025')![0];
    const b = byAy.get('AY2026')![0];
    if (
      a.students.student_number.trim().toUpperCase() ===
      b.students.student_number.trim().toUpperCase()
    )
      continue;
    split.push({ name: k.replace('|', ', '), old: a, recent: b });
  }

  say(
    `=== history stranded on the AY2025 record (${split.length} children) ===`
  );
  say('');
  let totGrades = 0;
  let totAtt = 0;
  for (const s of split.sort((x, y) => x.name.localeCompare(y.name))) {
    const { count: grades } = await svc
      .from('grade_entries')
      .select('*', { count: 'exact', head: true })
      .eq('section_student_id', s.old.id);
    const { count: att } = await svc
      .from('attendance_daily')
      .select('*', { count: 'exact', head: true })
      .eq('section_student_id', s.old.id);
    totGrades += grades ?? 0;
    totAtt += att ?? 0;
    say(
      `  ${s.name.padEnd(36)} ${s.old.students.student_number.padEnd(9)} -> ${s.recent.students.student_number}`
    );
    say(
      `      AY2025 ${s.old.sections.levels.code} ${s.old.sections.name}: ${grades} grade entries, ${att} attendance marks — not linked to the AY2026 record`
    );
  }
  say('');
  say(
    `  TOTAL stranded: ${totGrades} grade entries and ${totAtt} attendance marks across ${split.length} children.`
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
