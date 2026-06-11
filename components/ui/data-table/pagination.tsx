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
};

export function DataTablePagination<TRow>({
  table,
  pageSizeOptions = [10, 20, 50, 100],
}: PaginationProps<TRow>) {
  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();
  const pageSize = table.getState().pagination.pageSize;
  // The active pageSize must always have a matching <SelectItem>, else the
  // Select renders blank. Consumers can pass a pageSize outside the default
  // options (e.g. 25), so fold it in (deduped + sorted).
  const sizeOptions = Array.from(new Set([...pageSizeOptions, pageSize])).sort(
    (a, b) => a - b
  );
  return (
    <div className="flex items-center justify-between gap-4 px-1 py-2 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>Rows per page</span>
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
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => table.setPageIndex(pageCount - 1)}
            disabled={!table.getCanNextPage()}
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
