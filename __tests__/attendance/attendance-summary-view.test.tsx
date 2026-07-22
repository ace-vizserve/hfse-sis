import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AttendanceSummaryView } from '@/components/attendance/summary/attendance-summary-view';
import { DEFAULT_AWARD_THRESHOLDS } from '@/lib/compute/awards';
import type { MasterfilePayload } from '@/lib/markbook/masterfile';

// The shared <DataTable> shell's url-state hook calls useRouter/usePathname/
// useSearchParams — mock next/navigation so it renders outside an app router
// (matches the pattern used by other DataTable-consumer tests, e.g.
// __tests__/markbook/awards-summary-view.test.tsx).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/attendance/summary',
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

describe('AttendanceSummaryView', () => {
  it('renders the four stat cards', () => {
    render(<AttendanceSummaryView payload={makePayload()} />);
    expect(screen.getByText('Avg rate')).toBeInTheDocument();
    expect(screen.getByText('≥ 95%')).toBeInTheDocument();
    expect(screen.getByText('< 85%')).toBeInTheDocument();
    expect(screen.getByText('Absences')).toBeInTheDocument();
  });
});
