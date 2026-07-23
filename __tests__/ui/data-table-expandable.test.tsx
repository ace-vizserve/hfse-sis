import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';

import { DataTable } from '@/components/ui/data-table';

// The shell's `useUrlState` calls `useRouter`/`usePathname`/`useSearchParams`
// unconditionally (even when `url` is omitted), which requires an app-router
// context jsdom doesn't provide — every sibling DataTable test mocks this the
// same way (see data-table-facet-groups.test.tsx).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}));

type Row = { id: string; groupKey: string; label: string };

const rows: Row[] = [
  { id: '1', groupKey: 'A', label: 'A-first' },
  { id: '2', groupKey: 'A', label: 'A-second' },
  { id: '3', groupKey: 'B', label: 'B-only' },
];

const columns: ColumnDef<Row>[] = [{ accessorKey: 'label', header: 'Label' }];

function renderTable() {
  return render(
    <DataTable<Row>
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      expandable={{
        enabled: true,
        groupBy: (r) => r.groupKey,
        renderGroupHeader: ({ key, rows: groupRows, isExpanded, toggle }) => (
          <button type="button" onClick={toggle} aria-expanded={isExpanded}>
            Group {key} ({groupRows.length})
          </button>
        ),
      }}
    />
  );
}

describe('DataTable expandable rows', () => {
  it('renders one group header per distinct groupBy key', () => {
    renderTable();
    expect(screen.getByText('Group A (2)')).toBeInTheDocument();
    expect(screen.getByText('Group B (1)')).toBeInTheDocument();
  });

  it('starts all groups expanded, showing every child row', () => {
    renderTable();
    expect(screen.getByText('A-first')).toBeInTheDocument();
    expect(screen.getByText('A-second')).toBeInTheDocument();
    expect(screen.getByText('B-only')).toBeInTheDocument();
  });

  it("collapses a group on toggle, hiding only that group's rows", () => {
    renderTable();
    fireEvent.click(screen.getByText('Group A (2)'));
    expect(screen.queryByText('A-first')).not.toBeInTheDocument();
    expect(screen.queryByText('A-second')).not.toBeInTheDocument();
    // Group B untouched
    expect(screen.getByText('B-only')).toBeInTheDocument();
  });

  it('re-expands on a second toggle', () => {
    renderTable();
    const header = screen.getByText('Group A (2)');
    fireEvent.click(header);
    fireEvent.click(screen.getByText('Group A (2)'));
    expect(screen.getByText('A-first')).toBeInTheDocument();
  });

  it('a table without `expandable` renders the flat row list unchanged', () => {
    render(
      <DataTable<Row> data={rows} columns={columns} getRowId={(r) => r.id} />
    );
    expect(screen.getByText('A-first')).toBeInTheDocument();
    expect(screen.getByText('A-second')).toBeInTheDocument();
    expect(screen.getByText('B-only')).toBeInTheDocument();
    // No group-header buttons should exist
    expect(
      screen.queryByRole('button', { name: /Group/ })
    ).not.toBeInTheDocument();
  });
});
