import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import type {
  CsvConfig,
  FacetGroupConfig,
  MeScopeConfig,
} from '@/components/ui/data-table/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

type Row = { id: string; name: string; owner: string; stageA: string };

const rows: Row[] = [
  { id: '1', name: 'Alpha', owner: 'u1', stageA: 'Finished' },
  { id: '2', name: 'Bravo', owner: 'u2', stageA: 'Pending' },
  { id: '3', name: 'Charlie', owner: 'u2', stageA: 'Pending' },
];

const arrayFilterFn: ColumnDef<Row>['filterFn'] = (row, id, value) => {
  if (!value || (Array.isArray(value) && value.length === 0)) return true;
  return Array.isArray(value)
    ? value.includes(row.getValue(id))
    : row.getValue(id) === value;
};

const columns: ColumnDef<Row>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
  {
    id: 'stage_a',
    accessorKey: 'stageA',
    header: 'Stage A',
    filterFn: arrayFilterFn,
  },
  {
    // Display-only column (no accessor) opted out of exports — must never
    // appear in the export column picker.
    id: 'strip',
    header: 'Strip',
    meta: { excludeFromExport: true },
    cell: () => 'visual-only',
  },
];

const csv: CsvConfig<Row> = { filename: 'test.csv' };

async function openExportSheet(user: ReturnType<typeof userEvent.setup>) {
  // Close any open popovers first so the click lands on the button.
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: /Export CSV/ }));
  return await screen.findByRole('dialog');
}

describe('DataTableExportSheet — scope fidelity', () => {
  it('honours the active me-scope toggle and lets the user flip it in the sheet (M1.a)', async () => {
    const user = userEvent.setup();
    const meScope: MeScopeConfig<Row> = {
      userId: 'u1',
      label: 'Only mine',
      predicate: (r, uid) => r.owner === uid,
    };
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchKeys={['name']}
        meScope={meScope}
        csv={csv}
      />
    );

    // Activate "Only mine" in the toolbar — on-screen table narrows to Alpha.
    await user.click(screen.getByRole('button', { name: 'Only mine' }));

    const dialog = await openExportSheet(user);
    // Export preview must match the on-screen scope: 1 row, not all 3.
    expect(within(dialog).getByText(/1 rows/)).toBeInTheDocument();

    // The scope is visible + adjustable inside the sheet.
    await user.click(within(dialog).getByRole('button', { name: 'Only mine' }));
    await waitFor(() =>
      expect(within(dialog).getByText(/3 rows/)).toBeInTheDocument()
    );
  });

  it('shows and clears grouped-facet (facetGroups) selections (M1.b)', async () => {
    const user = userEvent.setup();
    const facetGroups: FacetGroupConfig[] = [
      {
        label: 'Stage filters',
        facets: [
          {
            columnId: 'stage_a',
            label: 'Stage A',
            valueOptions: ['Pending', 'Finished'],
          },
        ],
      },
    ];
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchKeys={['name']}
        facetGroups={facetGroups}
        csv={csv}
      />
    );

    // Select Stage A = Finished through the toolbar group popover.
    await user.click(screen.getByRole('button', { name: /Stage filters/ }));
    const stageAFacet = await screen.findByRole('button', { name: /^Stage A/ });
    await user.click(stageAFacet);
    const option = await screen.findByRole('option', { name: 'Finished' });
    await user.click(option);

    const dialog = await openExportSheet(user);
    // Grouped facet selection narrows the preview AND is visible in the
    // sheet's Filters section as its own dropdown (previously invisible).
    // Anchored regex: the "Selected columns" pane also carries "Reorder
    // Stage A" / "Remove Stage A from export" buttons.
    expect(within(dialog).getByText(/1 rows/)).toBeInTheDocument();
    const sheetStageA = within(dialog).getByRole('button', {
      name: /^Stage A/,
    });
    expect(sheetStageA).toBeInTheDocument();

    // …and it is clearable from the sheet.
    await user.click(sheetStageA);
    const clear = await screen.findByRole('option', { name: /Clear/ });
    await user.click(clear);
    await waitFor(() =>
      expect(within(dialog).getByText(/3 rows/)).toBeInTheDocument()
    );
  });

  it('omits meta.excludeFromExport columns from the column picker (M1.e mechanism)', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchKeys={['name']}
        csv={csv}
      />
    );

    const dialog = await openExportSheet(user);
    // Exportable columns are offered as picker checkboxes…
    expect(
      within(dialog).getByRole('checkbox', { name: 'Name' })
    ).toBeInTheDocument();
    // …the excluded display-only column is not.
    expect(
      within(dialog).queryByRole('checkbox', { name: 'Strip' })
    ).toBeNull();
    expect(within(dialog).queryByText('Strip')).toBeNull();
  });

  it('discards a raw-columns fetch that resolves after the scope changed (M1.c)', async () => {
    const user = userEvent.setup();
    const fetchCalls: string[][] = [];
    const resolvers: Array<
      (v: Record<string, Record<string, unknown>>) => void
    > = [];
    const rawCsv: CsvConfig<Row> = {
      filename: 'test.csv',
      rawColumns: {
        keyOf: (r) => r.id,
        sources: [
          {
            id: 'src',
            label: 'Raw',
            fetch: (keys) => {
              fetchCalls.push(keys);
              return new Promise((res) => resolvers.push(res));
            },
          },
        ],
      },
    };
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchKeys={['name']}
        csv={rawCsv}
      />
    );

    const dialog = await openExportSheet(user);

    // Open the raw group — auto-load fires with ALL row keys (no filters).
    await user.click(within(dialog).getByText(/All Raw columns/));
    await waitFor(() => expect(fetchCalls.length).toBe(1));
    expect(fetchCalls[0]).toEqual(['1', '2', '3']);

    // Narrow the export scope while the fetch is still in flight.
    await user.type(within(dialog).getByPlaceholderText('Search…'), 'Alpha');
    await waitFor(() =>
      expect(within(dialog).getByText(/1 rows/)).toBeInTheDocument()
    );

    // The stale fetch resolves — it must NOT land as loaded; the open group
    // refetches with the narrowed keys instead.
    resolvers[0]!({
      '1': { extra_col: 'x' },
      '2': { extra_col: 'y' },
      '3': { extra_col: 'z' },
    });
    await waitFor(() => expect(fetchCalls.length).toBe(2));
    expect(fetchCalls[1]).toEqual(['1']);
  });
});
