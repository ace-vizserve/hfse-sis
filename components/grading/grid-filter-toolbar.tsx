'use client';

import { Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

export type GridFilters = {
  search: string;
  blanksOnly: boolean;
  hideWithdrawn: boolean;
};

export const DEFAULT_GRID_FILTERS: GridFilters = {
  search: '',
  blanksOnly: false,
  hideWithdrawn: false,
};

export function GridFilterToolbar({
  filters,
  onChange,
  total,
  visible,
  blanksToggleLabel = 'Show blanks only',
}: {
  filters: GridFilters;
  onChange: (next: GridFilters) => void;
  total: number;
  visible: number;
  blanksToggleLabel?: string;
}) {
  const active =
    filters.search.trim() !== '' || filters.blanksOnly || filters.hideWithdrawn;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search student"
          aria-label="Search student"
          className="h-9 w-56 pl-8"
        />
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <Checkbox
          checked={filters.blanksOnly}
          onCheckedChange={(v) =>
            onChange({ ...filters, blanksOnly: v === true })
          }
        />
        {blanksToggleLabel}
      </label>
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <Checkbox
          checked={filters.hideWithdrawn}
          onCheckedChange={(v) =>
            onChange({ ...filters, hideWithdrawn: v === true })
          }
        />
        Hide withdrawn
      </label>
      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {visible === total
            ? `${total} student${total === 1 ? '' : 's'}`
            : `${visible} of ${total}`}
        </span>
        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2"
            onClick={() => onChange(DEFAULT_GRID_FILTERS)}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
