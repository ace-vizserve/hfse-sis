// __tests__/ui/data-table-export-sheet.test.tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { CsvConfig } from '@/components/ui/data-table/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Bravo' },
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
];

const fetchApps = vi.fn(async (keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, { nric: `N${k}`, dob: '2015-01-01' }]))
);
const fetchStatus = vi.fn(async (keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, { applicationStatus: 'Enrolled' }]))
);

const csv: CsvConfig<Row> = {
  filename: 'test.csv',
  rawColumns: {
    keyOf: (r) => r.id,
    sources: [
      { id: 'applications', label: 'Applications', fetch: fetchApps },
      { id: 'status', label: 'Status', fetch: fetchStatus },
    ],
    exportPresets: [
      {
        id: 'record',
        label: 'Full application record',
        sourceIds: ['applications'],
      },
      {
        id: 'full',
        label: 'Full record + pipeline',
        sourceIds: ['applications', 'status'],
      },
    ],
  },
};

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

async function openSheet() {
  const user = userEvent.setup();
  render(
    <DataTable<Row>
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      csv={csv}
    />
  );
  await user.click(screen.getByRole('button', { name: /Export CSV/ }));
  return { user, dialog: await screen.findByRole('dialog') };
}

describe('DataTableExportSheet — preset choice', () => {
  it('shows the row count and defaults to what is on screen', async () => {
    const { dialog } = await openSheet();
    expect(within(dialog).getByText(/2 rows/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('radio', { name: /What's on screen/ })
    ).toBeChecked();
  });

  it('exports only the visible columns under the default option', async () => {
    const getCsv = captureCsv();
    const { user, dialog } = await openSheet();
    await user.click(within(dialog).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(getCsv()).not.toBe(''));
    expect(getCsv().replace(/^﻿/, '').split('\n')[0]).toBe('Student');
    expect(fetchApps).not.toHaveBeenCalled();
  });

  it('loads one source for a single-source preset', async () => {
    const getCsv = captureCsv();
    const { user, dialog } = await openSheet();
    await user.click(
      within(dialog).getByRole('radio', { name: /Full application record/ })
    );
    await user.click(within(dialog).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(getCsv()).not.toBe(''));
    const header = getCsv().replace(/^﻿/, '').split('\n')[0];
    expect(header).toContain('Nric');
    expect(header).not.toContain('Application Status');
    expect(fetchApps).toHaveBeenCalledWith(['1', '2']);
  });

  it('loads both sources for a multi-source preset', async () => {
    const getCsv = captureCsv();
    const { user, dialog } = await openSheet();
    await user.click(
      within(dialog).getByRole('radio', { name: /Full record \+ pipeline/ })
    );
    await user.click(within(dialog).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(getCsv()).not.toBe(''));
    const header = getCsv().replace(/^﻿/, '').split('\n')[0];
    expect(header).toContain('Nric');
    expect(header).toContain('Application Status');
  });
});
