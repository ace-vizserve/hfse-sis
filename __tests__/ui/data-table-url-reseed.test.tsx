import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import type { StatusTabConfig } from '@/components/ui/data-table/types';

// `cacheComponents` keeps a visited page mounted (React <Activity>), so the
// DataTable instance survives a navigation back to its page with different
// filters in the URL. A re-render with a new search string stands in for that
// navigation here: the table must take the new URL, not keep the first one.
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

type Row = { id: string; section: string; status: 'A' | 'B' };

const rows: Row[] = [
  { id: '1', section: 'Commitment', status: 'A' },
  { id: '2', section: 'Courage', status: 'A' },
  { id: '3', section: 'Patience', status: 'B' },
];

const inList = (
  row: { getValue: (id: string) => unknown },
  id: string,
  value: unknown
) =>
  !Array.isArray(value) ||
  value.length === 0 ||
  value.includes(row.getValue(id));

const columns: ColumnDef<Row>[] = [
  {
    id: 'section',
    accessorKey: 'section',
    header: 'Section',
    filterFn: inList,
  },
  { id: 'status', accessorKey: 'status', header: 'Status' },
];

const statusTabs: Array<StatusTabConfig<Row>> = [
  { value: 'all', label: 'All', predicate: () => true, isDefault: true },
  { value: 'B', label: 'Only B', predicate: (r) => r.status === 'B' },
];

function Table() {
  return (
    <DataTable<Row>
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchKeys={['section']}
      facets={[{ columnId: 'section', label: 'Section' }]}
      statusTabs={statusTabs}
      url={{ enabled: true, namespace: 'g' }}
    />
  );
}

// Table cells only — an active facet also renders its value as a filter chip.
const cells = () =>
  screen.queryAllByRole('cell').map((c) => c.textContent?.trim() ?? '');

beforeEach(() => {
  h.replaceCalls.length = 0;
  h.searchString = '';
});

describe('DataTable url-state — a URL changed from outside re-seeds the table', () => {
  it('a revisit with a different facet param shows the new filter', async () => {
    h.searchString = 'g.section=Commitment';
    const { rerender } = render(<Table />);
    expect(cells()).toContain('Commitment');
    expect(cells()).not.toContain('Courage');

    h.searchString = 'g.section=Courage';
    rerender(<Table />);

    await waitFor(() => expect(cells()).toContain('Courage'));
    expect(cells()).not.toContain('Commitment');
    // The stale filter is never written back over the new URL.
    expect(h.replaceCalls.some((u) => u.includes('Commitment'))).toBe(false);
  });

  it('a revisit with no params clears the filters and the status tab', async () => {
    h.searchString = 'g.section=Patience&g.status=B';
    const { rerender } = render(<Table />);
    expect(cells()).not.toContain('Commitment');

    h.searchString = '';
    rerender(<Table />);

    await waitFor(() => expect(cells()).toContain('Commitment'));
    expect(cells()).toContain('Courage');
    expect(cells()).toContain('Patience');
  });

  it('params outside the namespace do not re-seed the table', () => {
    h.searchString = 'g.section=Commitment';
    const { rerender } = render(<Table />);

    h.searchString = 'g.section=Commitment&other.q=x';
    rerender(<Table />);

    expect(cells()).toContain('Commitment');
    expect(cells()).not.toContain('Courage');
  });
});

describe('DataTable facets — a facet column without its own filterFn', () => {
  type Doc = { id: string; slot: string };
  const docs: Doc[] = [
    { id: '1', slot: 'Student Pass' },
    { id: '2', slot: 'Student Passport' },
    { id: '3', slot: 'Mother Pass' },
  ];
  // No filterFn: TanStack's auto filter used to stringify the picked array.
  const docColumns: ColumnDef<Doc>[] = [
    { id: 'slot', accessorKey: 'slot', header: 'Slot' },
  ];
  const DocTable = () => (
    <DataTable<Doc>
      data={docs}
      columns={docColumns}
      getRowId={(r) => r.id}
      facets={[{ columnId: 'slot', label: 'Slot' }]}
      url={{ enabled: true, namespace: 'd' }}
    />
  );

  it('one pick matches exactly, not as a substring', () => {
    h.searchString = 'd.slot=Student Pass';
    render(<DocTable />);
    expect(cells()).toEqual(['Student Pass']);
  });

  it('two picks match both, not nothing', () => {
    h.searchString = 'd.slot=Student Pass,Mother Pass';
    render(<DocTable />);
    expect(cells().sort()).toEqual(['Mother Pass', 'Student Pass']);
  });
});
