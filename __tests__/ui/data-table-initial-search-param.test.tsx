import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { queryWithChanges } from '@/components/ui/data-table/use-page-params';

// A page-level param (`/billing/review?student=…`) seeds the table's search.
// Clearing or changing the search must take the param out of the URL, or a
// refresh / Back / the next server render puts the old search back.
// Like Next's: one router object for the page's life, and `replace` moves the
// address, so a repeat drop of an already-gone param is a no-op.
const h = vi.hoisted(() => {
  const replaceCalls: string[] = [];
  const router = {
    refresh: () => {},
    replace: (url: string) => {
      replaceCalls.push(url);
      window.history.replaceState(null, '', url);
    },
    push: () => {},
  };
  return { replaceCalls, router };
});

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => '/billing/review',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

type Row = { id: string; name: string };
const rows: Row[] = [
  { id: 'H1', name: 'Abad' },
  { id: 'H2', name: 'Bautista' },
  { id: 'H3', name: 'Cruz' },
];
const columns: ColumnDef<Row>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
];

function Table({
  seed,
  param = 'student',
}: {
  seed?: string;
  param?: string | null;
}) {
  return (
    <DataTable<Row>
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchKeys={['name', 'id']}
      searchPlaceholder="Search"
      initialSearch={seed}
      initialSearchParam={param ?? undefined}
    />
  );
}

const cells = () =>
  screen.queryAllByRole('cell').map((c) => c.textContent?.trim() ?? '');

beforeEach(() => {
  h.replaceCalls.length = 0;
  window.history.replaceState(null, '', '/billing/review?student=H2&ay=AY2026');
});

describe('queryWithChanges', () => {
  it('removes and sets params, keeping the rest', () => {
    expect(queryWithChanges('?student=H2&ay=AY2026', { student: null })).toBe(
      'ay=AY2026'
    );
    expect(queryWithChanges('?ay=AY2026', { date: 'last-365' })).toBe(
      'ay=AY2026&date=last-365'
    );
  });
  it('returns null when nothing changes', () => {
    expect(queryWithChanges('?ay=AY2026', { student: null })).toBeNull();
    expect(queryWithChanges('?date=all', { date: 'all' })).toBeNull();
  });
});

describe('DataTable initialSearchParam', () => {
  it('opens searched for the seed and leaves the URL alone', () => {
    render(<Table seed="H2" />);
    expect(cells()).toEqual(['Bautista']);
    expect(screen.getByPlaceholderText('Search')).toHaveValue('H2');
    expect(h.replaceCalls).toEqual([]);
  });

  it('clearing the search drops the param and keeps the others', () => {
    render(<Table seed="H2" />);
    fireEvent.change(screen.getByPlaceholderText('Search'), {
      target: { value: '' },
    });
    expect(cells()).toHaveLength(3);
    expect(h.replaceCalls).toEqual(['/billing/review?ay=AY2026']);
  });

  it('typing a different search drops the param too', () => {
    render(<Table seed="H2" />);
    fireEvent.change(screen.getByPlaceholderText('Search'), {
      target: { value: 'Cruz' },
    });
    expect(cells()).toEqual(['Cruz']);
    expect(h.replaceCalls).toEqual(['/billing/review?ay=AY2026']);
  });

  it('a later visit with a new value re-seeds the search', () => {
    const { rerender } = render(<Table seed="H2" />);
    act(() => {
      window.history.replaceState(null, '', '/billing/review?student=H3');
    });
    rerender(<Table seed="H3" />);
    expect(cells()).toEqual(['Cruz']);
    expect(screen.getByPlaceholderText('Search')).toHaveValue('H3');
    expect(h.replaceCalls).toEqual([]);
  });

  it('the seed going away (param dropped) keeps what the reader typed', () => {
    const { rerender } = render(<Table seed="H2" />);
    fireEvent.change(screen.getByPlaceholderText('Search'), {
      target: { value: 'Cruz' },
    });
    rerender(<Table seed={undefined} />);
    expect(screen.getByPlaceholderText('Search')).toHaveValue('Cruz');
  });

  it('without initialSearchParam, initialSearch only seeds and never writes', () => {
    render(<Table seed="H2" param={null} />);
    fireEvent.change(screen.getByPlaceholderText('Search'), {
      target: { value: '' },
    });
    expect(cells()).toHaveLength(3);
    expect(h.replaceCalls).toEqual([]);
  });
});
