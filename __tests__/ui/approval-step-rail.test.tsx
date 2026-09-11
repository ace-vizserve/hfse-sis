import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  ApprovalStepRail,
  ApprovalStepStrip,
} from '@/components/approvals/approval-step-rail';
import type { ApprovalRailStage } from '@/lib/approvals/rail';

// The rail moved out of the declaration decision sheet so grade changes could
// share it (migration 144). These pin that it still tells a declaration's
// story in the sheet's own words, and that the one new status — a step closed
// by a withdrawal — reads as cancelled rather than as "not yet".

const stage = (
  stageOrder: number,
  label: string,
  status: ApprovalRailStage['status'],
  extra: Partial<ApprovalRailStage> = {}
): ApprovalRailStage => ({
  stageOrder,
  label,
  resolver: 'named',
  status,
  decidedAt: null,
  decisionNote: null,
  ...extra,
});

describe('ApprovalStepRail', () => {
  it('tells a declaration’s turned-down ladder in the sheet’s words', () => {
    render(
      <ApprovalStepRail
        stages={[
          stage(1, 'Form class adviser', 'rejected', {
            resolver: 'form_adviser',
            decidedAt: '2026-08-27T02:00:00.000Z',
            decisionNote: '<p>Please send the certificate.</p>',
          }),
          stage(2, 'Officer in charge', 'waiting'),
        ]}
        peopleByStageOrder={{ 2: 'Elaine Wee' }}
        decidedByNames={{ 1: 'Radhika Putrevu' }}
      />
    );

    expect(
      screen.getByText(/Turned down by Radhika Putrevu/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Never reached — the filing was turned down before this step.'
      )
    ).toBeInTheDocument();
    // The note is quoted as plain text, never as markup.
    expect(
      screen.getByText('“Please send the certificate.”')
    ).toBeInTheDocument();
  });

  it('reads a withdrawn step as cancelled, and every step after it as never reached', () => {
    render(
      <ApprovalStepRail
        stages={[
          stage(1, 'Head of Department', 'approved', {
            decidedAt: '2026-09-10T02:00:00.000Z',
          }),
          stage(2, 'Principal', 'cancelled'),
          stage(3, 'Board chair', 'waiting'),
        ]}
        peopleByStageOrder={{ 1: 'Ms Joann', 2: 'Ms Christina', 3: 'Mr Tan' }}
        decidedByNames={{ 1: 'Ms Joann' }}
        subjectNoun="request"
      />
    );

    expect(
      screen.getByText(
        'Cancelled — the request was withdrawn while it waited here.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Never reached — the request was withdrawn before this step.'
      )
    ).toBeInTheDocument();
    // Nobody decided the cancelled step, so nobody is named on it.
    expect(screen.queryByText(/Ms Christina/)).not.toBeInTheDocument();
  });

  it('warns when a live step has nobody on it', () => {
    render(
      <ApprovalStepRail
        stages={[stage(1, 'Principal', 'pending')]}
        peopleByStageOrder={{}}
        decidedByNames={{}}
      />
    );
    expect(
      screen.getByText(
        'Nobody has been added to this step yet, so it will stop here.'
      )
    ).toBeInTheDocument();
  });
});

describe('ApprovalStepRail — a step that needs everyone (migration 145)', () => {
  const everyone = (
    status: ApprovalRailStage['status'],
    people: ApprovalRailStage['people'],
    extra: Partial<ApprovalRailStage> = {}
  ) =>
    stage(2, 'Academic and Examination Board', status, {
      approvalRule: 'all',
      people,
      ...extra,
    });

  it('says how many have approved, and ticks each person who has', () => {
    render(
      <ApprovalStepRail
        stages={[
          stage(1, 'Form class adviser', 'approved', {
            resolver: 'form_adviser',
            decidedAt: '2026-09-09T02:00:00.000Z',
          }),
          everyone('pending', [
            { name: 'Mr Gary', approvedAt: '2026-09-10T02:00:00.000Z' },
            { name: 'Ms Nina', approvedAt: null },
            { name: 'Mr Tan', approvedAt: null },
          ]),
        ]}
        peopleByStageOrder={{ 2: 'Mr Gary, Ms Nina, Mr Tan' }}
        decidedByNames={{ 1: 'Ms Joann' }}
        subjectNoun="request"
      />
    );

    expect(screen.getByText('1 of 3 approved')).toBeInTheDocument();
    const ticks = screen.getByRole('list', {
      name: 'Who has approved Academic and Examination Board',
    });
    const rows = within(ticks).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Mr Gary.*approved/),
      'Ms Ninanot yet',
      'Mr Tannot yet',
    ]);
  });

  it('reads a finished "everyone" step as approved by everyone, not by one name', () => {
    render(
      <ApprovalStepRail
        stages={[
          everyone(
            'approved',
            [
              { name: 'Mr Gary', approvedAt: '2026-09-10T02:00:00.000Z' },
              { name: 'Ms Nina', approvedAt: '2026-09-10T03:00:00.000Z' },
            ],
            { decidedAt: '2026-09-10T03:00:00.000Z' }
          ),
        ]}
        peopleByStageOrder={{}}
        decidedByNames={{ 2: 'Ms Nina' }}
      />
    );
    expect(
      screen.getByText(/Approved by everyone on this step/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/not yet/)).not.toBeInTheDocument();
  });

  it('shows each approver’s own note under their tick, as plain text', () => {
    render(
      <ApprovalStepRail
        stages={[
          everyone('pending', [
            {
              name: 'Mr Gary',
              approvedAt: '2026-09-10T02:00:00.000Z',
              note: '<p>Checked against the <strong>paper</strong> script.</p>',
            },
            { name: 'Ms Nina', approvedAt: null },
          ]),
        ]}
        peopleByStageOrder={{}}
        decidedByNames={{}}
      />
    );
    const ticks = screen.getByRole('list', {
      name: 'Who has approved Academic and Examination Board',
    });
    const [gary, nina] = within(ticks).getAllByRole('listitem');
    expect(
      within(gary).getByText('“Checked against the paper script.”')
    ).toBeInTheDocument();
    expect(gary.innerHTML).not.toContain('&lt;p&gt;');
    expect(nina.textContent).toBe('Ms Ninanot yet');
  });

  it('quotes the last approver’s note once, under their tick, on a finished step', () => {
    render(
      <ApprovalStepRail
        stages={[
          everyone(
            'approved',
            [
              { name: 'Mr Gary', approvedAt: '2026-09-10T02:00:00.000Z' },
              {
                name: 'Ms Nina',
                approvedAt: '2026-09-10T03:00:00.000Z',
                note: '<p>All in order.</p>',
              },
            ],
            {
              decidedAt: '2026-09-10T03:00:00.000Z',
              // The step row keeps the closer's words too.
              decisionNote: '<p>All in order.</p>',
            }
          ),
        ]}
        peopleByStageOrder={{}}
        decidedByNames={{ 2: 'Ms Nina' }}
      />
    );
    expect(screen.getAllByText('“All in order.”')).toHaveLength(1);
  });

  it('names a step not yet reached with "and"', () => {
    render(
      <ApprovalStepRail
        stages={[
          stage(1, 'Form class adviser', 'pending', {
            resolver: 'form_adviser',
          }),
          everyone('waiting', [
            { name: 'Mr Gary', approvedAt: null },
            { name: 'Ms Nina', approvedAt: null },
          ]),
        ]}
        peopleByStageOrder={{}}
        decidedByNames={{}}
      />
    );
    expect(
      screen.getByText('Mr Gary and Ms Nina — everyone must approve.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /Who has approved/ })).toBeNull();
  });

  it('still warns when an "everyone" step has nobody on it', () => {
    render(
      <ApprovalStepRail
        stages={[everyone('pending', [])]}
        peopleByStageOrder={{}}
        decidedByNames={{}}
      />
    );
    expect(
      screen.getByText(
        'Nobody has been added to this step yet, so it will stop here.'
      )
    ).toBeInTheDocument();
  });
});

describe('ApprovalStepStrip', () => {
  it('captions a live "everyone" step with the count', () => {
    render(
      <ApprovalStepStrip
        stages={[
          stage(1, 'Head of Department', 'approved'),
          stage(2, 'Principal', 'approved'),
          stage(3, 'Board', 'pending', {
            approvalRule: 'all',
            people: [
              { name: 'Mr Gary', approvedAt: '2026-09-10T02:00:00.000Z' },
              { name: 'Ms Nina', approvedAt: null },
            ],
          }),
          stage(4, 'Chair', 'waiting'),
        ]}
        peopleByStageOrder={{ 3: 'Mr Gary, Ms Nina' }}
      />
    );
    expect(
      screen.getByText('Waiting on step 3 of 4 — 1 of 2 approved')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Step 3, Board: Waiting for a decision, 1 of 2 approved')
    ).toBeInTheDocument();
  });

  it('draws one tile per step, each named for a screen reader, with the live step as its caption', () => {
    render(
      <ApprovalStepStrip
        stages={[
          stage(1, 'Head of Department', 'approved'),
          stage(2, 'Principal', 'pending'),
          stage(3, 'Board chair', 'waiting'),
        ]}
        peopleByStageOrder={{ 2: 'Ms Christina' }}
      />
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(
      screen.getByText('Step 1, Head of Department: Approved')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Step 2, Principal: Waiting for a decision')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Waiting on step 2 of 3 — Ms Christina')
    ).toBeInTheDocument();
  });
});
