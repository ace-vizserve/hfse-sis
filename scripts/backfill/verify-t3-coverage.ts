// scripts/backfill/verify-t3-coverage.ts
// Read-only. After the T3 re-import, checks coverage per date and per section:
// which school days the register left blank, and for whom.
//
// Context: `recompute_attendance_rollup` defines a student's "school days" as
// the days that student actually has a mark for — not the calendar's school-day
// count — so a blank cell in the register quietly shrinks that child's
// denominator instead of counting as an absence. Worth seeing where the blanks
// are before Term 3 figures are used for anything.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/verify-t3-coverage.ts
import { createServiceClient } from '../../lib/supabase/service';

const AY_CODE = 'AY2026';

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
  const termId = (term as any).id;

  const { data: cal } = await svc
    .from('school_calendar')
    .select('date, day_type, label')
    .eq('term_id', termId)
    .eq('day_type', 'school_day')
    .order('date');
  const schoolDays = (cal as any[]).map((r) => r.date);

  const { data: ssRows } = await svc
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, enrollment_date, students(last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);
  const roster = new Map(
    (ssRows as any[]).map((r) => [
      r.id,
      {
        sec: `${r.sections.levels.code} ${r.sections.name}`,
        idx: r.index_number,
        name: `${r.students?.last_name}, ${r.students?.first_name}`,
        status: r.enrollment_status,
        enrolled: r.enrollment_date,
      },
    ])
  );

  const raw: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await svc
      .from('attendance_daily')
      .select('section_student_id, date, status, recorded_at')
      .eq('term_id', termId)
      .is('period_id', null)
      .order('section_student_id')
      .order('date')
      .order('recorded_at', { ascending: true })
      .range(from, from + 999);
    const rows = (data ?? []) as any[];
    raw.push(...rows);
    if (rows.length < 1000) break;
  }
  const live = new Map<string, string | null>();
  for (const r of raw) live.set(`${r.section_student_id}|${r.date}`, r.status);

  // --- per-date coverage ---
  const perDate = new Map<string, number>();
  for (const [k, v] of live) {
    if (v === null) continue;
    const d = k.split('|')[1];
    perDate.set(d, (perDate.get(d) ?? 0) + 1);
  }
  console.log('=== marks recorded per school day ===');
  const empty: string[] = [];
  for (const d of schoolDays) {
    const n = perDate.get(d) ?? 0;
    const bar = '#'.repeat(Math.round(n / 10));
    console.log(`  ${d}  ${String(n).padStart(4)}  ${bar}`);
    if (n === 0) empty.push(d);
  }
  console.log('');
  if (empty.length) {
    console.log(
      `!! ${empty.length} school day(s) with NO marks at all: ${empty.join(', ')}\n`
    );
  }

  // --- per-section coverage on the newly imported stretch ---
  console.log('=== coverage per section ===');
  const bySec = new Map<string, { students: Set<string>; marks: number }>();
  for (const [id, r] of roster) {
    const e = bySec.get(r.sec) ?? { students: new Set<string>(), marks: 0 };
    e.students.add(id);
    bySec.set(r.sec, e);
  }
  for (const [k, v] of live) {
    if (v === null) continue;
    const r = roster.get(k.split('|')[0]);
    if (!r) continue;
    bySec.get(r.sec)!.marks++;
  }
  for (const [sec, e] of [...bySec].sort()) {
    const expected = e.students.size * schoolDays.length;
    const pct = expected ? ((e.marks / expected) * 100).toFixed(0) : '-';
    console.log(
      `  ${sec.padEnd(22)} ${String(e.students.size).padStart(3)} students  ${String(e.marks).padStart(5)} / ${String(expected).padStart(5)} cells  ${pct}%`
    );
  }
  console.log('');

  // --- students with noticeably thin coverage who are not late enrollees ---
  console.log('=== active students missing more than 5 school days ===');
  const thin: string[] = [];
  for (const [id, r] of roster) {
    if (r.status !== 'active') continue;
    let have = 0;
    for (const d of schoolDays) if (live.get(`${id}|${d}`)) have++;
    const miss = schoolDays.length - have;
    if (miss > 5)
      thin.push(
        `  ${r.sec} #${r.idx} ${r.name}: ${have}/${schoolDays.length} days marked (${miss} blank)`
      );
  }
  thin.sort();
  if (thin.length === 0) console.log('  none');
  thin.forEach((t) => console.log(t));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
