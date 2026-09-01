import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CommentsSummaryView } from '@/components/evaluation/comments/comments-summary-view';
import { DEFAULT_AWARD_THRESHOLDS } from '@/lib/compute/awards';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
} from '@/lib/markbook/masterfile';

// The shared <DataTable> shell's url-state hook calls useRouter/usePathname/
// useSearchParams — mock next/navigation so it renders outside an app router
// (matches the pattern used by other DataTable-consumer tests, e.g.
// __tests__/markbook/awards-summary-view.test.tsx).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/evaluation/comments',
  useSearchParams: () => new URLSearchParams(),
}));

// Minimal payload factory — same field shape as buildPayload() in
// __tests__/markbook/academic-summary-views.test.ts. This is a render smoke
// test only, so the roster is left empty.
function makePayload(): MasterfilePayload {
  return {
    ayCode: 'AY9999',
    level: { id: 'lv1', code: 'P6', label: 'Primary 6' },
    subjects: [],
    terms: [
      { id: 't1', termNumber: 1, label: 'Term 1' },
      { id: 't2', termNumber: 2, label: 'Term 2' },
      { id: 't3', termNumber: 3, label: 'Term 3' },
      { id: 't4', termNumber: 4, label: 'Term 4' },
    ],
    sections: [{ id: 'sec-1', name: 'P6 Diamond' }],
    selectedSectionIds: ['sec-1'],
    rows: [],
    sheets: [],
    thresholds: DEFAULT_AWARD_THRESHOLDS,
  };
}

// One student carrying a single T1 write-up. Everything the Comment column
// needs and nothing else — no subjects, no grades, no attendance.
function studentWithComment(text: string): MasterfileStudentRow {
  return {
    studentId: 'stu-1',
    studentNumber: 'S0001',
    fullName: 'Tan, Alice',
    sectionId: 'sec-1',
    sectionName: 'P6 Diamond',
    formClassAdviser: 'Ms Lee',
    enrollmentStatus: 'active',
    indexNumber: 1,
    subjectRows: [],
    generalAverage: null,
    overallAward: null,
    attendanceByTerm: [],
    attendanceTotal: { present: 0, late: 0, excused: 0, schoolDays: 0 },
    commentsByTerm: [{ termNumber: 1, text, submitted: true }],
    lateEnrolleeTermNumber: null,
    enrolledTermNumbers: [1, 2, 3, 4],
  };
}

describe('CommentsSummaryView', () => {
  it('renders the four stat cards', () => {
    render(<CommentsSummaryView payload={makePayload()} />);
    expect(screen.getByText('Submitted %')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
  });

  // The write-up is formatted text now. The Comment cell clamps it to two
  // lines, and the same value is what the table sorts, filters and exports —
  // so markup here reaches the registrar's downloaded CSV, not just the screen.
  it('shows the write-up as prose, not as markup', () => {
    const payload = makePayload();
    payload.rows = [
      studentWithComment(
        '<p><strong>Alice</strong> is <em>improving</em>.</p>'
      ),
    ];

    const { container } = render(<CommentsSummaryView payload={payload} />);

    expect(screen.getByText('Alice is improving.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('<strong>');
    expect(container.textContent).not.toContain('<em>');
  });

  it('flattens a bulleted write-up into readable lines', () => {
    const payload = makePayload();
    payload.rows = [
      studentWithComment(
        '<ul><li><p>Leads group work</p></li><li><p>Written fluency</p></li></ul>'
      ),
    ];

    const { container } = render(<CommentsSummaryView payload={payload} />);

    expect(container.textContent).not.toContain('<li>');
    expect(
      screen.getByText('Leads group work Written fluency')
    ).toBeInTheDocument();
  });

  it('leaves a write-up saved before the editor existed unchanged', () => {
    const payload = makePayload();
    payload.rows = [studentWithComment('Alice is improving.')];

    render(<CommentsSummaryView payload={payload} />);

    expect(screen.getByText('Alice is improving.')).toBeInTheDocument();
  });
});
