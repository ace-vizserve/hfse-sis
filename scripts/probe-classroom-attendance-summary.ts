// scripts/probe-classroom-attendance-summary.ts
//
// Why does the classroom Attendance tab say "School days: 6"?
//
// STRICTLY READ-ONLY. Every statement is a SELECT.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-classroom-attendance-summary.ts --section "Respect"
import { createServiceClient } from '../lib/supabase/service';
import {
  isEncodableDayType,
  type Audience,
  type DayType,
} from '../lib/schemas/attendance';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const svc = createServiceClient();
  const sectionName = arg('section') ?? 'Respect';

  const { data: sections } = await svc
    .from('sections')
    .select('id, name, academic_year_id, level_id')
    .ilike('name', `%${sectionName}%`);
  console.log('sections matched:', JSON.stringify(sections, null, 2));
  if (!sections?.length) return;

  for (const section of sections) {
    const { data: ay } = await svc
      .from('academic_years')
      .select('id, ay_code')
      .eq('id', section.academic_year_id)
      .maybeSingle();
    console.log(
      `\n=== ${section.name} · AY ${ay?.ay_code ?? '?'} (${section.id})`
    );

    const { data: terms } = await svc
      .from('terms')
      .select('id, label, term_number, start_date, end_date')
      .eq('academic_year_id', section.academic_year_id)
      .order('term_number');

    const { data: enrolments } = await svc
      .from('section_students')
      .select('id, index_number, enrollment_status, enrollment_date')
      .eq('section_id', section.id);
    console.log(`roster: ${enrolments?.length ?? 0}`);
    for (const e of enrolments ?? [])
      console.log(
        `   ${e.index_number} · ${e.enrollment_status} · enrolled ${e.enrollment_date ?? 'NULL'}`
      );

    const ids = (enrolments ?? []).map((e) => e.id as string);

    for (const t of terms ?? []) {
      const { data: cal } = await svc
        .from('school_calendar')
        .select('date, day_type, audience, hbl_overlay')
        .eq('term_id', t.id);
      type CalRow = {
        date: string;
        day_type: DayType;
        audience: Audience;
        hbl_overlay: boolean | null;
      };
      const byDate = new Map<string, CalRow>();
      for (const r of (cal ?? []) as CalRow[]) {
        const prev = byDate.get(r.date as string);
        if (!prev || (prev.audience === 'all' && r.audience !== 'all'))
          byDate.set(r.date as string, r);
      }
      const encodable = [...byDate.values()].filter((r) =>
        isEncodableDayType(r.day_type, r.hbl_overlay ?? false)
      ).length;

      const { data: rollups } = await svc
        .from('attendance_records')
        .select(
          'section_student_id, school_days, days_present, days_late, days_excused, days_absent, attendance_pct'
        )
        .eq('term_id', t.id)
        .in(
          'section_student_id',
          ids.length ? ids : ['00000000-0000-0000-0000-000000000000']
        );

      const { data: marks } = await svc
        .from('attendance_daily')
        .select('date, status, section_student_id')
        .eq('term_id', t.id)
        .in(
          'section_student_id',
          ids.length ? ids : ['00000000-0000-0000-0000-000000000000']
        );
      const markedDates = new Set((marks ?? []).map((m) => m.date as string));

      console.log(
        `\n--- ${t.label} (T${t.term_number}) ${t.start_date} → ${t.end_date}` +
          `\n    calendar rows: ${cal?.length ?? 0}, deduped dates: ${byDate.size}, ENCODABLE school days: ${encodable}` +
          `\n    distinct dates with any mark: ${markedDates.size}`
      );
      for (const r of rollups ?? [])
        console.log(
          `      rollup ${r.section_student_id.slice(0, 8)} · school_days=${r.school_days} P+L+EX=${r.days_present} L=${r.days_late} EX=${r.days_excused} A=${r.days_absent} pct=${r.attendance_pct}`
        );
      if ((rollups?.length ?? 0) > 0) {
        const max = Math.max(...(rollups ?? []).map((r) => r.school_days ?? 0));
        const sum = (rollups ?? []).reduce(
          (a, r) => a + (r.school_days ?? 0),
          0
        );
        console.log(
          `      => card shows schoolDays = MAX = ${max};  sum of student-days = ${sum};  ideal = ${encodable} × ${enrolments?.length ?? 0} = ${encodable * (enrolments?.length ?? 0)}`
        );
      }
    }
  }
}

main().catch((e) => {
  console.error('probe failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
