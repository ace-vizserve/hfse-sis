import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/classroom/sow',
  useSearchParams: () => new URLSearchParams(),
}));

import {
  MySowsTable,
  type MySowListRow,
  SowStatusBadge,
} from '@/components/sow/my-sows-table';

// The words on "My schemes of work" (board 1). Teachers learn the screen by
// these labels, so a rename is a decision, not a drift.

const base = {
  termId: '00000000-0000-4000-8000-000000000001',
  subjectId: '00000000-0000-4000-8000-000000000002',
  track: 'Standard' as const,
  subjectName: 'Science',
  myClassesNotOnSow: [],
  lastYear: null,
  groupSections: [],
};

const row = (
  levelLabel: string,
  sow: MySowListRow['sow'],
  extra: Partial<MySowListRow> = {}
): MySowListRow => ({
  ...base,
  levelId: `level-${levelLabel}`,
  levelLabel,
  classes: [{ sectionId: `s-${levelLabel}`, name: `${levelLabel} Class` }],
  sow,
  ...extra,
});

describe('SowStatusBadge', () => {
  it.each([
    [{ state: 'draft' as const }, 'Draft'],
    [{ state: 'in_review' as const, step: 'OIC' }, 'In review · OIC'],
    [{ state: 'returned' as const }, 'Returned'],
    [{ state: 'approved' as const }, 'Approved'],
    [{ state: null }, 'Not started'],
  ])('%o reads %s', (props, text) => {
    render(<SowStatusBadge {...props} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});

describe('MySowsTable', () => {
  const rows: MySowListRow[] = [
    row('Secondary 1', { id: 'a', state: 'approved' }),
    row('Secondary 2', { id: 'b', state: 'in_review' }),
    row('Secondary 3', { id: 'c', state: 'returned' }),
    row(
      'Secondary 4',
      { id: 'd', state: 'draft' },
      {
        myClassesNotOnSow: [{ sectionId: 'x', name: 'Excellence 2' }],
      }
    ),
    row('Secondary 5', null),
  ];

  it('names each row action and the "This week" state', () => {
    render(<MySowsTable rows={rows} termLabel="Term 2" />);
    const rowFor = (level: string) =>
      screen.getByText(new RegExp(`· ${level} ·`)).closest('tr') as HTMLElement;

    expect(within(rowFor('Secondary 1')).getByText('Open')).toBeInTheDocument();
    expect(
      within(rowFor('Secondary 2')).getByText("Can't be checked until approved")
    ).toBeInTheDocument();
    expect(
      within(rowFor('Secondary 3')).getByText('Fix and resend')
    ).toBeInTheDocument();
    expect(
      within(rowFor('Secondary 3')).getByText('Returned with a note')
    ).toBeInTheDocument();
    expect(
      within(rowFor('Secondary 4')).getByText('Not sent for review yet')
    ).toBeInTheDocument();
    expect(
      within(rowFor('Secondary 4')).getByText(
        "Your class Excellence 2 isn't on this scheme of work."
      )
    ).toBeInTheDocument();
    expect(
      within(rowFor('Secondary 5')).getByRole('button', { name: 'Start SOW' })
    ).toBeInTheDocument();
    expect(
      within(rowFor('Secondary 5')).getByText('Not started')
    ).toBeInTheDocument();
  });
});
