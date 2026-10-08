// Who is on which class list on which school day — shared by the attendance
// and evaluation phases (and their checks), so a register and a write-up can
// never disagree about whether a child was in the class.
//
// School days come from the app's own `expandSchoolDays`
// (lib/attendance/school-days.ts — the same calendar rule the daily route's
// write-gate and the database's `attendance_write_blocked` apply: school_day
// and hbl are encodable, a school_holiday only with its HBL overlay, and a
// date missing from a configured term is a holiday).
//
// A child's window on a class list:
//   * from  — `enrollment_date` (late enrollees, the transfer's new class),
//             else the first school day of the year;
//   * to    — `withdrawal_date` INCLUSIVE, as the app's own
//             `expectedDaysForStudent` (lib/attendance/section-summary.ts)
//             counts it. That includes the transfer's old class:
//             `transfer_student_section` stamps the old row's
//             withdrawal_date AND the new row's enrollment_date with the same
//             transfer day (migration 168), so the app owes the transfer day
//             in BOTH classes and both registers carry a mark for it;
//             a withdrawal with NO date (all of AY2025's, two of AY2026's —
//             production's pre-SIS import carries none) gets a leaving day
//             drawn here, deterministically, so the child still has the terms
//             they attended (production: AY2025's 414 class rows, 391 → 375
//             children in the registers from T1 to T4);
//             otherwise the year's last school day.
//
// AY2026's days run to the END OF TERM 4, not to TODAY: the register is
// planned for the whole year (so a child's year is drawn the same whatever day
// the seeder runs on), and only the days already due are written —
// `registerEnd`, the earlier of the real run date and Term 4's end (see
// lib/constants.ts — the app's own attendance pages read `sgToday()`, so a
// register that stopped at a fixed TODAY would show every later day as owed).

import { expandSchoolDays } from '@/lib/attendance/school-days';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';

import { runDateSg } from '../lib/constants';
import { pickFrom } from '../lib/distribution';
import { service, sqlRows } from '../lib/local';
import { rng } from '../lib/random';

export const ATTENDANCE_AYS = ['AY2025', 'AY2026'] as const;
export type AttAy = (typeof ATTENDANCE_AYS)[number];

export type TermRow = {
  id: string;
  ay: AttAy;
  number: number;
  start: string;
  end: string;
};

export type SchoolDayRow = { date: string; termId: string; term: number };

export type Enrolment = {
  id: string;
  studentId: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  sectionId: string;
  sectionName: string;
  level: string;
  ay: AttAy;
  status: string;
  enrollmentDate: string | null;
  withdrawalDate: string | null;
  /** The school days this child is on THIS class list, ascending. */
  days: SchoolDayRow[];
};

export type Roster = {
  terms: TermRow[];
  enrolments: Enrolment[];
  /** Every encodable day per AY × audience level type, ascending — the whole year. */
  schoolDays: (ay: AttAy, level: string) => SchoolDayRow[];
  /**
   * The last AY2026 day whose register is due: the earlier of the real run
   * date and Term 4's last day. Run-date dependent (lib/constants.ts).
   */
  registerEnd: string;
  /** Is this day's register due yet? Every AY2025 day is. */
  isDue: (ay: AttAy, date: string) => boolean;
};

let cached: Roster | null = null;

export async function loadRoster(): Promise<Roster> {
  if (cached) return cached;
  const terms: TermRow[] = sqlRows(
    `select t.id, a.ay_code, t.term_number, t.start_date, t.end_date
       from terms t join academic_years a on a.id = t.academic_year_id
      where a.ay_code in ('AY2025', 'AY2026') order by a.ay_code, t.term_number`
  ).map(([id, ay, n, start, end]) => ({
    id,
    ay: ay as AttAy,
    number: Number(n),
    start,
    end,
  }));
  const ayIds = new Map(
    sqlRows(
      `select ay_code, id from academic_years where ay_code in ('AY2025', 'AY2026')`
    ).map(([code, id]) => [code, id])
  );

  // Calendar days per AY × level type, through the app's own expansion.
  const days = new Map<string, SchoolDayRow[]>();
  const termNumber = new Map(terms.map((t) => [t.id, t.number]));
  for (const ay of ATTENDANCE_AYS) {
    const ayTerms = terms.filter((t) => t.ay === ay);
    const start = ayTerms[0].start;
    const end = ayTerms[ayTerms.length - 1].end;
    for (const levelType of ['primary', 'secondary', null] as const) {
      const list = await expandSchoolDays(service(), {
        startDate: start,
        endDate: end,
        academicYearId: ayIds.get(ay)!,
        levelType,
      });
      days.set(
        `${ay}|${levelType}`,
        list.map((d) => ({
          date: d.date,
          termId: d.termId,
          term: termNumber.get(d.termId)!,
        }))
      );
    }
  }
  const schoolDays = (ay: AttAy, level: string) =>
    days.get(`${ay}|${levelTypeForAudienceLookup(level)}`)!;

  const raw = sqlRows(
    `select ss.id, st.id, st.student_number, st.first_name, st.last_name, s.id, s.name, l.code,
            a.ay_code, ss.enrollment_status, coalesce(ss.enrollment_date::text, ''),
            coalesce(ss.withdrawal_date::text, '')
       from section_students ss
       join students st on st.id = ss.student_id
       join sections s on s.id = ss.section_id
       join levels l on l.id = s.level_id
       join academic_years a on a.id = s.academic_year_id
      where a.ay_code in ('AY2025', 'AY2026')
      order by a.ay_code, st.student_number, ss.enrollment_date nulls first, l.code, s.name`
  );
  const rows = raw.map(
    ([
      id,
      studentId,
      sn,
      first,
      last,
      sectionId,
      sectionName,
      level,
      ay,
      status,
      ed,
      wd,
    ]) => ({
      id,
      studentId,
      studentNumber: sn,
      firstName: first,
      lastName: last,
      sectionId,
      sectionName,
      level,
      ay: ay as AttAy,
      status,
      enrollmentDate: ed || null,
      withdrawalDate: wd || null,
    })
  );

  const enrolments: Enrolment[] = rows.map((e) => {
    const all = schoolDays(e.ay, e.level);
    const from = e.enrollmentDate ?? all[0].date;
    let inWindow: (d: string) => boolean;
    if (e.withdrawalDate) {
      const w = e.withdrawalDate;
      inWindow = (d) => d <= w;
    } else if (e.status === 'withdrawn') {
      const last = undatedLeavingDay(e.ay, e.studentNumber, all, from);
      inWindow = (d) => d <= last;
    } else {
      inWindow = () => true;
    }
    return {
      ...e,
      days: all.filter((d) => d.date >= from && inWindow(d.date)),
    };
  });

  const t4End = terms.filter((t) => t.ay === 'AY2026').at(-1)!.end;
  const run = runDateSg();
  const registerEnd = run < t4End ? run : t4End;
  const isDue = (ay: AttAy, date: string) =>
    ay === 'AY2025' || date <= registerEnd;

  cached = { terms, enrolments, schoolDays, registerEnd, isDue };
  return cached;
}

/**
 * The last school day of a child withdrawn without a date. AY2025: mostly
 * during Term 2 or 3 (production's registers lose 16 children between T2
 * and T4); AY2026: during Term 1 or 2.
 */
function undatedLeavingDay(
  ay: AttAy,
  studentNumber: string,
  all: SchoolDayRow[],
  from: string
): string {
  const r = rng(`attendance:leaving:${ay}:${studentNumber}`);
  const term = pickFrom<number>(
    r,
    ay === 'AY2025'
      ? [
          [2, 40],
          [3, 40],
          [4, 20],
        ]
      : [
          [1, 50],
          [2, 50],
        ]
  );
  const candidates = all.filter((d) => d.term === term && d.date >= from);
  if (candidates.length === 0) return from;
  return r.pick(candidates).date;
}

/** Enrolments of one child in one year (the transfer has two), by start. */
export function byChild(enrolments: Enrolment[]): Map<string, Enrolment[]> {
  const out = new Map<string, Enrolment[]>();
  for (const e of enrolments) {
    const key = `${e.ay}|${e.studentNumber}`;
    out.set(key, [...(out.get(key) ?? []), e]);
  }
  return out;
}
