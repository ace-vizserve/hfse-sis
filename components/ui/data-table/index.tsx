'use client';

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown, Columns3, Download, Search, X } from 'lucide-react';
import {
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { BulkActionFooter } from './bulk-action-footer';
import { DataTableEmptyState } from './empty-state';
import type { DataTableExportSheetProps } from './export-sheet';
import { FacetDropdown } from './facet-dropdown';
import { filterRows } from './filter-rows';
import { FilterChip } from './filter-chip';
import { DataTablePagination } from './pagination';
import type { DataTableProps, FacetConfig } from './types';
import { useUrlState } from './use-url-state';

export { RowActionsMenu } from './row-actions-menu';

// Lazy — `export-sheet.tsx` pulls in @dnd-kit (drag-reorder columns) plus its
// own filter/facet logic, none of which is needed until a user actually opens
// "Export CSV". Statically importing it put that weight in every one of the
// ~31 DataTable consumer pages' bundles. Follows the same next/dynamic
// pattern as `components/dashboard/charts/*` (KD #80), adapted for a generic
// component: `dynamic()` can't preserve `DataTableExportSheetProps<TRow>`'s
// type parameter, so the loaded component is cast once at the module
// boundary and re-exposed through a thin generic wrapper with the same name,
// so call sites below are unchanged. `ssr: false` because the shell (and the
// sheet) are client-only; the sheet itself isn't mounted until first open
// (see `exportEverOpened` below), so there's no SSR/hydration mismatch and no
// loading-fallback flash to worry about.
const DataTableExportSheetLazy = dynamic(
  () => import('./export-sheet').then((m) => m.DataTableExportSheet),
  { ssr: false }
) as unknown as ComponentType<DataTableExportSheetProps<unknown>>;

function DataTableExportSheet<TRow>(props: DataTableExportSheetProps<TRow>) {
  return (
    <DataTableExportSheetLazy
      {...(props as unknown as DataTableExportSheetProps<unknown>)}
    />
  );
}

export function DataTable<TRow>(props: DataTableProps<TRow>) {
  const {
    data,
    columns,
    getRowId,
    searchKeys,
    searchPlaceholder = 'Search…',
    initialSearch,
    facets = [],
    facetGroups = [],
    statusTabs,
    meScope,
    toolbarLeading,
    toolbarTrailing,
    initialSort = [],
    initialColumnVisibility = {},
    stickyHeader,
    pageSize = 20,
    pageSizeOptions = [10, 20, 50, 100],
    hidePagination = false,
    selection,
    selectionResetSignal,
    expandable,
    csv,
    url = { enabled: false },
    emptyState,
    emptyFilteredState,
  } = props;

  const urlState = useUrlState(url);
  const initial = url.enabled
    ? urlState.read()
    : { facets: {} as Record<string, string[]> };

  // Toggle visibility gate. New `enabled` flag takes precedence so consumers
  // whose predicate has nothing to do with the viewer (e.g. a registrar's
  // "waiting to be applied" filter) can opt in without passing a sentinel
  // userId; falls back to Boolean(userId) for the original "show only mine"
  // use case so existing callers keep working unchanged.
  const meScopeEnabled = meScope?.enabled ?? Boolean(meScope?.userId);

  const defaultStatus =
    statusTabs?.find((t) => t.isDefault)?.value ?? statusTabs?.[0]?.value;
  const [statusTab, setStatusTab] = useState<string | undefined>(
    initial.status ?? defaultStatus
  );
  const [mineActive, setMineActive] = useState<boolean>(
    Boolean(initial.mine && meScopeEnabled)
  );
  const [search, setSearch] = useState<string>(
    initial.search ?? initialSearch ?? ''
  );
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialColumnVisibility
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    Object.entries(initial.facets ?? {}).map(([id, value]) => ({ id, value }))
  );
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Tracks which group KEYS are collapsed — inverted (vs. tracking expanded
  // keys) so a freshly-seen group defaults to expanded with zero entries,
  // matching the "declutter via one summary line, not by hiding" intent.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set()
  );
  const [exportOpen, setExportOpen] = useState(false);
  // Gates mounting the (dynamically-imported) export sheet — stays false
  // until the user opens it once, then stays true so closing/reopening
  // within the same page visit keeps its filter state (unchanged behavior
  // from before this file's export sheet was lazy-loaded).
  const [exportEverOpened, setExportEverOpened] = useState(false);
  useEffect(() => {
    if (exportOpen) setExportEverOpened(true);
  }, [exportOpen]);

  // External reset hook — bump `selectionResetSignal` to drop the selection
  // (and the bulk-action footer) after a bulk action completes.
  useEffect(() => {
    if (selectionResetSignal === undefined) return;
    setRowSelection({});
  }, [selectionResetSignal]);

  const tabFilteredData = useMemo(() => {
    let rows = data;
    if (statusTabs && statusTab) {
      const tab = statusTabs.find((t) => t.value === statusTab);
      if (tab) rows = rows.filter(tab.predicate);
    }
    if (mineActive && meScope && meScopeEnabled) {
      rows = rows.filter((r) => meScope.predicate(r, meScope.userId));
    }
    return rows;
  }, [data, statusTabs, statusTab, mineActive, meScope, meScopeEnabled]);

  // "Data after every active filter except status" — drives the per-tab
  // count badges so each tab shows how many rows would match it if the
  // user clicked it, narrowed by the other filters they've already set.
  // The facet/search filtering itself is shared with the export sheet via
  // `filterRows` (components/ui/data-table/filter-rows.ts) so the two can
  // never disagree about what "matches the current filters" means.
  const tabCountData = useMemo(() => {
    let rows = data;
    if (mineActive && meScope && meScopeEnabled) {
      rows = rows.filter((r) => meScope.predicate(r, meScope.userId));
    }
    return filterRows(rows, {
      columns,
      facets: columnFilters.map((f) => ({
        id: f.id,
        values: (Array.isArray(f.value) ? f.value : []).map(String),
      })),
      search,
      searchKeys,
    });
  }, [
    data,
    mineActive,
    meScope,
    meScopeEnabled,
    columnFilters,
    columns,
    search,
    searchKeys,
  ]);

  const table = useReactTable<TRow>({
    data: tabFilteredData,
    columns,
    getRowId,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter: search,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setSearch,
    enableRowSelection: selection?.enableRowSelection
      ? (row) => selection.enableRowSelection!(row.original)
      : (selection?.enabled ?? false),
    // Pagination is uncontrolled (seeded here, read back for the url-state
    // effect). autoResetPageIndex MUST be off: url-state writes via
    // router.replace, which re-runs the RSC and hands us a new `data` array;
    // with the default (true) that array-identity change snaps pageIndex back to
    // 0 — so "next page" reverts to page 1. We instead reset to page 1 only on
    // genuine filter changes (the effect below). pageIndex is restored from
    // ?page= so it round-trips on refresh / share.
    autoResetPageIndex: false,
    initialState: {
      pagination: {
        pageSize: initial.pageSize ?? pageSize,
        pageIndex: initial.page && initial.page > 1 ? initial.page - 1 : 0,
      },
    },
    globalFilterFn: (row, _columnId, filterValue) => {
      if (!filterValue || !searchKeys) return true;
      const haystack = searchKeys
        .map((k) =>
          typeof k === 'function'
            ? k(row.original)
            : String(row.original[k] ?? '')
        )
        .join(' ')
        .toLowerCase();
      return haystack.includes(String(filterValue).toLowerCase());
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: hidePagination ? undefined : getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  // Reset to page 1 when the FILTER inputs change (search / status tab /
  // me-scope / facets) so the user isn't stranded on a now-empty page. This is
  // the deliberate counterpart to autoResetPageIndex:false above — data-identity
  // re-renders (a url-state navigation) no longer reset the page, but a genuine
  // filter change does. Skips the initial mount so a deep-linked ?page= survives.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    table.setPageIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusTab, mineActive, columnFilters]);

  useEffect(() => {
    if (!url.enabled) return;
    const facetsSnapshot: Record<string, string[]> = {};
    for (const f of columnFilters) {
      const v = f.value;
      if (Array.isArray(v) && v.length > 0)
        facetsSnapshot[f.id] = v.map(String);
    }
    urlState.write(
      {
        search: search || undefined,
        status: statusTab !== defaultStatus ? statusTab : undefined,
        mine: mineActive || undefined,
        facets: facetsSnapshot,
        page:
          table.getState().pagination.pageIndex > 0
            ? table.getState().pagination.pageIndex + 1
            : undefined,
        pageSize:
          table.getState().pagination.pageSize !== pageSize
            ? table.getState().pagination.pageSize
            : undefined,
      },
      { debounce: false }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    columnFilters,
    statusTab,
    mineActive,
    table.getState().pagination.pageIndex,
    table.getState().pagination.pageSize,
  ]);

  useEffect(() => {
    if (!url.enabled) return;
    // Thunk, not a plain snapshot: page/pageSize are read at debounce-FIRE
    // time so (a) the mount-scheduled write can't delete a deep-linked
    // ?page=/?pageSize= (they were previously omitted → deleted ~300ms after
    // mount, breaking the KD #84 "page round-trips on refresh/share"
    // contract), and (b) after the "search resets to page 1" effect runs,
    // this write reflects the post-reset page, never a stale one.
    urlState.write(
      () => ({
        search: search || undefined,
        status: statusTab !== defaultStatus ? statusTab : undefined,
        mine: mineActive || undefined,
        facets: Object.fromEntries(
          columnFilters
            .filter((f) => Array.isArray(f.value) && f.value.length > 0)
            .map((f) => [f.id, (f.value as unknown[]).map(String)])
        ),
        page:
          table.getState().pagination.pageIndex > 0
            ? table.getState().pagination.pageIndex + 1
            : undefined,
        pageSize:
          table.getState().pagination.pageSize !== pageSize
            ? table.getState().pagination.pageSize
            : undefined,
      }),
      { debounce: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalRows = table.getFilteredRowModel().rows.length;
  const selectedRows = useMemo(
    () => table.getFilteredSelectedRowModel().rows.map((r) => r.original),
    // `table`'s object identity is stable across renders (TanStack keeps one
    // instance via an internal ref and mutates its options in place), so it
    // must NOT be relied on as the recompute trigger — `tabFilteredData` is
    // the actual value that changes when `data` is swapped (e.g. after a
    // router.refresh()), and must be a dep or selectedRows goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowSelection, table, tabFilteredData]
  );

  // Facets that live behind a `facetGroups` trigger still need to resolve to
  // a label for their chip — flatten both sources into one lookup list.
  const allFacets = useMemo(
    () => [...facets, ...facetGroups.flatMap((g) => g.facets)],
    [facets, facetGroups]
  );

  const activeChips = useMemo(() => {
    const chips: Array<{
      key: string;
      label: string;
      value: string;
      onClear: () => void;
    }> = [];
    for (const f of columnFilters) {
      const facetCfg = allFacets.find((fc) => fc.columnId === f.id);
      if (!facetCfg) continue;
      const values = Array.isArray(f.value) ? (f.value as string[]) : [];
      values.forEach((v) =>
        chips.push({
          key: `${f.id}:${v}`,
          label: facetCfg.label,
          value: v,
          onClear: () =>
            setColumnFilters((prev) =>
              prev
                .map((p) =>
                  p.id === f.id
                    ? {
                        ...p,
                        value: (p.value as string[]).filter((x) => x !== v),
                      }
                    : p
                )
                .filter(
                  (p) => !(Array.isArray(p.value) && p.value.length === 0)
                )
            ),
        })
      );
    }
    if (search)
      chips.push({
        key: 'q',
        label: 'Search',
        value: search,
        onClear: () => setSearch(''),
      });
    if (mineActive && meScope)
      chips.push({
        key: 'mine',
        label: 'Scope',
        value: meScope.label,
        onClear: () => setMineActive(false),
      });
    return chips;
  }, [columnFilters, allFacets, search, mineActive, meScope]);

  const showEmpty = data.length === 0;
  const showFilteredEmpty = !showEmpty && totalRows === 0;

  // Shared per-facet render body — used both for top-level `facets` (inline
  // in the toolbar) and for facets nested inside a `facetGroups` popover.
  // Identical logic either way: resolve options (fixed valueOptions or the
  // column's faceted unique values), read the current selection out of
  // columnFilters, write back on change.
  const renderFacet = (f: FacetConfig) => {
    const col = table.getColumn(f.columnId);
    if (!col) return null;
    const options =
      f.valueOptions?.map((v) => ({ value: v, label: v })) ??
      Array.from(col.getFacetedUniqueValues().keys())
        // Blank/whitespace values would render as an empty selectable row —
        // drop them from the derived vocabulary, matching filter-rows.ts::
        // getFacetOptions (the export sheet's equivalent derivation). Rows
        // with a blank value stay reachable by clearing the facet.
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .sort()
        .map((v) => ({ value: v, label: v }));
    const selected =
      (columnFilters.find((cf) => cf.id === f.columnId)?.value as string[]) ??
      [];
    return (
      <FacetDropdown
        key={f.columnId}
        label={f.label}
        options={options}
        selected={selected}
        onChange={(next) =>
          setColumnFilters((prev) => {
            const without = prev.filter((p) => p.id !== f.columnId);
            return next.length
              ? [...without, { id: f.columnId, value: next }]
              : without;
          })
        }
      />
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {toolbarLeading}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-50" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 w-56 pl-7 text-xs"
          />
        </div>
        {meScope && meScopeEnabled && (
          <Toggle
            pressed={mineActive}
            onPressedChange={setMineActive}
            size="sm"
            className="h-8"
            aria-label={meScope.label}
          >
            {meScope.icon && <meScope.icon className="mr-1 h-3.5 w-3.5" />}
            {meScope.label}
          </Toggle>
        )}
        {facets.map(renderFacet)}
        {facetGroups.map((group) => {
          const activeCount = group.facets.reduce((sum, f) => {
            const selected =
              (columnFilters.find((cf) => cf.id === f.columnId)
                ?.value as string[]) ?? [];
            return sum + selected.length;
          }, 0);
          return (
            <Popover key={group.label}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-dashed"
                >
                  {group.label}
                  {activeCount > 0 && (
                    <>
                      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                      <Badge
                        variant="secondary"
                        className="rounded-sm px-1 font-mono text-[10px]"
                      >
                        {activeCount}
                      </Badge>
                    </>
                  )}
                  <ChevronDown
                    className="ml-1 h-3 w-3 opacity-60"
                    aria-hidden
                  />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 space-y-1.5 p-2" align="start">
                {group.facets.map(renderFacet)}
              </PopoverContent>
            </Popover>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          {toolbarTrailing}
          {csv && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setExportOpen(true)}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              Export CSV
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <Columns3 className="mr-1 h-3.5 w-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table
                .getAllColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={c.getIsVisible()}
                    onCheckedChange={(v) => c.toggleVisibility(Boolean(v))}
                  >
                    {typeof c.columnDef.header === 'string'
                      ? c.columnDef.header
                      : c.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Status tabs */}
      {statusTabs && (
        <Tabs value={statusTab} onValueChange={setStatusTab}>
          <TabsList>
            {statusTabs.map((t) => {
              const count = t.countOverride
                ? t.countOverride(tabCountData)
                : tabCountData.filter(t.predicate).length;
              return (
                <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
                  <span>{t.label}</span>
                  <span className="rounded-sm bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                    {count}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      )}

      {/* Active-filter chip strip */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <FilterChip
              key={chip.key}
              label={chip.label}
              value={chip.value}
              onClear={chip.onClear}
            />
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setColumnFilters([]);
              setSearch('');
              setMineActive(false);
            }}
          >
            <X className="mr-1 h-3 w-3" />
            Clear all
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader
              className={cn(stickyHeader && 'sticky top-0 z-10 bg-background')}
            >
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => (
                    <TableHead
                      key={h.id}
                      className="font-mono text-[10px] uppercase tracking-[0.12em]"
                    >
                      {h.isPlaceholder
                        ? null
                        : flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {showEmpty ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="p-0">
                    <DataTableEmptyState
                      {...(emptyState ?? { title: 'No data.' })}
                    />
                  </TableCell>
                </TableRow>
              ) : showFilteredEmpty ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="p-0">
                    <DataTableEmptyState
                      title={emptyFilteredState?.title ?? 'No matches.'}
                      body={emptyFilteredState?.body ?? 'Try clearing filters.'}
                    />
                  </TableCell>
                </TableRow>
              ) : expandable?.enabled ? (
                (() => {
                  const rows = table.getRowModel().rows;
                  const groups: { key: string; rows: typeof rows }[] = [];
                  const indexByKey = new Map<string, number>();
                  for (const r of rows) {
                    const key = expandable.groupBy(r.original);
                    let idx = indexByKey.get(key);
                    if (idx === undefined) {
                      idx = groups.length;
                      indexByKey.set(key, idx);
                      groups.push({ key, rows: [] });
                    }
                    groups[idx].rows.push(r);
                  }
                  return groups.map((g) => {
                    const isExpanded = !collapsedGroups.has(g.key);
                    const toggle = () =>
                      setCollapsedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.key)) next.delete(g.key);
                        else next.add(g.key);
                        return next;
                      });
                    return (
                      <Fragment key={g.key}>
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={columns.length} className="p-0">
                            {expandable.renderGroupHeader({
                              key: g.key,
                              rows: g.rows.map((r) => r.original),
                              isExpanded,
                              toggle,
                            })}
                          </TableCell>
                        </TableRow>
                        {isExpanded &&
                          g.rows.map((r) => (
                            <TableRow
                              key={r.id}
                              className="group"
                              data-state={r.getIsSelected() && 'selected'}
                            >
                              {r.getVisibleCells().map((c) => (
                                <TableCell key={c.id}>
                                  {flexRender(
                                    c.column.columnDef.cell,
                                    c.getContext()
                                  )}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                      </Fragment>
                    );
                  });
                })()
              ) : (
                table.getRowModel().rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="group"
                    data-state={r.getIsSelected() && 'selected'}
                  >
                    {r.getVisibleCells().map((c) => (
                      <TableCell key={c.id}>
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!hidePagination && totalRows > 0 && (
          <div className="border-t border-border bg-muted/20">
            <DataTablePagination
              table={table}
              pageSizeOptions={pageSizeOptions}
            />
          </div>
        )}
      </div>

      {selection?.enabled && selection.bulkActions && (
        <BulkActionFooter
          selectedRows={selectedRows}
          actions={selection.bulkActions}
          onClear={() => table.resetRowSelection()}
        />
      )}

      {csv && exportEverOpened && (
        <DataTableExportSheet
          open={exportOpen}
          onOpenChange={setExportOpen}
          data={data}
          columns={columns}
          // Flattened union — grouped facets (facetGroups) must be
          // first-class in the export sheet too, or a grouped selection
          // silently narrows the export with no visible/clearable control.
          facets={allFacets}
          searchKeys={searchKeys}
          csv={csv}
          statusTabs={statusTabs}
          meScope={meScopeEnabled ? meScope : undefined}
          selectionEnabled={Boolean(selection?.enabled)}
          selectedRows={selectedRows}
          seed={{
            search,
            mine: mineActive,
            facets: columnFilters.map((f) => ({
              id: f.id,
              values: (Array.isArray(f.value) ? f.value : []).map(String),
            })),
            statusTab,
            visibleColumnIds: table
              .getVisibleLeafColumns()
              .filter((c) => c.id !== 'select')
              .map((c) => c.id),
            initialSortId: sorting[0]?.id,
            initialSortDesc: sorting[0]?.desc,
          }}
        />
      )}
    </div>
  );
}
