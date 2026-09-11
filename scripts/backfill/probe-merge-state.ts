// scripts/backfill/probe-merge-state.ts
// Read-only. The merge run aborted partway with an unhelpful error. This shows
// exactly how far it got and what the failing table actually complains about,
// so the state is known before anything else is attempted.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/probe-merge-state.ts
import { createServiceClient } from '../../lib/supabase/service';

const TABLES = [
  'section_students',
  'report_card_comments',
  'evaluation_writeups',
  'evaluation_subject_comments',
  'evaluation_checklist_responses',
  'evaluation_ptc_feedback',
  'student_discipline_records',
  'student_declarations',
];

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

async function main() {
  const svc = createServiceClient();

  console.log('=== can the service client touch each table at all? ===');
  for (const t of TABLES) {
    const { count, error } = await svc
      .from(t)
      .select('*', { count: 'exact', head: true });
    console.log(
      `  ${t.padEnd(34)} ${error ? `ERROR ${error.code ?? ''} ${error.message ?? JSON.stringify(error)}` : `${count} rows`}`
    );
  }

  console.log('\n=== does report_card_comments have student_id? ===');
  const { data: rcc, error: rccErr } = await svc
    .from('report_card_comments')
    .select('*')
    .limit(1);
  if (rccErr) console.log('  error:', JSON.stringify(rccErr));
  else
    console.log(
      '  columns:',
      Object.keys((rcc as any[])[0] ?? {}).join(', ') || '(no rows)'
    );

  console.log('\n=== how far did the merge get? ===');
  const { data: years } = await svc
    .from('academic_years')
    .select('id, ay_code');
  const ayById = new Map((years as any[]).map((y) => [y.id, y.ay_code]));

  const placements: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await svc
      .from('section_students')
      .select(
        'id, index_number, students!inner(id, student_number, last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
      )
      .range(from, from + 999);
    const rows = (data ?? []) as any[];
    placements.push(...rows);
    if (rows.length < 1000) break;
  }

  const byName = new Map<string, Map<string, any[]>>();
  for (const p of placements) {
    const ay = ayById.get(p.sections.academic_year_id);
    if (!ay) continue;
    const k = nameKey(p.students.last_name, p.students.first_name);
    const m = byName.get(k) ?? new Map<string, any[]>();
    m.set(ay, [...(m.get(ay) ?? []), p]);
    byName.set(k, m);
  }

  let merged = 0;
  const remaining: string[] = [];
  for (const [k, byAy] of byName) {
    const a = byAy.get('AY2025')?.[0];
    const b = byAy.get('AY2026')?.[0];
    if (!a || !b) continue;
    if (a.students.id === b.students.id) {
      merged++;
      continue;
    }
    remaining.push(
      `    ${k.split('|').reverse().join(' ').trim().padEnd(34)} ${a.students.student_number} + ${b.students.student_number}`
    );
  }
  console.log(`  children now under ONE record across both years: ${merged}`);
  console.log(
    `  still split:                                     ${remaining.length}`
  );
  remaining.sort().forEach((r) => console.log(r));

  console.log('\n=== orphaned student rows (no placement anywhere) ===');
  const placedIds = new Set(placements.map((p) => p.students.id));
  const allStudents: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await svc
      .from('students')
      .select('id, student_number, last_name, first_name')
      .range(from, from + 999);
    const rows = (data ?? []) as any[];
    allStudents.push(...rows);
    if (rows.length < 1000) break;
  }
  const orphans = allStudents.filter((s) => !placedIds.has(s.id));
  console.log(
    `  ${orphans.length} student record(s) hold no placement in any year`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
