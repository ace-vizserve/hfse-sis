import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
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

const expandableConfig = {
  enabled: true,
  groupBy: (r: Row) => r.groupKey,
  renderGroupHeader: ({
    key,
    rows: groupRows,
    isExpanded,
    toggle,
  }: {
    key: string;
    rows: Row[];
    isExpanded: boolean;
    toggle: () => void;
  }) => (
    <button type="button" onClick={toggle} aria-expanded={isExpanded}>
      Group {key} ({groupRows.length})
    </button>
  ),
};

function renderTable(
  props: Partial<ComponentProps<typeof DataTable<Row>>> = {},
  data: Row[] = rows
) {
  return render(
    <DataTable<Row>
      data={data}
      columns={columns}
      getRowId={(r) => r.id}
      expandable={expandableConfig}
      {...props}
    />
  );
}

/** `count` groups of `perGroup` rows each — group keys are G01, G02, … so
 *  they sort and read in a stable order regardless of row count. */
function makeGroups(count: number, perGroup: number): Row[] {
  const out: Row[] = [];
  for (let g = 1; g <= count; g++) {
    const key = `G${String(g).padStart(2, '0')}`;
    for (let i = 1; i <= perGroup; i++) {
      out.push({ id: `${key}-${i}`, groupKey: key, label: `${key} row ${i}` });
    }
  }
  return out;
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

  // ---- Pagination counts GROUPS, not rows ----
  // Before this, the shell paginated the row model and grouped what came
  // back, so on /p-files/document-validation "50 per page" rendered 3
  // students and a student's documents split across two pages with the group
  // header counting only the slice on screen.
  describe('pagination', () => {
    it('fills a page with `pageSize` GROUPS, not `pageSize` rows', () => {
      // 12 groups x 5 rows = 60 rows. A row-paginated page of 5 would show
      // one group; a group-paginated one shows five.
      renderTable({ pageSize: 5 }, makeGroups(12, 5));
      for (const key of ['G01', 'G02', 'G03', 'G04', 'G05']) {
        expect(screen.getByText(`Group ${key} (5)`)).toBeInTheDocument();
      }
      expect(screen.queryByText('Group G06 (5)')).not.toBeInTheDocument();
    });

    it('keeps every row of a group together and counts them all', () => {
      // Group G02 straddles what would have been a row-page boundary at 5.
      renderTable({ pageSize: 5 }, makeGroups(12, 5));
      expect(screen.getByText('Group G02 (5)')).toBeInTheDocument();
      for (let i = 1; i <= 5; i++) {
        expect(screen.getByText(`G02 row ${i}`)).toBeInTheDocument();
      }
    });

    it('derives the page count from groups', () => {
      // 12 groups / 5 per page = 3 pages (60 rows / 5 would have been 12).
      renderTable({ pageSize: 5 }, makeGroups(12, 5));
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    });

    it('pages forward through groups and stops on the last page', () => {
      renderTable({ pageSize: 5 }, makeGroups(12, 5));
      const nextBtn = screen.getByRole('button', { name: 'Next page' });
      const lastBtn = screen.getByRole('button', { name: 'Last page' });
      fireEvent.click(nextBtn);
      expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
      expect(screen.getByText('Group G06 (5)')).toBeInTheDocument();
      expect(screen.queryByText('Group G05 (5)')).not.toBeInTheDocument();
      fireEvent.click(lastBtn);
      expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
      expect(screen.getByText('Group G12 (5)')).toBeInTheDocument();
      // "Next" and "last" are spent on the final page — the row-model's own
      // canNextPage would still say yes here (60 rows / 5 = 12 row-pages).
      expect(nextBtn).toBeDisabled();
      expect(lastBtn).toBeDisabled();
    });

    it('labels the page-size control with the group unit', () => {
      renderTable({ pageSize: 5, expandable: undefined }, makeGroups(12, 5));
      // Sanity: an ungrouped table still says Rows.
      expect(screen.getByText('Rows per page')).toBeInTheDocument();
    });

    it('says "Students per page" when the consumer names the unit', () => {
      render(
        <DataTable<Row>
          data={makeGroups(12, 5)}
          columns={columns}
          getRowId={(r) => r.id}
          pageSize={5}
          expandable={{
            enabled: true,
            unitLabel: 'Students',
            groupBy: (r) => r.groupKey,
            renderGroupHeader: ({ key, rows: groupRows }) => (
              <span>
                Group {key} ({groupRows.length})
              </span>
            ),
          }}
        />
      );
      expect(screen.getByText('Students per page')).toBeInTheDocument();
      expect(screen.queryByText('Rows per page')).not.toBeInTheDocument();
    });

    it('pulls the viewer back when the group count shrinks under them', () => {
      // Land on the last page, then filter down to fewer groups than pages.
      renderTable({ pageSize: 5, searchKeys: ['label'] }, makeGroups(12, 5));
      fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
      expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
      // Searching narrows to one group; without the clamp the viewer would
      // sit on page 3 of 1 looking at an empty table.
      fireEvent.change(screen.getByPlaceholderText('Search…'), {
        target: { value: 'G07' },
      });
      expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
      expect(screen.getByText('Group G07 (5)')).toBeInTheDocument();
    });

    it('shows every group when the consumer hides pagination', () => {
      renderTable({ pageSize: 5, hidePagination: true }, makeGroups(12, 5));
      expect(screen.getByText('Group G01 (5)')).toBeInTheDocument();
      expect(screen.getByText('Group G12 (5)')).toBeInTheDocument();
    });
  });

  // Both document-validation queues carry every slot for every student, so
  // opening all of them at once buries the page. They open as a list of
  // names; the reader opens the one they want. Groups stay collapsible —
  // this is the STARTING state, not a lock.
  describe('initiallyCollapsed', () => {
    it('starts every group closed, headers still listed', () => {
      renderTable({
        expandable: { ...expandableConfig, initiallyCollapsed: true },
      });
      expect(screen.getByText('Group A (2)')).toBeInTheDocument();
      expect(screen.getByText('Group B (1)')).toBeInTheDocument();
      expect(screen.queryByText('A-first')).not.toBeInTheDocument();
      expect(screen.queryByText('B-only')).not.toBeInTheDocument();
    });

    it('opens one group on toggle, leaving the others closed', () => {
      renderTable({
        expandable: { ...expandableConfig, initiallyCollapsed: true },
      });
      fireEvent.click(screen.getByText('Group A (2)'));
      expect(screen.getByText('A-first')).toBeInTheDocument();
      expect(screen.getByText('A-second')).toBeInTheDocument();
      expect(screen.queryByText('B-only')).not.toBeInTheDocument();
    });

    it('closes again on a second toggle', () => {
      renderTable({
        expandable: { ...expandableConfig, initiallyCollapsed: true },
      });
      fireEvent.click(screen.getByText('Group A (2)'));
      fireEvent.click(screen.getByText('Group A (2)'));
      expect(screen.queryByText('A-first')).not.toBeInTheDocument();
    });

    it('leaves the default (all open) untouched when not set', () => {
      renderTable();
      expect(screen.getByText('A-first')).toBeInTheDocument();
      expect(screen.getByText('B-only')).toBeInTheDocument();
    });
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
