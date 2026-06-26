import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import type { StatusTabConfig } from '@/components/ui/data-table/types';

// Radix Tabs respond to real pointer/keyboard events, not synthetic
// fireEvent.click — drive the switch with user-event so onValueChange fires.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

type Row = { id: string; name: string; status: 'A' | 'B' };

const rows: Row[] = [
  { id: '1', name: 'Alpha', status: 'A' },
  { id: '2', name: 'Bravo', status: 'A' },
  { id: '3', name: 'Charlie', status: 'B' },
  { id: '4', name: 'Delta', status: 'B' },
  { id: '5', name: 'Echo', status: 'B' },
];

const columns: ColumnDef<Row>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: 'Name',
    cell: (c) => c.row.original.name,
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: 'Status',
    cell: (c) => c.row.original.status,
  },
];

const statusTabs: Array<StatusTabConfig<Row>> = [
  {
    value: 'A',
    label: 'Status A',
    predicate: (r) => r.status === 'A',
    isDefault: true,
  },
  { value: 'B', label: 'Status B', predicate: (r) => r.status === 'B' },
];

/** First-column text of every body (non-header) row currently in the DOM. */
function bodyNames(): string[] {
  const allRows = screen.getAllByRole('row');
  const dataRows = allRows.filter(
    (r) => within(r).queryAllByRole('columnheader').length === 0
  );
  return dataRows
    .map((r) => within(r).queryAllByRole('cell')[0]?.textContent ?? '')
    .filter((t) => t.length > 0);
}

async function switchToTabB(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: /Status B/ }));
  // Wait for Radix to flip aria-selected so the state change has propagated.
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: /Status B/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  );
}

describe('DataTable status-tab switching replaces rows (WITH getRowId)', () => {
  it('shows only the new tab rows after switching, not appended', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        statusTabs={statusTabs}
      />
    );

    expect(bodyNames().sort()).toEqual(['Alpha', 'Bravo']);

    await switchToTabB(user);

    expect(bodyNames().sort()).toEqual(['Charlie', 'Delta', 'Echo']);
  });
});

describe('DataTable status-tab switching replaces rows (WITHOUT getRowId — index ids)', () => {
  it('shows only the new tab rows after switching, not appended', async () => {
    const user = userEvent.setup();
    // Omit getRowId so TanStack falls back to index-based row ids — the
    // suspected repro for React retaining/duplicating row DOM across the
    // data change.
    const props = {
      data: rows,
      columns,
      statusTabs,
    } as unknown as React.ComponentProps<typeof DataTable<Row>>;

    render(<DataTable<Row> {...props} />);

    expect(bodyNames().sort()).toEqual(['Alpha', 'Bravo']);

    await switchToTabB(user);

    expect(bodyNames().sort()).toEqual(['Charlie', 'Delta', 'Echo']);
  });
});

describe('DataTable status-tab switching with pagination (WITHOUT getRowId)', () => {
  it('replaces rows across a tab switch when pagination is active', async () => {
    const user = userEvent.setup();
    // pageSize 2 so tab A (2 rows) fills page 1 exactly; switching to tab B
    // (3 rows) must show B's rows, never A's leftovers.
    const props = {
      data: rows,
      columns,
      statusTabs,
      pageSize: 2,
    } as unknown as React.ComponentProps<typeof DataTable<Row>>;

    render(<DataTable<Row> {...props} />);

    expect(bodyNames().sort()).toEqual(['Alpha', 'Bravo']);

    await switchToTabB(user);

    // page 1 of B at pageSize 2 — must be a subset of B only, never A's rows.
    const after = bodyNames();
    expect(after).not.toContain('Alpha');
    expect(after).not.toContain('Bravo');
    after.forEach((n) => expect(['Charlie', 'Delta', 'Echo']).toContain(n));
  });
});
