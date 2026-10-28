/**
 * The Book list page's DataTable: rows in the list's own order, Books /
 * Supplies tabs, and edit controls for writers only.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BookListTable } from '@/components/admissions/book-list-table';
import type { LevelSupplyGroup } from '@/lib/sis/supplies/level-counts';
import { renderWithClient } from '../_utils/render-with-client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admissions/book-list',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => vi.clearAllMocks());

const base = {
  meta: null,
  handedOver: 0,
  publisher: null,
  isbn: null,
  classType: null,
  levelId: 'level-p5',
};
const GROUPS: LevelSupplyGroup[] = [
  {
    name: 'English',
    kind: 'book',
    items: [
      {
        ...base,
        id: 'b1',
        kind: 'book',
        title: 'Grammar P5',
        subject: 'English',
        publisher: 'Star',
        isbn: '978-1',
        classType: 'Global',
        given: 3,
        students: 10,
      },
    ],
  },
  {
    name: 'Supplies',
    kind: 'supply',
    items: [
      {
        ...base,
        id: 's1',
        kind: 'supply',
        title: 'Pencil',
        subject: null,
        levelId: null,
        given: 0,
        students: 10,
      },
    ],
  },
];

function renderTable(canEdit: boolean) {
  return renderWithClient(
    <BookListTable
      groups={GROUPS}
      ayCode="AY2027"
      level={{ id: 'level-p5', label: 'Primary Five', levelType: 'primary' }}
      subjects={['English']}
      track="Global"
      canEdit={canEdit}
      showCounts
    />
  );
}

describe('BookListTable', () => {
  it('lists books then supplies, with subject, track and given', () => {
    renderTable(true);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Grammar P5')).toBeTruthy();
    expect(within(rows[0]).getByText('Global')).toBeTruthy();
    expect(within(rows[0]).getByText('978-1')).toBeTruthy();
    expect(within(rows[1]).getByText('Supplies')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'Grammar P5 given' })
    ).toHaveAttribute('aria-valuenow', '3');
  });

  it('the Supplies tab shows only supplies', async () => {
    renderTable(true);
    await userEvent
      .setup()
      .click(screen.getByRole('tab', { name: /Supplies/ }));
    expect(screen.queryByText('Grammar P5')).toBeNull();
    expect(screen.getByText('Pencil')).toBeTruthy();
  });

  it('writers get Add book / Add supply and row actions; viewers get neither', () => {
    const { unmount } = renderTable(true);
    expect(screen.getByRole('button', { name: 'Add book' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add supply' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Actions for Pencil' })
    ).toBeTruthy();
    unmount();

    renderTable(false);
    expect(screen.queryByRole('button', { name: 'Add book' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Actions for Pencil' })
    ).toBeNull();
  });
});
