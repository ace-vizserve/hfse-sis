// scripts/backfill/probe-t3-sparse-days.ts
// Read-only. The day classifier calls a date a teaching day if ANY student in
// ANY section has a mark on it. A handful of stray cells on a weekend is
// therefore enough to flip the whole day. This lists every school day with
// thin coverage, its weekday, and exactly who is marked on it.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/probe-t3-sparse-days.ts
import { createServiceClient } from '../../lib/supabase/service';

const AY_CODE = 'AY2026';
const THIN = 100; // fewer marks than this on a school day is worth a look

const DOW = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

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

  const { data: ssRows } = await svc
    .from('section_students')
    .select(
      'id, index_number, students(last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);
  const roster = new Map(
    (ssRows as any[]).map((r) => [
      r.id,
      `${r.sections.levels.code} ${r.sections.name} #${r.index_number} ${r.students?.last_name}, ${r.students?.first_name}`,
    ])
  );

  const raw: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await svc
      .from('attendance_daily')
      .select('section_student_id, date, status, recorded_by, recorded_at')
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
  const live = new Map<string, any>();
  for (const r of raw) live.set(`${r.section_student_id}|${r.date}`, r);

  const byDate = new Map<string, any[]>();
  for (const [k, r] of live) {
    if (r.status === null) continue;
    const d = k.split('|')[1];
    byDate.set(d, [...(byDate.get(d) ?? []), { ...r, id: k.split('|')[0] }]);
  }

  for (const c of cal as any[]) {
    const rows = byDate.get(c.date) ?? [];
    if (rows.length >= THIN) continue;
    const dow = DOW[new Date(`${c.date}T00:00:00Z`).getUTCDay()];
    console.log(
      `\n${c.date} (${dow}) — ${rows.length} marks${c.label ? ` — "${c.label}"` : ''}`
    );
    const bySec = new Map<string, string[]>();
    for (const r of rows) {
      const disp = roster.get(r.id) ?? r.id;
      const sec = disp.split('#')[0].trim();
      bySec.set(sec, [
        ...(bySec.get(sec) ?? []),
        `${disp.split('#')[1]} = ${r.status}${r.recorded_by ? ' (marked in-system)' : ''}`,
      ]);
    }
    for (const [sec, list] of [...bySec].sort()) {
      console.log(`    ${sec}: ${list.length} marked`);
      console.log(
        `        ${list.slice(0, 8).join('; ')}${list.length > 8 ? ' …' : ''}`
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
