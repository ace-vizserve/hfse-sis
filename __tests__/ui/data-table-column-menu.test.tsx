import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

type Row = { id: string; name: string; levelLabel: string; fcaName: string };

const rows: Row[] = [
  { id: '1', name: 'Obedience', levelLabel: 'P1', fcaName: 'A. Cruz' },
];

// Mirrors the three shapes that actually occur in the app: a plain-string
// header, a render-function header WITH meta.label, and a render-function
// header WITHOUT one (which must fall back to a humanized id, never the raw
// id).
const columns: ColumnDef<Row>[] = [
  { id: 'name', accessorKey: 'name', header: 'Section' },
  {
    id: 'levelLabel',
    accessorKey: 'levelLabel',
    header: ({ column }) => (
      <SortableHeader column={column}>Level</SortableHeader>
    ),
    meta: { label: 'Level' },
  },
  {
    id: 'fcaName',
    accessorKey: 'fcaName',
    header: ({ column }) => (
      <SortableHeader column={column}>Adviser</SortableHeader>
    ),
  },
];

async function openColumnsMenu() {
  const user = userEvent.setup();
  render(
    <DataTable<Row> data={rows} columns={columns} getRowId={(r) => r.id} />
  );
  await user.click(screen.getByRole('button', { name: /Columns/ }));
  return await screen.findByRole('menu');
}

describe('DataTable — Columns visibility menu labels', () => {
  it('shows the string header verbatim', async () => {
    const menu = await openColumnsMenu();
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Section' })
    ).toBeInTheDocument();
  });

  it('shows meta.label for a render-function header', async () => {
    const menu = await openColumnsMenu();
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Level' })
    ).toBeInTheDocument();
    // The regression this whole change exists to prevent.
    expect(within(menu).queryByText('levelLabel')).not.toBeInTheDocument();
  });

  it('never leaks a raw camelCase id, even with no meta.label', async () => {
    const menu = await openColumnsMenu();
    expect(within(menu).queryByText('fcaName')).not.toBeInTheDocument();
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Fca Name' })
    ).toBeInTheDocument();
  });
});
