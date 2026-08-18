// __tests__/ui/data-table-advanced-export-fields.test.tsx
//
// Phase 2 of the advanced export sheet: choosing fields, ordering them, and
// what actually lands in the file.
//
// The rule worth defending here is KD #162's: object-valued columns are
// dropped entirely rather than JSON-stringified, and the probe must scan
// EVERY value rather than the first non-null one. `residenceHistory` is a
// JSON string on some production rows and a real array on others, so a
// first-value sample made the drop depend on which row happened to sort
// first — the same table could emit or omit the column run to run.
import { render, screen, waitFor, within } from '@testing-library/react';
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

/** A raw source whose payload mixes an object-valued column in on ONE row
 *  only — the shape that broke first-value sampling. */
const mixedRawColumns = {
  keyOf: (r: Row) => r.id,
  sources: [
    {
      id: 'applications',
      label: 'Applications',
      fetch: async () => ({
        // Row 1 has a plain string for residenceHistory…
        '1': { nationality: 'Singapore', residenceHistory: '[]' },
        // …and row 2 has a real array. Either row could sort first.
        '2': { nationality: 'Philippines', residenceHistory: [{ a: 1 }] },
      }),
    },
  ],
};

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /export csv/i }));
  await screen.findByText(/drag to set column order/i, undefined, {
    timeout: 8000,
  });
}

describe('advanced export — fields', () => {
  it('exports the pre-selected on-screen columns unchanged', async () => {
    const user = userEvent.setup();
    const getCsv = captureCsv();

    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'a.csv', advanced: true }}
      />
    );

    await openSheet(user);
    await user.click(screen.getByRole('button', { name: /^download \d/i }));

    await waitFor(() => expect(getCsv()).not.toBe(''));
    const lines = getCsv().replace(/^﻿/, '').split('\n');
    expect(lines[0]).toBe('Student,Level');
    expect(lines).toHaveLength(3);
  });

  it('removes a field from the file when it is removed from the list', async () => {
    const user = userEvent.setup();
    const getCsv = captureCsv();

    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'a.csv', advanced: true }}
      />
    );

    await openSheet(user);
    await user.click(screen.getByRole('button', { name: /remove level/i }));
    await user.click(screen.getByRole('button', { name: /^download \d/i }));

    await waitFor(() => expect(getCsv()).not.toBe(''));
    expect(getCsv().replace(/^﻿/, '').split('\n')[0]).toBe('Student');
  });

  it('will not download with no fields chosen', async () => {
    const user = userEvent.setup();

    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'a.csv', advanced: true }}
      />
    );

    await openSheet(user);
    await user.click(screen.getByRole('button', { name: /remove student/i }));
    await user.click(screen.getByRole('button', { name: /remove level/i }));

    expect(await screen.findByText(/no fields chosen/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^download \d/i })
    ).toBeDisabled();
  });

  it('offers raw database fields only after their source is loaded', async () => {
    const user = userEvent.setup();

    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'a.csv', advanced: true, rawColumns: mixedRawColumns }}
      />
    );

    await openSheet(user);
    await user.click(screen.getByRole('button', { name: /add field/i }));

    // Before loading, the source's group offers the load action, not fields.
    expect(
      await screen.findByRole('option', {
        name: /load all applications fields/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /^Nationality$/ })
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('option', { name: /load all applications fields/i })
    );

    // The menu stays open while the source loads, then fills in place.
    expect(
      await screen.findByRole('option', { name: /^Nationality$/ })
    ).toBeInTheDocument();
  });

  it('drops an object-valued raw column whichever row carries the object', async () => {
    const user = userEvent.setup();

    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'a.csv', advanced: true, rawColumns: mixedRawColumns }}
      />
    );

    await openSheet(user);
    await user.click(screen.getByRole('button', { name: /add field/i }));
    await user.click(
      await screen.findByRole('option', {
        name: /load all applications fields/i,
      })
    );

    // `nationality` survives; `residenceHistory` is gone even though only the
    // SECOND row holds an object for it.
    expect(
      await screen.findByRole('option', { name: /^Nationality$/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /residence history/i })
    ).not.toBeInTheDocument();
  });

  it('adds a raw field to the end of the export order', async () => {
    const user = userEvent.setup();
    const getCsv = captureCsv();

    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'a.csv', advanced: true, rawColumns: mixedRawColumns }}
      />
    );

    await openSheet(user);
    await user.click(screen.getByRole('button', { name: /add field/i }));
    await user.click(
      await screen.findByRole('option', {
        name: /load all applications fields/i,
      })
    );
    await user.click(
      await screen.findByRole('option', { name: /^Nationality$/ })
    );

    await user.click(screen.getByRole('button', { name: /^download \d/i }));
    await waitFor(() => expect(getCsv()).not.toBe(''));

    const lines = getCsv().replace(/^﻿/, '').split('\n');
    expect(lines[0]).toBe('Student,Level,Nationality');
    // And the values resolve per row, not off the first one.
    expect(lines[1]).toContain('Singapore');
    expect(lines[2]).toContain('Philippines');
  });

  it('adds every remaining field at once, and names the count', async () => {
    const user = userEvent.setup();
    const getCsv = captureCsv();

    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'a.csv', advanced: true, rawColumns: mixedRawColumns }}
      />
    );

    await openSheet(user);
    // Both on-screen columns start selected, so only the raw ones remain.
    await user.click(screen.getByRole('button', { name: /add field/i }));
    await user.click(
      await screen.findByRole('option', {
        name: /load all applications fields/i,
      })
    );

    // `residenceHistory` was dropped as object-valued, so "all" is the one
    // field actually on offer — the label says so rather than claiming more.
    await user.click(
      await screen.findByRole('option', { name: /add all 1 field/i })
    );

    await user.click(screen.getByRole('button', { name: /^download \d/i }));
    await waitFor(() => expect(getCsv()).not.toBe(''));
    expect(getCsv().replace(/^﻿/, '').split('\n')[0]).toBe(
      'Student,Level,Nationality'
    );
  });

  it('offers no select-all in the filter picker', async () => {
    const user = userEvent.setup();

    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'a.csv', advanced: true }}
      />
    );

    await openSheet(user);
    await user.click(screen.getByRole('button', { name: /add filter/i }));

    // Adding every field to the export is useful; turning every field into a
    // filter rule is not, so the option is deliberately absent here.
    expect(
      await screen.findByRole('option', { name: /and \/ or group/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /add all/i })
    ).not.toBeInTheDocument();
  });

  it('keeps the reorder handle reachable by keyboard', async () => {
    const user = userEvent.setup();

    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'a.csv', advanced: true }}
      />
    );

    await openSheet(user);

    // Each row's grip is a real button with its own accessible name, so the
    // list is operable without a pointer.
    const grip = screen.getByRole('button', { name: /reorder student/i });
    grip.focus();
    expect(grip).toHaveFocus();
  });

  it('restores the screen defaults with Reset to screen', async () => {
    const user = userEvent.setup();

    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        csv={{ filename: 'a.csv', advanced: true }}
      />
    );

    await openSheet(user);
    await user.click(screen.getByRole('button', { name: /remove level/i }));
    expect(
      screen.queryByRole('button', { name: /reorder level/i })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reset to screen/i }));
    expect(
      await screen.findByRole('button', { name: /reorder level/i })
    ).toBeInTheDocument();
  });
});
