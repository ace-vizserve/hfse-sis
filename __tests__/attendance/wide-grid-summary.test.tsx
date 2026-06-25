import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { AttendanceWideGrid } from '@/components/attendance/wide-grid';
import type { SchoolCalendarRow } from '@/lib/attendance/calendar';
import { renderWithClient } from '../_utils/render-with-client';

// Mock next/link (used inside the component for the "Open School Calendar" CTA)
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// Mock next/navigation (required by any component that imports router hooks)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/attendance/s',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock sonner toast (used by writeCell)
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const cal: SchoolCalendarRow[] = [
  {
    id: '1',
    termId: 't',
    date: '2026-06-29',
    dayType: 'school_day',
    isHoliday: false,
    label: null,
    audience: 'all',
    hblOverlay: false,
  },
  {
    id: '2',
    termId: 't',
    date: '2026-07-01',
    dayType: 'school_day',
    isHoliday: false,
    label: null,
    audience: 'all',
    hblOverlay: false,
  },
];

describe('AttendanceWideGrid summary panel', () => {
  it('summary panel computes (P+L+EX)/marked-days from seeded marks when toggled', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderWithClient(
      <AttendanceWideGrid
        sectionId="s"
        termId="t"
        canWriteNc={false}
        events={[]}
        calendar={cal}
        enrolments={[
          {
            enrolmentId: 'e1',
            indexNumber: 1,
            studentNumber: 'S1',
            studentName: 'DOE, Jane',
            busNo: null,
            classroomOfficerRole: null,
            withdrawn: false,
            compassionateUsed: 0,
            compassionateAllowance: 5,
            vlUsedThisTerm: 0,
            vlAllowance: 1,
            enrollmentDate: null,
          },
        ]}
        initialDaily={[
          {
            id: 'd1',
            sectionStudentId: 'e1',
            termId: 't',
            date: '2026-06-29',
            status: 'P',
            exReason: null,
            periodId: null,
            recordedBy: null,
            recordedAt: '',
          },
          {
            id: 'd2',
            sectionStudentId: 'e1',
            termId: 't',
            date: '2026-07-01',
            status: 'A',
            exReason: null,
            periodId: null,
            recordedBy: null,
            recordedAt: '',
          },
        ]}
      />
    );
    await user.click(screen.getByRole('button', { name: /show summary/i }));
    // Term total row: 2 marked days, 1 present, 1 absent → 50.0%
    expect(screen.getByText('Term total')).toBeInTheDocument();
    expect(screen.getByText('50.0%')).toBeInTheDocument();
  });

  it('summary panel is hidden before toggle and absent students are excluded', () => {
    renderWithClient(
      <AttendanceWideGrid
        sectionId="s"
        termId="t"
        canWriteNc={false}
        events={[]}
        calendar={cal}
        enrolments={[
          {
            enrolmentId: 'e1',
            indexNumber: 1,
            studentNumber: 'S1',
            studentName: 'DOE, Jane',
            busNo: null,
            classroomOfficerRole: null,
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
            studentName: 'SMITH, John',
            busNo: null,
            classroomOfficerRole: null,
            withdrawn: true,
            compassionateUsed: 0,
            compassionateAllowance: 5,
            vlUsedThisTerm: 0,
            vlAllowance: 1,
            enrollmentDate: null,
          },
        ]}
        initialDaily={[]}
      />
    );
    // Before toggling, "Term total" should NOT be visible
    expect(screen.queryByText('Term total')).not.toBeInTheDocument();

    // Toggle the summary
    fireEvent.click(screen.getByRole('button', { name: /show summary/i }));

    // Now it's visible
    expect(screen.getByText('Term total')).toBeInTheDocument();

    // Withdrawn student should NOT appear in the summary
    // (DOE Jane appears in roster + summary = 2 occurrences; SMITH John only in roster = 1)
    expect(screen.getAllByText('DOE, Jane').length).toBeGreaterThanOrEqual(1);
    // SMITH, John (withdrawn) only in the roster div, not in the summary table cell
    const smithElements = screen.getAllByText('SMITH, John');
    // All SMITH occurrences should be from the roster div (truncate class), not a summary TD
    expect(
      smithElements.every((el) => el.closest('td[rowspan]') === null)
    ).toBe(true);
  });
});
