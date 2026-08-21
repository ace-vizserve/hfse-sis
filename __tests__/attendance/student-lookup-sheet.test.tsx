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

// Luke is below the 90% line; Ellie is too, but she has withdrawn — which is
// why she must never appear under "Only flagged".
const pcts: Record<string, number | null> = { e1: 85, e2: 62 };

describe('StudentLookupSheet search list', () => {
  it('opens to a searchable flat list of students', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        attendancePctByEnrolment={pcts}
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
        attendancePctByEnrolment={pcts}
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
        attendancePctByEnrolment={pcts}
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
        attendancePctByEnrolment={pcts}
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
        attendancePctByEnrolment={pcts}
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
        attendancePctByEnrolment={pcts}
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

/**
 * The list used to carry a name and an index number and nothing else, so the
 * only way to learn anything about a class was to open every student in turn.
 * Mr Ace, 2026-08-21: "rather than then checking each student."
 */
describe('the list reports without being opened', () => {
  function renderList() {
    return renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        attendancePctByEnrolment={pcts}
        termLabel="Term 3"
        termId="t3"
        sectionId="sec-1"
      />
    );
  }

  async function open() {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /look up student/i }));
    return user;
  }

  it('puts this term’s rate on every row', async () => {
    renderList();
    await open();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
  });

  it('shows a dash rather than a zero when there is no rate yet', async () => {
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        attendancePctByEnrolment={{}}
        termLabel="Term 3"
        termId="t3"
        sectionId="sec-1"
      />
    );
    await open();
    // A student with no register is not a student with 0% attendance.
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('narrows to the students below the line, and leaves withdrawn out', async () => {
    renderList();
    const user = await open();

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /only flagged/i }));

    expect(screen.getByText(/BALDONADO/)).toBeInTheDocument();
    // Ellie is at 62% but has withdrawn — a leaver is not a phone call.
    expect(screen.queryByText(/RIBLORA/)).toBeNull();
  });

  it('names the term on the filter, so an empty list is not read as "never"', async () => {
    renderList();
    const user = await open();
    await user.click(screen.getByRole('combobox'));
    expect(
      screen.getByRole('option', { name: /only flagged/i })
    ).toHaveTextContent('Term 3');
  });
});
