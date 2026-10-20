import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { positiveInt } from '@/components/ui/data-table/use-url-state';

// React re-runs mount effects (Strict Mode in dev, an <Activity> page shown
// again). The "reset to page 1 on a filter change" effect read that second
// run as a filter change, so ?ns.page=2 on arrival or after a refresh always
// fell back to page 1. And ?ns.pageSize=abc became NaN: an empty table.
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

type Row = { id: string; name: string };
const rows: Row[] = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map(
  (name, i) => ({ id: String(i), name })
);
const columns: ColumnDef<Row>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
];

function Table() {
  return (
    <StrictMode>
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchKeys={['name']}
        searchPlaceholder="Search"
        pageSize={2}
        url={{ enabled: true, namespace: 't' }}
      />
    </StrictMode>
  );
}

const cells = () =>
  screen.queryAllByRole('cell').map((c) => c.textContent?.trim() ?? '');

beforeEach(() => {
  h.replaceCalls.length = 0;
  h.searchString = '';
});

describe('DataTable url-state — page survives re-run mount effects', () => {
  it('opens on ?t.page=2 under Strict Mode', async () => {
    h.searchString = 't.page=2';
    render(<Table />);
    await new Promise((r) => setTimeout(r, 400));
    expect(cells()).toEqual(['Charlie', 'Delta']);
    expect(h.replaceCalls.every((u) => u.includes('t.page=2'))).toBe(true);
  });

  it('a real filter change still goes back to page 1', async () => {
    h.searchString = 't.page=2';
    render(<Table />);
    fireEvent.change(screen.getByPlaceholderText('Search'), {
      target: { value: 'a' },
    });
    expect(cells()[0]).toBe('Alpha');
  });

  it('a ?t.page= past the end opens the last page', async () => {
    h.searchString = 't.page=999';
    render(<Table />);
    await new Promise((r) => setTimeout(r, 50));
    expect(cells()).toEqual(['Echo']);
  });

  it('an invalid ?t.pageSize= falls back to the table default', () => {
    h.searchString = 't.pageSize=abc';
    render(<Table />);
    expect(cells()).toEqual(['Alpha', 'Bravo']);
  });
});

describe('positiveInt', () => {
  it('accepts whole numbers of 1 or more only', () => {
    expect(positiveInt('3')).toBe(3);
    expect(positiveInt('0')).toBeUndefined();
    expect(positiveInt('-5')).toBeUndefined();
    expect(positiveInt('abc')).toBeUndefined();
    expect(positiveInt('2.5')).toBeUndefined();
    expect(positiveInt(null)).toBeUndefined();
  });
});
