// __tests__/ui/data-table-instant-export.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

type Row = { id: string; name: string; level: string };

const rows: Row[] = [
  { id: '1', name: 'Alpha', level: 'P1' },
  { id: '2', name: 'Bravo', level: 'P2' },
];

const columns: ColumnDef<Row>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: ({ column }) => (
      <SortableHeader column={column}>Student</SortableHeader>
    ),
    meta: { label: 'Student' },
  },
  { id: 'level', accessorKey: 'level', header: 'Level' },
];

// `selection={{ enabled: true }}` only turns on TanStack's row-selection
// state (see `components/ui/data-table/index.tsx`'s `enableRowSelection`) —
// the checkbox column itself is always supplied by the consumer's own
// `columns` array (mirrors the real `SELECT_COLUMN` pattern in
// `app/(markbook)/markbook/grading/grading-data-table.tsx`), never injected
// by the shell. The instant-export narrowing test needs one to tick a row.
const columnsWithSelection: ColumnDef<Row>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllRowsSelected()}
        onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  ...columns,
];

function captureCsv() {
  let text = '';
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    (obj: Blob | MediaSource) => {
      void (obj as Blob).text().then((t) => {
        text = t;
      });
      return 'blob:mock';
    }
  );
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return () => text;
}

describe('DataTable — instant CSV export (no rawColumns)', () => {
  it('downloads on click without opening a dialog', async () => {
    const user = userEvent.setup();
    const getCsv = captureCsv();

    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'test.csv' }}
      />
    );

    await user.click(screen.getByRole('button', { name: /Export CSV/ }));

    await waitFor(() => expect(getCsv()).not.toBe(''));
    const lines = getCsv().replace(/^﻿/, '').split('\n');
    expect(lines[0]).toBe('Student,Level');
    expect(lines[1]).toBe('Alpha,P1');

    // The whole point: no sheet.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('narrows to ticked rows when a selection is active', async () => {
    const user = userEvent.setup();
    const getCsv = captureCsv();

    render(
      <DataTable<Row>
        data={rows}
        columns={columnsWithSelection}
        getRowId={(r) => r.id}
        csv={{ filename: 'test.csv' }}
        selection={{ enabled: true }}
      />
    );

    // Tick the first data row (checkbox 0 is the header select-all).
    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[1]);
    await user.click(screen.getByRole('button', { name: /Export CSV/ }));

    await waitFor(() => expect(getCsv()).not.toBe(''));
    const lines = getCsv().replace(/^﻿/, '').split('\n');
    expect(lines).toHaveLength(2); // header + the one ticked row
    expect(lines[1]).toBe('Alpha,P1');
  });
});
