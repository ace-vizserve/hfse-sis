import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StudentLookupSheet } from '@/components/attendance/student-lookup-sheet';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetchOnce } from '../_utils/mock-fetch';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/attendance/section-1',
  useSearchParams: () => new URLSearchParams(),
}));

const enrolments: WideGridEnrolment[] = [
  {
    enrolmentId: 'e1',
    indexNumber: 1,
    studentNumber: 'S1',
    studentName: 'BALDONADO, Luke',
    busNo: null,
    classroomOfficerRole: null,
    academicsNotes: null,
    adminNotes: null,
    withdrawn: false,
    compassionateUsed: 0,
    compassionateAllowance: 5,
    vlUsedThisTerm: 0,
    vlAllowance: 1,
    enrollmentDate: null,
  },
  {
    enrolmentId: 'e2',
    indexNumber: 2,
    studentNumber: 'S2',
    studentName: 'RIBLORA, Ellie',
    busNo: null,
    classroomOfficerRole: null,
    academicsNotes: null,
    adminNotes: null,
    withdrawn: true,
    compassionateUsed: 0,
    compassionateAllowance: 5,
    vlUsedThisTerm: 0,
    vlAllowance: 1,
    enrollmentDate: null,
  },
];

describe('StudentLookupSheet search list', () => {
  it('opens to a searchable flat list of students', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        termLabel="Term 3"
        termId="t3"
        sectionId="sec-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /look up student/i }));
    expect(
      screen.getByRole('heading', { name: 'Attendance lookup' })
    ).toBeInTheDocument();
    expect(screen.getByText('BALDONADO, Luke')).toBeInTheDocument();
    expect(screen.getByText('RIBLORA, Ellie')).toBeInTheDocument();
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
  });

  it('search filters the list by name', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        termLabel="Term 3"
        termId="t3"
        sectionId="sec-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /look up student/i }));
    await user.type(
      screen.getByPlaceholderText(/type a student name/i),
      'riblora'
    );
    expect(screen.queryByText('BALDONADO, Luke')).not.toBeInTheDocument();
    expect(screen.getByText('RIBLORA, Ellie')).toBeInTheDocument();
  });

  it('clicking a student opens the per-student detail view', async () => {
    const user = userEvent.setup();
    stubFetchOnce(
      jsonResponse({
        termStats: [],
        recentAbsences: [],
        currentTermMonths: [],
      })
    );
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        termLabel="Term 3"
        termId="t3"
        sectionId="sec-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /look up student/i }));
    await user.click(screen.getByText('BALDONADO, Luke'));
    expect(screen.getByText('Attendance record')).toBeInTheDocument();
    expect(screen.getByText('All students')).toBeInTheDocument();
  });

  it('links to the whole term summary page, scoped to the current term, opening in a new tab', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        termLabel="Term 3"
        termId="t3"
        sectionId="sec-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /look up student/i }));
    const link = screen.getByRole('link', {
      name: /view whole term summary/i,
    });
    expect(link).toHaveAttribute(
      'href',
      '/attendance/sec-1/summary?term_id=t3'
    );
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('StudentLookupSheet detail view', () => {
  it('shows the current-term month breakdown and a trend-chart region instead of a ring', async () => {
    const user = userEvent.setup();
    stubFetchOnce(
      jsonResponse({
        termStats: [
          {
            termId: 't3',
            termNumber: 3,
            label: 'Term 3',
            isCurrent: true,
            P: 26,
            L: 0,
            A: 0,
            EX: 0,
            rate: 100,
          },
        ],
        recentAbsences: [],
        currentTermMonths: [
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
              totalDays: 12,
              present: 12,
              late: 0,
              excused: 0,
              absent: 0,
              attendancePct: 100,
            },
          },
        ],
      })
    );
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        termLabel="Term 3"
        termId="t3"
        sectionId="sec-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /look up student/i }));
    await user.click(screen.getByText('BALDONADO, Luke'));

    expect(await screen.findByText('This term by month')).toBeInTheDocument();
    expect(screen.getByText('June 2026')).toBeInTheDocument();
    expect(screen.getByText('July 2026')).toBeInTheDocument();
    expect(screen.getByTestId('rate-trend-chart')).toBeInTheDocument();
  });

  it('shows a "no data" message instead of a chart when the current term has no months yet', async () => {
    const user = userEvent.setup();
    stubFetchOnce(
      jsonResponse({
        termStats: [],
        recentAbsences: [],
        currentTermMonths: [],
      })
    );
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        termLabel="Term 3"
        termId="t3"
        sectionId="sec-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /look up student/i }));
    await user.click(screen.getByText('BALDONADO, Luke'));

    expect(
      await screen.findByText('No attendance recorded yet this term.')
    ).toBeInTheDocument();
    expect(screen.queryByText('This term by month')).not.toBeInTheDocument();
  });
});
