import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { TermSheetSummaryView } from '@/components/attendance/term-sheet-summary-view';
import {
  summarizeClassTerm,
  type SummaryStat,
  type TermSummaryRow,
} from '@/lib/attendance/sheet-summary';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/attendance/s1/summary',
  useSearchParams: () => new URLSearchParams(),
}));

function stat(p: number, l: number, ex: number, a: number): SummaryStat {
  const totalDays = p + l + ex + a;
  return {
    totalDays,
    present: p,
    late: l,
    excused: ex,
    absent: a,
    attendancePct:
      totalDays === 0
        ? null
        : Math.round(((p + l + ex) / totalDays) * 1000) / 10,
  };
}

const months = [
  { month: '2026-06', label: 'June 2026' },
  { month: '2026-07', label: 'July 2026' },
];

const rows: TermSummaryRow[] = [
  {
    enrolment: {
      enrolmentId: 'e2',
      indexNumber: 2,
      studentName: 'RIBLORA, Ellie',
      withdrawn: true,
      enrollmentDate: '2026-07-01',
    },
    months: [{ month: '2026-07', label: 'July 2026', stat: stat(1, 0, 0, 1) }],
    term: stat(1, 0, 0, 1),
  },
  {
    enrolment: {
      enrolmentId: 'e1',
      indexNumber: 1,
      studentName: 'BALDONADO, Luke',
      withdrawn: false,
      enrollmentDate: null,
    },
    months: [
      { month: '2026-06', label: 'June 2026', stat: stat(2, 1, 0, 0) },
      { month: '2026-07', label: 'July 2026', stat: stat(1, 0, 0, 0) },
    ],
    term: stat(3, 1, 0, 0),
  },
];

describe('summarizeClassTerm', () => {
  it('pools student-days with the sheet formula and counts active students only', () => {
    const o = summarizeClassTerm(rows, months);
    expect(o.term.totalDays).toBe(6);
    expect(o.term.absent).toBe(1);
    expect(o.term.attendancePct).toBe(83.3);
    // The withdrawn student is under the line but not counted.
    expect(o.atRisk).toBe(0);
    expect(o.perfect).toBe(1);
    expect(o.active).toBe(1);
    expect(o.byMonth.map((m) => m.stat.totalDays)).toEqual([3, 3]);
    expect(o.byMonth[1].stat.attendancePct).toBe(66.7);
  });
});

describe('TermSheetSummaryView', () => {
  it('renders the cards and one row per student, ordered by index number', () => {
    render(
      <TermSheetSummaryView
        rows={rows}
        months={months}
        overview={summarizeClassTerm(rows, months)}
        sectionName="P1 Ruby"
        termLabel="Term 1"
      />
    );
    expect(screen.getByText('Class attendance rate')).toBeInTheDocument();
    expect(screen.getByText('Below the at-risk line')).toBeInTheDocument();
    expect(screen.getByText('Perfect attendance')).toBeInTheDocument();
    expect(screen.getByText('Absences this term')).toBeInTheDocument();

    const bodyRows = screen
      .getAllByRole('row')
      .filter((r) => within(r).queryAllByRole('columnheader').length === 0);
    expect(bodyRows[0]).toHaveTextContent('BALDONADO, Luke');
    expect(bodyRows[1]).toHaveTextContent('RIBLORA, Ellie');
    expect(within(bodyRows[1]).getByText('Withdrawn')).toBeInTheDocument();
    // Whole term by default: Luke's rate is 100%.
    expect(within(bodyRows[0]).getByText('100%')).toBeInTheDocument();
  });
});
