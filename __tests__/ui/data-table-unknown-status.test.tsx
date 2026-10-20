import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import type { StatusTabConfig } from '@/components/ui/data-table/types';

// A `?ns.status=` naming no tab (a typo, an old link) used to select no tab
// at all and list every row under none of them. It opens the default tab now,
// and the unknown value leaves the URL.
const h = vi.hoisted(() => ({
  replaceCalls: [] as string[],
  searchString: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    replace: (url: string) => h.replaceCalls.push(url),
    push: vi.fn(),
  }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(h.searchString),
}));

type Row = { id: string; name: string; status: 'open' | 'paid' };
const rows: Row[] = [
  { id: '1', name: 'Abad', status: 'open' },
  { id: '2', name: 'Bautista', status: 'paid' },
];
const columns: ColumnDef<Row>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
];
const statusTabs: Array<StatusTabConfig<Row>> = [
  {
    value: 'open',
    label: 'Open',
    predicate: (r) => r.status === 'open',
    isDefault: true,
  },
  { value: 'paid', label: 'Paid', predicate: (r) => r.status === 'paid' },
];

function Table() {
  return (
    <DataTable<Row>
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      statusTabs={statusTabs}
      url={{ enabled: true, namespace: 'g' }}
    />
  );
}

const cells = () =>
  screen.queryAllByRole('cell').map((c) => c.textContent?.trim() ?? '');

beforeEach(() => {
  h.replaceCalls.length = 0;
});

describe('DataTable — unknown status in the URL', () => {
  it('opens the default tab and drops the unknown value', () => {
    h.searchString = 'g.status=bogus&ay=AY2026';
    render(<Table />);
    expect(cells()).toEqual(['Abad']);
    expect(h.replaceCalls.at(-1)).toBe('/test?ay=AY2026');
  });

  it('a known status still opens its tab', () => {
    h.searchString = 'g.status=paid';
    render(<Table />);
    expect(cells()).toEqual(['Bautista']);
    expect(h.replaceCalls).toEqual([]);
  });
});
