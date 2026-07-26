import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TermSheetSummaryTable } from '@/components/attendance/term-sheet-summary-table';
import type { TermSummaryEnrolment } from '@/lib/attendance/sheet-summary';

const months = [
  { month: '2026-06', label: 'June 2026' },
  { month: '2026-07', label: 'July 2026' },
];

const normal: TermSummaryEnrolment = {
  enrolmentId: 'e1',
  indexNumber: 1,
  studentName: 'BALDONADO, Luke',
  withdrawn: false,
  enrollmentDate: null,
};

const lateEnrollee: TermSummaryEnrolment = {
  enrolmentId: 'e2',
  indexNumber: 2,
  studentName: 'RIBLORA, Ellie',
  withdrawn: true,
  enrollmentDate: '2026-07-01',
};

describe('TermSheetSummaryTable', () => {
  it('renders a grouped header — Term Total + one block per month', () => {
    render(
      <TermSheetSummaryTable
        rows={[
          {
            enrolment: normal,
            months: [
              {
                month: '2026-06',
                label: 'June 2026',
                stat: {
                  totalDays: 2,
                  present: 2,
                  late: 0,
                  excused: 0,
                  absent: 0,
                  attendancePct: 100,
                },
              },
              {
                month: '2026-07',
                label: 'July 2026',
                stat: {
                  totalDays: 1,
                  present: 1,
                  late: 0,
                  excused: 0,
                  absent: 0,
                  attendancePct: 100,
                },
              },
            ],
            term: {
              totalDays: 3,
              present: 3,
              late: 0,
              excused: 0,
              absent: 0,
              attendancePct: 100,
            },
          },
        ]}
        months={months}
      />
    );
    expect(screen.getByText('Term total')).toBeInTheDocument();
    expect(screen.getByText('June 2026')).toBeInTheDocument();
    expect(screen.getByText('July 2026')).toBeInTheDocument();
    expect(screen.getByText('BALDONADO, Luke')).toBeInTheDocument();
  });

  it('renders a dash for a month with no data for a student (e.g. before enrollment)', () => {
    render(
      <TermSheetSummaryTable
        rows={[
          {
            enrolment: lateEnrollee,
            // Only July — no June entry at all (enrolled 2026-07-01).
            months: [
              {
                month: '2026-07',
                label: 'July 2026',
                stat: {
                  totalDays: 1,
                  present: 1,
                  late: 0,
                  excused: 0,
                  absent: 0,
                  attendancePct: 100,
                },
              },
            ],
            term: {
              totalDays: 1,
              present: 1,
              late: 0,
              excused: 0,
              absent: 0,
              attendancePct: 100,
            },
          },
        ]}
        months={months}
      />
    );
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
    // June column for this student should show the null-rate dash, not a number.
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('renders an empty state when there are no students', () => {
    render(<TermSheetSummaryTable rows={[]} months={months} />);
    expect(screen.getByText(/no students enrolled/i)).toBeInTheDocument();
  });
});
