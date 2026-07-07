/**
 * Derived facet vocabulary — a facet WITHOUT `valueOptions` builds its
 * option list from the column's faceted unique values. A row whose accessor
 * yields `''` (e.g. `row.classLevel ?? row.levelApplied ?? ''` in
 * student-data-table) must NOT become a blank selectable option; blank
 * values are dropped from the derived vocabulary, matching the export
 * sheet's `getFacetOptions` (filter-rows.ts). Blank-valued rows stay
 * reachable by clearing the facet.
 */
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

type Row = { id: string; name: string; level: string | null };

const rows: Row[] = [
  { id: '1', name: 'Alpha', level: 'Primary 1' },
  { id: '2', name: 'Bravo', level: '' }, // blank — must not become an option
  { id: '3', name: 'Charlie', level: 'Primary 2' },
  { id: '4', name: 'Delta', level: null }, // null coerced to '' by accessor
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
    id: 'level',
    accessorFn: (r) => r.level ?? '',
    header: 'Level',
    filterFn: arrayFilterFn,
  },
];

function bodyNames() {
  return screen
    .getAllByRole('row')
    .filter((r) => within(r).queryAllByRole('columnheader').length === 0)
    .map((r) => within(r).queryAllByRole('cell')[0]?.textContent ?? '')
    .filter((t) => t.length > 0);
}

describe('DataTable derived facet options', () => {
  it('omits blank values from the derived vocabulary and keeps blank rows reachable', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        facets={[{ columnId: 'level', label: 'Level' }]} // no valueOptions → derived
      />
    );

    // All 4 rows visible unfiltered — blank-valued rows are not hidden.
    expect(bodyNames().sort()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);

    const facetTrigger = screen.getByRole('button', { name: /^Level/ });
    await user.click(facetTrigger);
    await waitFor(() =>
      expect(facetTrigger).toHaveAttribute('aria-expanded', 'true')
    );

    // Only the two real levels — no blank third option for ''/null rows.
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Primary 1',
      'Primary 2',
    ]);

    // Selecting a real option still filters normally.
    await user.click(screen.getByRole('option', { name: 'Primary 1' }));
    await waitFor(() => expect(bodyNames()).toEqual(['Alpha']));
  });
});
