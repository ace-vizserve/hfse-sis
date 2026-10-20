'use client';

import { type Table } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNextButton,
  PaginationPreviousButton,
} from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * The page numbers a pager shows: always the first and last page, the current
 * page and its two neighbours, and an `'ellipsis'` for each gap. Seven pages
 * or fewer are all shown. A gap of exactly one page shows that page rather
 * than an ellipsis standing in for a single number. Pages are 1-based.
 */
export function pageWindow(
  page: number,
  pageCount: number
): Array<number | 'ellipsis'> {
  const count = Math.max(1, pageCount);
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const current = Math.min(Math.max(1, page), count);
  // Keep the window five wide at the ends, so the control doesn't change
  // width as the reader steps from page 1 to page 4.
  let start = Math.max(2, current - 1);
  let end = Math.min(count - 1, current + 1);
  if (current <= 3) end = 5;
  if (current >= count - 2) start = count - 4;
  const out: Array<number | 'ellipsis'> = [1];
  if (start === 3) out.push(2);
  else if (start > 3) out.push('ellipsis');
  for (let p = start; p <= end; p++) out.push(p);
  if (end === count - 2) out.push(count - 1);
  else if (end < count - 2) out.push('ellipsis');
  out.push(count);
  return out;
}

/**
 * Previous / numbered pages / Next — shadcn Pagination as one control. Shared
 * by the client-paged DataTable footer and the server-paged audit logs, so
 * every table in the SIS pages the same way. `page` is 1-based.
 */
export function DataTablePageNav({
  page,
  pageCount,
  onPageChange,
  className,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const count = Math.max(1, pageCount);
  const canPrevious = page > 1;
  const canNext = page < count;
  return (
    <Pagination className={cn('mx-0 w-auto', className)}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPreviousButton
            className="h-7 text-xs"
            disabled={!canPrevious}
            onClick={() => onPageChange(page - 1)}
          />
        </PaginationItem>
        {pageWindow(page, count).map((p, i) =>
          p === 'ellipsis' ? (
            <PaginationItem key={`gap-${i}`} className="hidden sm:list-item">
              <PaginationEllipsis className="size-7" />
            </PaginationItem>
          ) : (
            <PaginationItem key={p} className="hidden sm:list-item">
              <PaginationButton
                className="h-7 w-auto min-w-7 px-1.5 font-mono text-[11px] tabular-nums"
                isActive={p === page}
                aria-label={`Page ${p}`}
                onClick={() => p !== page && onPageChange(p)}
              >
                {p.toLocaleString('en-SG')}
              </PaginationButton>
            </PaginationItem>
          )
        )}
        <PaginationItem>
          <PaginationNextButton
            className="h-7 text-xs"
            disabled={!canNext}
            onClick={() => onPageChange(page + 1)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

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
  // The active pageSize must always have a matching <SelectItem>, else the
  // Select renders blank. Consumers can pass a pageSize outside the default
  // options (e.g. 25), so fold it in (deduped + sorted).
  const sizeOptions = Array.from(new Set([...pageSizeOptions, pageSize])).sort(
    (a, b) => a - b
  );
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 py-2 text-xs">
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
        {/* Page count comes from the value above rather than the table's own
            can-go-next/previous, so a grouped table stops at its last GROUP
            page. */}
        <DataTablePageNav
          page={pageIndex + 1}
          pageCount={pageCount}
          onPageChange={(p) => table.setPageIndex(p - 1)}
        />
      </div>
    </div>
  );
}
