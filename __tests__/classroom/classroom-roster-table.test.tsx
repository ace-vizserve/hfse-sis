/**
 * The roster rendered every student name as a link to the permanent record,
 * unconditionally. `/records` is registrar-and-above, so a form adviser
 * clicking a student on their own roster was bounced to `/`.
 *
 * student-record-link.test.ts pins the capability<->ROUTE_ACCESS agreement;
 * this file pins what the component actually renders, which is the assertion
 * that would have caught the original defect on its own.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ClassroomRosterTable,
  type ClassroomRosterRow,
} from '@/components/classroom/classroom-roster-table';

// The table is a client component whose only browser dependency is the
// student-order preference (localStorage). Pin it to index order so the
// rendered rows are deterministic.
vi.mock('@/lib/classroom/use-student-order', () => ({
  useStudentOrder: () => ['index', vi.fn()],
}));

const ROWS: ClassroomRosterRow[] = [
  {
    id: 'ss-1',
    student_id: 'stu-1',
    index_number: 1,
    student_number: 'S12345',
    student_name: 'Reyes, Ana',
    enrollment_status: 'active',
  },
];

describe('<ClassroomRosterTable> student-record link', () => {
  it('renders the name as plain text when the viewer cannot open the record', () => {
    render(
      <ClassroomRosterTable
        sectionId="sec-1"
        data={ROWS}
        showRecordLink={false}
      />
    );

    expect(screen.getByText('Reyes, Ana')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Reyes, Ana' })
    ).not.toBeInTheDocument();
  });

  it('links to the record when the viewer can open it', () => {
    render(
      <ClassroomRosterTable
        sectionId="sec-1"
        data={ROWS}
        showRecordLink={true}
      />
    );

    const link = screen.getByRole('link', { name: 'Reyes, Ana' });
    expect(link).toHaveAttribute('href', '/records/students/S12345');
  });

  it('never links to /records anywhere on the row when withheld', () => {
    // Broader than the name check: guards against a second link to the same
    // place appearing elsewhere in the row (the report-card button, a future
    // column) without its own gate.
    const { container } = render(
      <ClassroomRosterTable
        sectionId="sec-1"
        data={ROWS}
        showRecordLink={false}
        showReportCard
      />
    );

    const recordLinks = Array.from(
      container.querySelectorAll('a[href]')
    ).filter((a) => (a.getAttribute('href') ?? '').startsWith('/records'));
    expect(recordLinks).toEqual([]);
  });
});
