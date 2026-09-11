// scripts/backfill/probe-t3-final-state.ts
// Read-only. Close-out check on everything this round touched: the nine
// mid-year withdrawals, the duplicate-record merge, Akter's import, and the
// student rows the merge left behind.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/probe-t3-final-state.ts
import { createServiceClient } from '../../lib/supabase/service';

const AY_CODE = 'AY2026';

const LEAVERS = [
  'Brown, James',
  'Cam, Isaac Lucas',
  'Tun, Aung Chan Myae',
  'Lagman, Julian Caleb',
  'Kalingo, Crisanto Omar',
  'Brown, Charles',
  'Calina, Xander Grae',
  'Gandol, Ethan Jacob',
  'Tolosa, Priam Rai',
];

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

async function main() {
  const svc = createServiceClient();
  const { data: ay } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();

  const { data: ssRows } = await svc
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, withdrawal_date, students!inner(student_number, last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);

  const roster = (ssRows as any[]).map((r) => ({
    idx: r.index_number,
    status: r.enrollment_status,
    withdrawn: r.withdrawal_date,
    name: `${r.students.last_name}, ${r.students.first_name}`,
    number: r.students.student_number,
    sec: `${r.sections.levels.code} ${r.sections.name}`,
  }));

  console.log('=== the nine mid-year leavers ===');
  let done = 0;
  for (const n of LEAVERS) {
    const r = roster.find((x) => norm(x.name) === norm(n));
    if (!r) {
      console.log(`  ${n}: NOT FOUND`);
      continue;
    }
    if (r.status === 'withdrawn') done++;
    console.log(
      `  ${r.sec.padEnd(16)} #${String(r.idx).padStart(2)} ${r.name.padEnd(26)} ${r.status}${r.withdrawn ? `  withdrawn ${r.withdrawn}` : ''}`
    );
  }
  console.log(`  -> ${done} of ${LEAVERS.length} withdrawn\n`);

  console.log('=== Akter ===');
  for (const r of roster.filter((x) => norm(x.name).includes('AKTER')))
    console.log(`  ${r.sec} #${r.idx} "${r.name}" (${r.number}) ${r.status}`);

  console.log('\n=== student records with no placement in any year ===');
  const placed = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await svc
      .from('section_students')
      .select('student_id')
      .range(from, from + 999);
    const rows = (data ?? []) as any[];
    rows.forEach((r) => placed.add(r.student_id));
    if (rows.length < 1000) break;
  }
  const all: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await svc
      .from('students')
      .select('id, student_number, last_name, first_name, created_at')
      .range(from, from + 999);
    const rows = (data ?? []) as any[];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  const orphans = all.filter((s) => !placed.has(s.id));
  console.log(
    `  ${orphans.length} of ${all.length} student records hold no placement`
  );
  console.log(
    '  (these are applicants who never enrolled and past leavers, plus the 37 the merge emptied)'
  );

  console.log('\n=== student numbers still untidy ===');
  const dirty = all.filter(
    (s) => s.student_number && s.student_number !== s.student_number.trim()
  );
  console.log(`  ${dirty.length} with leading/trailing whitespace`);
  dirty.forEach((s) =>
    console.log(`    "${s.student_number}"  ${s.last_name}, ${s.first_name}`)
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
