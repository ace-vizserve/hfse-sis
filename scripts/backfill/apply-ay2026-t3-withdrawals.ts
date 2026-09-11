// scripts/backfill/apply-ay2026-t3-withdrawals.ts
// Marks the children who stopped attending mid-year as withdrawn. Re-derives
// every date from live data rather than trusting a generated file.
//
// Hard Rule #6: nothing is deleted. A withdrawn child stays on the section
// roster with enrollment_status='withdrawn', keeps every mark already
// recorded, and keeps their index number (KD #136 — retired, never reused).
//
// The withdrawal date is the last day the register actually marks them, except
// where Admissions recorded a real date in its remarks — that wins, being the
// school's own record rather than an inference from a blank cell.
//
//   dry run (default):  npx tsx --env-file=.env.local scripts/backfill/apply-ay2026-t3-withdrawals.ts
//   for real:           npx tsx --env-file=.env.local scripts/backfill/apply-ay2026-t3-withdrawals.ts --apply
import { createServiceClient } from '../../lib/supabase/service';

const AY_CODE = 'AY2026';
const APPLY = process.argv.includes('--apply');

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

// "Relocating to the Phils. Withdrawal Approval: 22 June 2026.
//  Last Day of Attendance: 31 July 2026"
const DOCUMENTED_LAST_DAY: Record<string, string> = {
  'Lagman, Julian Caleb': '2026-07-31',
};

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

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: ssRows, error: ssErr } = await svc
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, withdrawal_date, students!inner(student_number, last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);
  if (ssErr) throw ssErr;

  const roster = (ssRows as any[]).map((r) => ({
    id: r.id,
    idx: r.index_number,
    status: r.enrollment_status,
    withdrawn: r.withdrawal_date,
    number: r.students.student_number,
    name: `${r.students.last_name}, ${r.students.first_name}`,
    sec: `${r.sections.levels.code} ${r.sections.name}`,
  }));

  const plan: {
    row: (typeof roster)[number];
    date: string;
    source: string;
    lastMark: string | null;
  }[] = [];
  const skipped: string[] = [];

  for (const name of LEAVERS) {
    const hits = roster.filter((r) => norm(r.name) === norm(name));
    if (hits.length !== 1) {
      skipped.push(`  "${name}": matched ${hits.length} roster rows`);
      continue;
    }
    const row = hits[0];
    if (row.status === 'withdrawn') {
      skipped.push(
        `  "${name}": already withdrawn${row.withdrawn ? ` on ${row.withdrawn}` : ''}`
      );
      continue;
    }

    const { data: marks, error: mErr } = await svc
      .from('attendance_daily')
      .select('date')
      .eq('section_student_id', row.id)
      .is('period_id', null)
      .not('status', 'is', null)
      .order('date', { ascending: false })
      .limit(1);
    if (mErr) throw mErr;
    const lastMark = (marks as any[])?.[0]?.date ?? null;

    const documented = DOCUMENTED_LAST_DAY[name];
    if (!documented && !lastMark) {
      skipped.push(`  "${name}": no attendance and no documented date`);
      continue;
    }
    plan.push({
      row,
      date: documented ?? lastMark!,
      source: documented
        ? 'admissions remarks'
        : 'last day the register marks them',
      lastMark,
    });
  }

  console.log(
    `${APPLY ? 'APPLYING' : 'DRY RUN'} — ${plan.length} child(ren) to withdraw\n`
  );
  for (const p of plan)
    console.log(
      `  ${p.row.sec.padEnd(16)} #${String(p.row.idx).padStart(2)} ${p.row.name.padEnd(26)} ${p.date}  (${p.source})${p.lastMark && p.lastMark !== p.date ? `  [register's last mark ${p.lastMark}]` : ''}`
    );
  if (skipped.length) {
    console.log('\nskipped:');
    skipped.forEach((s) => console.log(s));
  }

  if (plan.length === 0) {
    console.log('\nnothing to do');
    return;
  }
  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write.');
    return;
  }

  console.log('');
  for (const p of plan) {
    const { data, error } = await svc
      .from('section_students')
      .update({ enrollment_status: 'withdrawn', withdrawal_date: p.date })
      .eq('id', p.row.id)
      .neq('enrollment_status', 'withdrawn')
      .select('id');
    if (error)
      throw new Error(
        `${p.row.name}: ${error.message ?? JSON.stringify(error)}`
      );
    console.log(
      `  withdrew ${p.row.name} (${p.row.number}) — ${(data ?? []).length} row(s)`
    );
  }

  // --- verify ---
  console.log('\nverifying...');
  const { data: after, error: aErr } = await svc
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, withdrawal_date, students!inner(last_name, first_name), sections!inner(name, levels!inner(code))'
    )
    .in(
      'id',
      plan.map((p) => p.row.id)
    );
  if (aErr) throw aErr;

  let ok = 0;
  for (const r of after as any[]) {
    const want = plan.find((p) => p.row.id === r.id)!;
    const good =
      r.enrollment_status === 'withdrawn' && r.withdrawal_date === want.date;
    if (good) ok++;
    console.log(
      `  ${good ? 'ok  ' : '!!  '}${r.sections.levels.code} ${r.sections.name} #${r.index_number} ${r.students.last_name}, ${r.students.first_name}: ${r.enrollment_status}, ${r.withdrawal_date}`
    );
  }
  console.log(`  ${ok} of ${plan.length} correct`);

  // their attendance must be untouched
  console.log('\nconfirming no attendance was lost...');
  for (const p of plan) {
    const { count, error } = await svc
      .from('attendance_daily')
      .select('*', { count: 'exact', head: true })
      .eq('section_student_id', p.row.id);
    if (error) throw error;
    console.log(
      `  ${p.row.name.padEnd(26)} ${count} attendance row(s) still present`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
