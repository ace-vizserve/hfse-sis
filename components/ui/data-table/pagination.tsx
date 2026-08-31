'use client';

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { type Table } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type PaginationProps<TRow> = {
  table: Table<TRow>;
  pageSizeOptions?: number[];
  /**
   * Set by a GROUPED table (`expandable`), where one page holds N groups
   * rather than N rows. The shell computes the group count because it is the
   * only thing that knows the grouping function; the table's own
   * `getPageCount()` / `getCanNextPage()` count rows and would be wrong here
   * in both directions — too many pages, and "next" still enabled on the
   * last one.
   */
  groupPagination?: { pageCount: number; unitLabel: string };
};

export function DataTablePagination<TRow>({
  table,
  pageSizeOptions = [10, 20, 50, 100],
  groupPagination,
}: PaginationProps<TRow>) {
  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = groupPagination?.pageCount ?? table.getPageCount();
  const pageSize = table.getState().pagination.pageSize;
  const unitLabel = groupPagination?.unitLabel ?? 'Rows';
  // Derived from the page count above rather than the table's own
  // can-go-next/previous, so a grouped table stops at its last GROUP page.
  const canPrevious = pageIndex > 0;
  const canNext = pageIndex < pageCount - 1;
  // The active pageSize must always have a matching <SelectItem>, else the
  // Select renders blank. Consumers can pass a pageSize outside the default
  // options (e.g. 25), so fold it in (deduped + sorted).
  const sizeOptions = Array.from(new Set([...pageSizeOptions, pageSize])).sort(
    (a, b) => a - b
  );
  return (
    <div className="flex items-center justify-between gap-4 px-1 py-2 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>{unitLabel} per page</span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => table.setPageSize(Number(v))}
        >
          <SelectTrigger className="h-7 w-[72px] font-mono text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sizeOptions.map((n) => (
              <SelectItem
                key={n}
                value={String(n)}
                className="font-mono text-[11px]"
              >
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-muted-foreground">
          Page {pageIndex + 1} of {Math.max(1, pageCount)}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="First page"
            onClick={() => table.setPageIndex(0)}
            disabled={!canPrevious}
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Previous page"
            onClick={() => table.setPageIndex(pageIndex - 1)}
            disabled={!canPrevious}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Next page"
            onClick={() => table.setPageIndex(pageIndex + 1)}
            disabled={!canNext}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Last page"
            onClick={() => table.setPageIndex(pageCount - 1)}
            disabled={!canNext}
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
