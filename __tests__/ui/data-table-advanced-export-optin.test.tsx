// __tests__/ui/data-table-advanced-export-optin.test.tsx
//
// The Phase 1 gate for the advanced export sheet, kept as a permanent guard.
//
// KD #162 removed a shared five-section export sheet because 14 of the 16
// exporting tables had nothing to configure — they download instantly, with
// no dialog. The advanced sheet exists only for the exception KD #162 itself
// named, and is reached solely through `csv.advanced`. If that flag ever
// stops gating it, fifteen tables silently regain a dialog asking five
// questions with one possible answer.
//
// So this asserts the branch both ways: absent → the simple path, present →
// the advanced one.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';

import { DataTable } from '@/components/ui/data-table';

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
  { id: 'name', accessorKey: 'name', header: 'Student' },
  { id: 'level', accessorKey: 'level', header: 'Level' },
];

const rawColumns = {
  keyOf: (r: Row) => r.id,
  sources: [
    {
      id: 'applications',
      label: 'Applications',
      fetch: async () => ({
        '1': { nationality: 'Singapore' },
        '2': { nationality: 'Philippines' },
      }),
    },
  ],
};

describe('advanced export is opt-in', () => {
  it('downloads instantly with no dialog when csv declares nothing extra', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'plain.csv' }}
      />
    );

    await user.click(screen.getByRole('button', { name: /export csv/i }));

    // No sheet of any kind — this is the behaviour KD #162 bought for the
    // fourteen tables with nothing to configure.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(
      screen.queryByText(/drag to set column order/i)
    ).not.toBeInTheDocument();
  });

  it('opens the preset radio sheet — not the advanced one — for raw columns without the flag', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{
          filename: 'presets.csv',
          rawColumns: {
            ...rawColumns,
            exportPresets: [
              {
                id: 'record',
                label: 'Full record',
                sourceIds: ['applications'],
              },
            ],
          },
        }}
      />
    );

    await user.click(screen.getByRole('button', { name: /export csv/i }));

    expect(await screen.findByText(/what's on screen/i)).toBeInTheDocument();
    // The advanced sheet's own furniture must be absent.
    expect(
      screen.queryByText(/drag to set column order/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /add field/i })
    ).not.toBeInTheDocument();
  });

  it('opens the advanced sheet only when csv.advanced is set', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'advanced.csv', advanced: true, rawColumns }}
      />
    );

    await user.click(screen.getByRole('button', { name: /export csv/i }));

    expect(
      await screen.findByText(/drag to set column order/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /add field/i })
    ).toBeInTheDocument();
    // And the preset radio group it replaces is gone.
    expect(screen.queryByText(/what's on screen/i)).not.toBeInTheDocument();
  });

  it('puts the row count on the button you press', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'advanced.csv', advanced: true }}
      />
    );

    await user.click(screen.getByRole('button', { name: /export csv/i }));

    // The count lives on the action rather than in a banner above it — you
    // read how many rows you are about to get on the control that gets them.
    expect(
      await screen.findByRole('button', { name: /download 2 rows/i })
    ).toBeInTheDocument();
  });

  it('starts with the visible columns already chosen, in screen order', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'advanced.csv', advanced: true }}
      />
    );

    await user.click(screen.getByRole('button', { name: /export csv/i }));

    // Both on-screen columns arrive pre-selected — an untouched advanced
    // export must match what the plain export would have produced.
    expect(
      await screen.findByRole('button', { name: /reorder student/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /reorder level/i })
    ).toBeInTheDocument();
  });
});
