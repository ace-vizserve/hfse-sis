import { isAttendanceAtRisk } from '@/lib/attendance/risk';
import { monthKeyOf, monthLabelOf } from '@/lib/attendance/sheet-columns';
import type { AttendanceStatus } from '@/lib/schemas/attendance';

export type Mark = { date: string; status: AttendanceStatus | null };

export type RawDailyMark = {
  date: string;
  status: AttendanceStatus | null;
  periodId: string | null;
  recordedAt: string;
};

export type SummaryStat = {
  /** Days carrying a counted mark (P/L/EX/A). NC and null are excluded. */
  totalDays: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
  /** (P+L+EX)/totalDays * 100, 1dp. null when totalDays === 0. */
  attendancePct: number | null;
};

export type MonthlySummary = {
  month: string;
  label: string;
  stat: SummaryStat;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * HFSE sheet formula (read from AY2026 Term 3 Attendance.xlsx):
 *   TotalDays = count of P/L/EX/A marks (COUNTA over the date range)
 *   Attendance % = (Present + Late + Excused) / TotalDays
 * NC and unmarked days are excluded — they behave like the template's blank cell.
 */
export function summarizeMarks(marks: Mark[]): SummaryStat {
  let present = 0;
  let late = 0;
  let excused = 0;
  let absent = 0;
  for (const mk of marks) {
    switch (mk.status) {
      case 'P':
        present++;
        break;
      case 'L':
        late++;
        break;
      case 'EX':
        excused++;
        break;
      case 'A':
        absent++;
        break;
      default:
        break; // 'NC' and null excluded
    }
  }
  const totalDays = present + late + excused + absent;
  const attendancePct =
    totalDays === 0
      ? null
      : round1(((present + late + excused) / totalDays) * 100);
  return { totalDays, present, late, excused, absent, attendancePct };
}

/** Per-student: month blocks (chronological) + term total. */
export function summarizeByMonth(marks: Mark[]): {
  months: MonthlySummary[];
  term: SummaryStat;
} {
  const byMonth = new Map<string, Mark[]>();
  for (const mk of marks) {
    const k = monthKeyOf(mk.date);
    const arr = byMonth.get(k) ?? [];
    arr.push(mk);
    byMonth.set(k, arr);
  }
  const months: MonthlySummary[] = Array.from(byMonth.keys())
    .sort()
    .map((k) => ({
      month: k,
      label: monthLabelOf(k),
      stat: summarizeMarks(byMonth.get(k)!),
    }));
  return { months, term: summarizeMarks(marks) };
}

/**
 * Dedupes raw `attendance_daily` rows to the latest `recordedAt` per
 * (date, periodId) — same dedup rule the daily-grid + rollup RPC use —
 * then buckets by calendar month via `summarizeByMonth`. Powers the
 * attendance lookup dialog's "This term by month" table. Caller is
 * responsible for pre-filtering `rows` to the term of interest.
 */
export function currentTermMonthsFromRaw(
  rows: RawDailyMark[]
): MonthlySummary[] {
  const sorted = [...rows].sort((a, b) =>
    b.recordedAt.localeCompare(a.recordedAt)
  );
  const seen = new Set<string>();
  const marks: Mark[] = [];
  for (const r of sorted) {
    const key = `${r.date}|${r.periodId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    marks.push({ date: r.date, status: r.status });
  }
  return summarizeByMonth(marks).months;
}

export type TermSummaryEnrolment = {
  enrolmentId: string;
  indexNumber: number;
  studentName: string;
  withdrawn: boolean;
  enrollmentDate: string | null;
};

/** Distinct calendar months, chronological, with display labels. */
export function monthsInRange(
  calendar: { date: string }[]
): { month: string; label: string }[] {
  const keys = new Set(calendar.map((c) => monthKeyOf(c.date)));
  return Array.from(keys)
    .sort()
    .map((k) => ({ month: k, label: monthLabelOf(k) }));
}

/**
 * Per-student month + term breakdown for the whole roster, from the term's
 * full calendar range and the section's raw daily marks — the server-side
 * revival of the client-side computation `wide-grid.tsx`'s "Show summary"
 * panel used to do (removed when that panel was replaced by the lookup
 * dialog's roster table, which was itself later replaced by this page).
 * Powers the Term Sheet Summary page.
 *
 * Every calendar date becomes a `Mark` for every student (status `null`
 * when no daily row exists for that date) EXCEPT dates before the
 * student's `enrollmentDate` — those are dropped entirely, not zeroed,
 * so a late enrollee's term/month totals aren't diluted by days they
 * weren't enrolled for yet. The `months` array omits any month with zero
 * counted (P/L/EX/A) marks — `term` is unaffected and still reflects the
 * full eligible calendar range.
 */
export function buildTermSummaryRows(
  enrolments: TermSummaryEnrolment[],
  calendar: { date: string }[],
  daily: {
    sectionStudentId: string;
    date: string;
    status: AttendanceStatus | null;
  }[]
): {
  enrolment: TermSummaryEnrolment;
  months: MonthlySummary[];
  term: SummaryStat;
}[] {
  const dailyByStudent = new Map<
    string,
    Map<string, AttendanceStatus | null>
  >();
  for (const d of daily) {
    let byDate = dailyByStudent.get(d.sectionStudentId);
    if (!byDate) {
      byDate = new Map();
      dailyByStudent.set(d.sectionStudentId, byDate);
    }
    byDate.set(d.date, d.status);
  }

  return enrolments.map((enrolment) => {
    const byDate = dailyByStudent.get(enrolment.enrolmentId);
    const marks: Mark[] = calendar
      .filter(
        (c) => !enrolment.enrollmentDate || c.date >= enrolment.enrollmentDate
      )
      .map((c) => ({
        date: c.date,
        status: byDate?.get(c.date) ?? null,
      }));
    const { months: allMonths, term } = summarizeByMonth(marks);
    // Exclude months with no counted marks (totalDays === 0)
    const months = allMonths.filter((m) => m.stat.totalDays > 0);
    return { enrolment, months, term };
  });
}

export type TermSummaryRow = ReturnType<typeof buildTermSummaryRows>[number];

/** Adds several stats together and re-derives the rate with the same sheet
 *  formula — (P+L+EX)/(P+L+EX+A) — so a class figure is the pooled
 *  student-days, never an average of averages. */
export function poolStats(stats: SummaryStat[]): SummaryStat {
  let present = 0;
  let late = 0;
  let excused = 0;
  let absent = 0;
  for (const s of stats) {
    present += s.present;
    late += s.late;
    excused += s.excused;
    absent += s.absent;
  }
  const totalDays = present + late + excused + absent;
  const attendancePct =
    totalDays === 0
      ? null
      : round1(((present + late + excused) / totalDays) * 100);
  return { totalDays, present, late, excused, absent, attendancePct };
}

export type TermClassOverview = {
  /** Every student's marks pooled — withdrawn students' marks included,
   *  since those days happened. */
  term: SummaryStat;
  /** Active students whose term rate is under the at-risk line. */
  atRisk: number;
  /** Active students with at least one counted mark and no absences. */
  perfect: number;
  /** Active students. */
  active: number;
  /** Pooled class rate for each month of the term, chronological. */
  byMonth: { month: string; label: string; stat: SummaryStat }[];
};

/** Class-level figures for the Term Sheet Summary's cards and charts. */
export function summarizeClassTerm(
  rows: TermSummaryRow[],
  months: { month: string; label: string }[]
): TermClassOverview {
  const active = rows.filter((r) => !r.enrolment.withdrawn);
  return {
    term: poolStats(rows.map((r) => r.term)),
    atRisk: active.filter((r) => isAttendanceAtRisk(r.term.attendancePct))
      .length,
    perfect: active.filter((r) => r.term.totalDays > 0 && r.term.absent === 0)
      .length,
    active: active.length,
    byMonth: months.map((m) => ({
      month: m.month,
      label: m.label,
      stat: poolStats(
        rows.flatMap((r) =>
          r.months.filter((x) => x.month === m.month).map((x) => x.stat)
        )
      ),
    })),
  };
}
