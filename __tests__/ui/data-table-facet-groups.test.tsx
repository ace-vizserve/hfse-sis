import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import type { FacetGroupConfig } from '@/components/ui/data-table/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

type Row = { id: string; name: string; stageA: string; stageB: string };

const rows: Row[] = [
  { id: '1', name: 'Alpha', stageA: 'Pending', stageB: 'Finished' },
  { id: '2', name: 'Bravo', stageA: 'Finished', stageB: 'Finished' },
  { id: '3', name: 'Charlie', stageA: 'Pending', stageB: 'Pending' },
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
    id: 'stage_b',
    accessorKey: 'stageB',
    header: 'Stage B',
    filterFn: arrayFilterFn,
  },
];

const facetGroups: FacetGroupConfig[] = [
  {
    label: 'Stage filters',
    facets: [
      {
        columnId: 'stage_a',
        label: 'Stage A',
        valueOptions: ['Pending', 'Finished'],
      },
      {
        columnId: 'stage_b',
        label: 'Stage B',
        valueOptions: ['Pending', 'Finished'],
      },
    ],
  },
];

function bodyNames() {
  return screen
    .getAllByRole('row')
    .filter((r) => within(r).queryAllByRole('columnheader').length === 0)
    .map((r) => within(r).queryAllByRole('cell')[0]?.textContent ?? '')
    .filter((t) => t.length > 0);
}

describe('DataTable facetGroups', () => {
  it('omitting facetGroups renders no group trigger (no regression for existing consumers)', () => {
    render(
      <DataTable<Row> data={rows} columns={columns} getRowId={(r) => r.id} />
    );
    expect(screen.queryByRole('button', { name: /Stage filters/ })).toBeNull();
  });

  it('renders one grouped trigger and filters rows through it', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        facetGroups={facetGroups}
      />
    );

    expect(bodyNames().sort()).toEqual(['Alpha', 'Bravo', 'Charlie']);

    // Exactly one toolbar trigger for the whole group, not 2 inline dropdowns.
    const groupTrigger = screen.getByRole('button', { name: /Stage filters/ });
    await user.click(groupTrigger);

    // Inside the group popover, pick the "Stage A" facet dropdown and select
    // "Finished" — only Bravo has stageA=Finished.
    const stageAFacet = await screen.findByRole('button', { name: /^Stage A/ });
    await user.click(stageAFacet);
    await waitFor(() =>
      expect(stageAFacet).toHaveAttribute('aria-expanded', 'true')
    );
    // Table cells also read "Finished" — scope to the cmdk option so this
    // doesn't ambiguously match a data row.
    const option = await screen.findByRole('option', { name: 'Finished' });
    await user.click(option);

    await waitFor(() => expect(bodyNames()).toEqual(['Bravo']));
  });
});
