import { Fragment } from 'react';

import { Badge } from '@/components/ui/badge';
import { rateTone } from '@/lib/attendance/rate-tone';
import type {
  MonthlySummary,
  SummaryStat,
  TermSummaryEnrolment,
} from '@/lib/attendance/sheet-summary';

export type TermSummaryRow = {
  enrolment: TermSummaryEnrolment;
  months: MonthlySummary[];
  term: SummaryStat;
};

const EMPTY_STAT: SummaryStat = {
  totalDays: 0,
  present: 0,
  late: 0,
  excused: 0,
  absent: 0,
  attendancePct: null,
};

function pct(p: number | null): string {
  return p == null ? '—' : `${p}%`;
}

const SUB_HEAD_CLASS =
  'px-3 py-1.5 text-right font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground';

// One "Days | P | L | EX | A | Rate" sub-header group — used once for the
// Term Total block and once per month block. A left rule (`border-l-2`) on
// the first cell separates each group visually, matching wide-grid.tsx's
// own column-tag convention.
function SubHeaderGroup() {
  return (
    <Fragment>
      <th className={`border-l-2 border-border ${SUB_HEAD_CLASS}`}>Days</th>
      <th className={SUB_HEAD_CLASS}>P</th>
      <th className={SUB_HEAD_CLASS}>L</th>
      <th className={SUB_HEAD_CLASS}>EX</th>
      <th className={SUB_HEAD_CLASS}>A</th>
      <th className={SUB_HEAD_CLASS}>Rate</th>
    </Fragment>
  );
}

// One "Days | P | L | EX | A | Rate" data-cell group for a single student ×
// (term-total or one month). `EMPTY_STAT` renders as all-zero/dash for a
// month this student has no data for (before enrollment, or not reached
// yet) — visually identical either way, which is the correct call: both
// mean "nothing to report for this student this month."
function StatCells({ stat }: { stat: SummaryStat }) {
  const tone = stat.attendancePct == null ? null : rateTone(stat.attendancePct);
  return (
    <Fragment>
      <td className="border-l-2 border-border px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
        {stat.totalDays}
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
        {stat.present}
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
        {stat.late}
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
        {stat.excused}
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
        {stat.absent}
      </td>
      <td
        className={`px-3 py-2.5 text-right font-mono text-sm font-semibold tabular-nums ${
          tone?.text ?? 'text-muted-foreground'
        }`}
      >
        {pct(stat.attendancePct)}
      </td>
    </Fragment>
  );
}

export function TermSheetSummaryTable({
  rows,
  months,
}: {
  rows: TermSummaryRow[];
  months: { month: string; label: string }[];
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No students enrolled in this section yet.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th
                rowSpan={2}
                className="sticky left-0 z-10 bg-muted/60 px-3 py-2 text-left align-bottom font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
              >
                Student
              </th>
              <th
                colSpan={6}
                className="border-l-2 border-border bg-brand-indigo/10 px-3 py-2 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-indigo"
              >
                Term total
              </th>
              {months.map((m) => (
                <th
                  key={m.month}
                  colSpan={6}
                  className="border-l-2 border-border bg-muted/40 px-3 py-2 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                >
                  {m.label}
                </th>
              ))}
            </tr>
            <tr className="border-b border-border">
              {/*
                No leading cell here for the Student column — row 1's
                `rowSpan={2}` Student header already reserves this row's
                first grid slot. Adding one here double-counts a column and
                shifts every sub-header label one column to the right of
                the data it labels.
              */}
              <SubHeaderGroup key="term" />
              {months.map((m) => (
                <SubHeaderGroup key={m.month} />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const statByMonth = new Map(
                row.months.map((m) => [m.month, m.stat])
              );
              return (
                <tr
                  key={row.enrolment.enrolmentId}
                  className="hover:bg-muted/30"
                >
                  <td className="sticky left-0 z-10 bg-card px-3 py-2.5 font-medium text-foreground">
                    <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                      {row.enrolment.indexNumber}
                    </span>
                    {row.enrolment.studentName}
                    {row.enrolment.withdrawn && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        Withdrawn
                      </Badge>
                    )}
                  </td>
                  <StatCells stat={row.term} />
                  {months.map((m) => (
                    <StatCells
                      key={m.month}
                      stat={statByMonth.get(m.month) ?? EMPTY_STAT}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
