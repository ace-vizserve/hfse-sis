// scripts/probe-classroom-attendance-summary-after.ts
//
// What the rebuilt summary card will actually say, run against production.
//
// STRICTLY READ-ONLY. Every statement is a SELECT.
//
// ⚠ It re-does the FETCHING that `getSectionAttendanceSummary` does, rather
// than calling it: that function's import graph reaches `server-only`, which
// throws under tsx. The ARITHMETIC is the real thing — the same pure
// `computeSectionAttendanceSummary` the app calls, imported directly.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-classroom-attendance-summary-after.ts
import {
  computeSectionAttendanceSummary,
  type SummaryEnrolmentInput,
  type SummaryRollupInput,
} from '../lib/attendance/section-summary';
import {
  isEncodableDayType,
  type Audience,
  type DayType,
} from '../lib/schemas/attendance';
import { createServiceClient } from '../lib/supabase/service';

type CalRow = {
  date: string;
  day_type: DayType;
  audience: Audience;
  hbl_overlay: boolean | null;
};

const svc = createServiceClient();

async function encodableDates(
  termId: string,
  levelType: 'primary' | 'secondary' | null
): Promise<string[]> {
  const audiences = levelType ? ['all', levelType] : ['all'];
  const { data } = await svc
    .from('school_calendar')
    .select('date, day_type, audience, hbl_overlay')
    .eq('term_id', termId)
    .in('audience', audiences);
  const byDate = new Map<string, CalRow>();
  for (const r of (data ?? []) as CalRow[]) {
    const prev = byDate.get(r.date);
    if (!prev || (prev.audience === 'all' && r.audience !== 'all'))
      byDate.set(r.date, r);
  }
  return [...byDate.values()]
    .filter((r) => isEncodableDayType(r.day_type, r.hbl_overlay ?? false))
    .map((r) => r.date)
    .sort();
}

async function main() {
  const asOf = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Singapore',
  });
  console.log(`as of ${asOf}\n`);

  const { data: ay } = await svc
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .maybeSingle();
  if (!ay) throw new Error('no current AY');

  const { data: sections } = await svc
    .from('sections')
    .select('id, name, level:levels(level_type)')
    .eq('academic_year_id', ay.id)
    .order('name');

  const { data: terms } = await svc
    .from('terms')
    .select('id, label, term_number')
    .eq('academic_year_id', ay.id)
    .order('term_number');

  for (const t of terms ?? []) {
    let printedHeader = false;
    for (const s of sections ?? []) {
      const raw = (s as { level?: unknown }).level;
      const lvl = (Array.isArray(raw) ? raw[0] : raw) as
        | { level_type?: string }
        | undefined;
      const levelType =
        lvl?.level_type === 'primary' || lvl?.level_type === 'secondary'
          ? lvl.level_type
          : null;

      const { data: enrRows } = await svc
        .from('section_students')
        .select('id, enrollment_date, withdrawal_date, enrollment_status')
        .eq('section_id', s.id);
      const enrolments: SummaryEnrolmentInput[] = (enrRows ?? []).map((e) => ({
        sectionStudentId: e.id as string,
        enrollmentDate: e.enrollment_date as string | null,
        withdrawalDate: e.withdrawal_date as string | null,
        enrollmentStatus: e.enrollment_status as string,
      }));
      const ids = enrolments.map((e) => e.sectionStudentId);
      if (ids.length === 0) continue;

      const [dates, rollupRes, markRes] = await Promise.all([
        encodableDates(t.id, levelType),
        svc
          .from('attendance_records')
          .select(
            'section_student_id, school_days, days_present, days_late, days_excused, days_absent'
          )
          .eq('term_id', t.id)
          .in('section_student_id', ids),
        svc
          .from('attendance_daily')
          .select('date')
          .eq('term_id', t.id)
          .in('section_student_id', ids),
      ]);

      const rollups: SummaryRollupInput[] = (rollupRes.data ?? []).map((r) => ({
        sectionStudentId: r.section_student_id as string,
        schoolDays: (r.school_days as number) ?? 0,
        daysPresent: (r.days_present as number) ?? 0,
        daysLate: (r.days_late as number) ?? 0,
        daysExcused: (r.days_excused as number) ?? 0,
        daysAbsent: (r.days_absent as number) ?? 0,
      }));

      const x = computeSectionAttendanceSummary({
        sectionId: s.id as string,
        termId: t.id as string,
        encodableDates: dates,
        markedDates: Array.from(
          new Set((markRes.data ?? []).map((m) => m.date as string))
        ),
        enrolments,
        rollups,
        asOf,
      });

      if (x.markedStudentDays === 0 && x.expectedStudentDays === 0) continue;
      if (!printedHeader) {
        console.log(`${'='.repeat(84)}\n${t.label}\n${'='.repeat(84)}`);
        console.log(
          'class'.padEnd(18) +
            'rate'.padStart(8) +
            'sch'.padStart(5) +
            'mkd'.padStart(5) +
            'owed'.padStart(6) +
            'rec'.padStart(5) +
            'out'.padStart(5) +
            '   on/late/exc/abs'
        );
        printedHeader = true;
      }
      console.log(
        String(s.name).slice(0, 17).padEnd(18) +
          (x.presentRate == null ? '—' : `${x.presentRate}%`).padStart(8) +
          String(x.schoolDays).padStart(5) +
          String(x.daysMarked).padStart(5) +
          String(x.expectedStudentDays).padStart(6) +
          String(x.markedStudentDays).padStart(5) +
          String(x.unmarkedStudentDays).padStart(5) +
          `   ${x.onTime}/${x.late}/${x.excused}/${x.absent}` +
          ` = ${x.onTime + x.late + x.excused + x.absent}`
      );
    }
  }
}

main().catch((e) => {
  console.error('probe failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
