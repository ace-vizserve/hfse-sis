import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PipelineStrip } from '@/components/sis/pipeline-strip';
import type { StudentListRow } from '@/lib/sis/queries';

// Minimal StudentListRow — only the fields the strip reads matter. A mixed
// bucket spread (done / in_progress / blocked / not_started) so the summary
// + popover content are exercised across all 4 buckets.
const row: StudentListRow = {
  enroleeNumber: 'E-0001',
  studentNumber: null,
  firstName: 'Ada',
  middleName: null,
  lastName: 'Lovelace',
  enroleeFullName: 'Ada Lovelace',
  levelApplied: 'P1',
  classLevel: 'P1',
  classSection: null,
  applicationStatus: 'Processing',
  applicationUpdatedDate: '2026-06-01T00:00:00.000Z',
  created_at: '2026-05-01T00:00:00.000Z',
  enroleeType: null,
  enrolmentDate: null,
  assessmentStatus: 'Ongoing Assessment',
  assessmentGradeMath: null,
  assessmentGradeEnglish: null,
  contractStatus: 'Signed',
  feeStatus: 'Pending',
  registrationStatus: 'Finished',
  documentStatus: 'Incomplete',
  classStatus: null,
  suppliesStatus: null,
  orientationStatus: null,
  registrationUpdateDate: '2026-04-15T00:00:00.000Z',
  documentUpdatedDate: '2026-04-20T00:00:00.000Z',
  assessmentUpdatedDate: null,
  contractUpdatedDate: '2026-05-10T00:00:00.000Z',
  feeUpdatedDate: null,
  classUpdatedDate: null,
  suppliesUpdatedDate: null,
  orientationUpdatedDate: null,
};

describe('PipelineStrip', () => {
  it('renders a trigger with an accessible summary naming the notable stages', () => {
    render(<PipelineStrip row={row} />);
    const trigger = screen.getByRole('button');
    // Documents is blocked (Incomplete); Application + Assessment are
    // in_progress (Processing / Ongoing Assessment) — both should surface in
    // the accessible name so a non-visual read still conveys "what's stuck".
    expect(trigger.getAttribute('aria-label')).toMatch(/Documents/);
    expect(trigger.getAttribute('aria-label')).toMatch(/blocked/);
  });

  it('opens the popover on click and lists all 9 stage labels', async () => {
    const user = userEvent.setup();
    render(<PipelineStrip row={row} />);
    await user.click(screen.getByRole('button'));

    for (const label of [
      'Application',
      'Registration',
      'Documents',
      'Assessment',
      'Contract',
      'Fees',
      'Class assignment',
      'Supplies',
      'Orientation',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Literal status words render, not just the bucket.
    expect(screen.getByText('Signed')).toBeInTheDocument();
    expect(screen.getByText('Incomplete')).toBeInTheDocument();
    // A not_started stage (class/supplies/orientation all null) shows the
    // "Not started" fallback rather than a blank cell.
    expect(screen.getAllByText('Not started').length).toBeGreaterThan(0);
  });

  it('opens the popover via keyboard (Enter on the focused trigger)', async () => {
    const user = userEvent.setup();
    render(<PipelineStrip row={row} />);
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Pipeline · 9 stages')).toBeInTheDocument();
  });
});
