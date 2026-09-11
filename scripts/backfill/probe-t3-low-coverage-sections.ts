// scripts/backfill/probe-t3-low-coverage-sections.ts
// Read-only. The two sections with the lowest T3 register coverage are
// P4 Diligence and S4 Excellence. This checks whether that is explained by
// students who left mid-term (and were never withdrawn in the SIS), rather
// than by teachers failing to fill the register in.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/probe-t3-low-coverage-sections.ts
import { createServiceClient } from '../../lib/supabase/service';

const AY_CODE = 'AY2026';
const SECTIONS: [string, string][] = [
  ['P4', 'Diligence'],
  ['S4', 'Excellence'],
  ['P1', 'Patience'],
  ['P3', 'Courtesy'],
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
    .select('date')
    .eq('term_id', termId)
    .eq('day_type', 'school_day')
    .order('date');
  const days = (cal as any[]).map((r) => r.date);

  const { data: ssRows } = await svc
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, enrollment_date, students(last_name, first_name), sections!inner(name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', (ay as any).id);

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

  for (const [lvl, name] of SECTIONS) {
    const members = (ssRows as any[]).filter(
      (r) => r.sections.levels.code === lvl && r.sections.name === name
    );
    console.log(
      `\n=== ${lvl} ${name} (${members.length} students, ${days.length} school days) ===`
    );
    const rowsOut = members
      .map((r) => {
        const marked = days.filter((d) => live.get(`${r.id}|${d}`)).length;
        const firstIdx = days.findIndex((d) => live.get(`${r.id}|${d}`));
        const lastIdx = days
          .map((d) => !!live.get(`${r.id}|${d}`))
          .lastIndexOf(true);
        return {
          idx: r.index_number,
          name: `${r.students?.last_name}, ${r.students?.first_name}`,
          status: r.enrollment_status,
          marked,
          first: firstIdx >= 0 ? days[firstIdx] : '-',
          last: lastIdx >= 0 ? days[lastIdx] : '-',
        };
      })
      .sort((a, b) => a.marked - b.marked);

    let gapFromLeavers = 0;
    let gapFromBlanks = 0;
    for (const r of rowsOut) {
      const miss = days.length - r.marked;
      // a student whose marks simply stop and never resume reads as a leaver
      const stoppedEarly = r.last !== '-' && r.last < days[days.length - 1];
      const flag =
        r.marked === 0 ? 'NEVER MARKED' : stoppedEarly ? 'stops early' : '';
      if (miss > 0) {
        if (stoppedEarly || r.marked === 0) gapFromLeavers += miss;
        else gapFromBlanks += miss;
      }
      if (miss > 2)
        console.log(
          `  #${String(r.idx).padStart(2)} ${r.name.padEnd(34)} ${String(r.marked).padStart(2)}/${days.length}  ${r.first} .. ${r.last}  ${r.status !== 'active' ? `[${r.status}] ` : ''}${flag}`
        );
    }
    const totalGap =
      members.length * days.length -
      members.reduce(
        (a, r) => a + days.filter((d) => live.get(`${r.id}|${d}`)).length,
        0
      );
    console.log(
      `  -> missing cells: ${totalGap}   from students who stop early/never appear: ${gapFromLeavers}   from scattered blanks: ${gapFromBlanks}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
