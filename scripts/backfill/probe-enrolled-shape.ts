// scripts/backfill/probe-enrolled-shape.ts
// Read-only. Shows what a normally-enrolled S4 Excellence child looks like on
// both sides — the admissions status row and the Records placement — so a
// forced enrolment writes the same shape and nothing more.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/probe-enrolled-shape.ts
import { createServiceClient } from '../../lib/supabase/service';

const AY_CODE = 'AY2026';

async function main() {
  const svc = createServiceClient();
  const { data: ay } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();

  console.log('=== Records: enrollment_date / status on S4 Excellence ===');
  const { data: ss } = await svc
    .from('section_students')
    .select(
      'index_number, enrollment_status, enrollment_date, withdrawal_date, students!inner(student_number, last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id)
    .eq('sections.name', 'Excellence')
    .eq('sections.levels.code', 'S4')
    .order('index_number');
  const rows = (ss ?? []) as any[];
  const byStatus = new Map<string, number>();
  const byDate = new Map<string, number>();
  for (const r of rows) {
    byStatus.set(
      r.enrollment_status,
      (byStatus.get(r.enrollment_status) ?? 0) + 1
    );
    const k = r.enrollment_date ?? '(null)';
    byDate.set(k, (byDate.get(k) ?? 0) + 1);
  }
  console.log(
    `  enrollment_status: ${[...byStatus].map(([k, v]) => `${k}=${v}`).join('  ')}`
  );
  console.log(
    `  enrollment_date:   ${[...byDate].map(([k, v]) => `${k}=${v}`).join('  ')}`
  );
  console.log(
    `  highest index: ${Math.max(...rows.map((r) => r.index_number))}`
  );

  console.log(
    '\n=== Admissions: a normally-enrolled S4 child, full status row ==='
  );
  const { data: sample } = await svc
    .from('ay2026_enrolment_status')
    .select('*')
    .eq('applicationStatus', 'Enrolled')
    .eq('classSection', 'Excellence')
    .limit(1)
    .single();
  const s = sample as any;
  for (const [k, v] of Object.entries(s)) {
    if (v === null || v === '') continue;
    const shown =
      typeof v === 'string' && v.length > 70 ? v.slice(0, 70) + '…' : v;
    console.log(`  ${k.padEnd(26)} ${shown}`);
  }
  console.log(
    '\n  (fields above are the non-empty ones; everything else is null)'
  );

  console.log('\n=== Cacao today ===');
  const { data: c } = await svc
    .from('ay2026_enrolment_status')
    .select('*')
    .eq('enroleeNumber', 'E260309')
    .single();
  for (const [k, v] of Object.entries(c as any)) {
    if (v === null || v === '') continue;
    const shown =
      typeof v === 'string' && v.length > 70 ? v.slice(0, 70) + '…' : v;
    console.log(`  ${k.padEnd(26)} ${shown}`);
  }

  console.log('\n=== distinct classStatus values among enrolled children ===');
  const { data: cs } = await svc
    .from('ay2026_enrolment_status')
    .select('"classStatus"')
    .eq('applicationStatus', 'Enrolled');
  const vals = new Map<string, number>();
  for (const r of (cs ?? []) as any[])
    vals.set(
      r.classStatus ?? '(null)',
      (vals.get(r.classStatus ?? '(null)') ?? 0) + 1
    );
  for (const [k, v] of [...vals].sort((a, b) => b[1] - a[1]))
    console.log(`  ${k}: ${v}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
