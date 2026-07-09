import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import type { StatusTabConfig } from '@/components/ui/data-table/types';

// Controllable next/navigation mock: tests set `h.searchString` to simulate
// a deep-linked URL and read `h.replaceCalls` to see every URL the shell
// wrote back via router.replace.
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

type Row = { id: string; name: string; status: 'A' | 'B' };

const rows: Row[] = [
  { id: '1', name: 'Alpha', status: 'A' },
  { id: '2', name: 'Bravo', status: 'A' },
  { id: '3', name: 'Charlie', status: 'B' },
  { id: '4', name: 'Delta', status: 'B' },
  { id: '5', name: 'Echo', status: 'B' },
];

const columns: ColumnDef<Row>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
  { id: 'status', accessorKey: 'status', header: 'Status' },
];

const statusTabs: Array<StatusTabConfig<Row>> = [
  {
    value: 'A',
    label: 'Status A',
    predicate: (r) => r.status === 'A',
    isDefault: true,
  },
  { value: 'B', label: 'Status B', predicate: (r) => r.status === 'B' },
];

function lastReplace(): string {
  return h.replaceCalls[h.replaceCalls.length - 1] ?? '';
}

beforeEach(() => {
  h.replaceCalls.length = 0;
  h.searchString = '';
});

describe('DataTable url-state — pagination params vs the debounced search write', () => {
  it('a deep-linked ?ns.page= survives the mount-scheduled debounced write', async () => {
    h.searchString = 't.page=2';
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchKeys={['name']}
        pageSize={2}
        url={{ enabled: true, namespace: 't' }}
      />
    );

    // The immediate (non-debounced) write on mount carries the page.
    await waitFor(() => expect(h.replaceCalls.length).toBeGreaterThan(0));
    expect(lastReplace()).toContain('t.page=2');

    // Wait past the 300ms debounce so the mount-scheduled debounced write
    // (the [search] effect) has fired — it previously omitted page/pageSize
    // and so DELETED them from the URL.
    await new Promise((r) => setTimeout(r, 500));
    expect(lastReplace()).toContain('t.page=2');
  });

  it('a search keystroke keeps a non-default ?ns.pageSize= while resetting the page', async () => {
    h.searchString = 't.pageSize=50';
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchKeys={['name']}
        pageSize={2}
        url={{ enabled: true, namespace: 't' }}
      />
    );

    await user.type(screen.getByPlaceholderText('Search…'), 'a');

    // The debounced write must include the search AND preserve pageSize.
    await waitFor(() => expect(lastReplace()).toContain('t.q=a'));
    const url = lastReplace();
    expect(url).toContain('t.pageSize=50');
    // Page resets to 1 on a filter change — page 1 is encoded as "no param".
    expect(url).not.toMatch(/t\.page=\d/);
  });

  it('a non-debounced write (status-tab click) cancels the pending stale debounced write', async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchKeys={['name']}
        statusTabs={statusTabs}
        url={{ enabled: true, namespace: 't' }}
      />
    );

    // Keystroke schedules a debounced write whose closure predates the tab
    // click (statusTab still the default → no status param).
    await user.type(screen.getByPlaceholderText('Search…'), 'x');
    // Tab click fires the immediate write (t.status=B) which must also
    // cancel the pending debounced write — otherwise the stale snapshot
    // fires ~300ms later and strips t.status back out of the URL.
    await user.click(screen.getByRole('tab', { name: /Status B/ }));
    await waitFor(() => expect(lastReplace()).toContain('t.status=B'));

    await new Promise((r) => setTimeout(r, 500));
    expect(lastReplace()).toContain('t.status=B');
    expect(lastReplace()).toContain('t.q=x');
  });
});
