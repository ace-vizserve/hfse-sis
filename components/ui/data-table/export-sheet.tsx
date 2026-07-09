'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, GripVertical, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { exportCsv } from './csv';
import { FacetDropdown } from './facet-dropdown';
import {
  filterRows,
  getFacetOptions,
  resolveColumnValue,
  type FacetSelection,
} from './filter-rows';
import { humanizeFieldName } from './humanize-field';
import type {
  CsvConfig,
  CsvRawColumnSource,
  FacetConfig,
  MeScopeConfig,
  StatusTabConfig,
} from './types';

// Non-data columns every DataTable consumer uses the same ids for — never
// offered as export fields.
const NON_DATA_COLUMN_IDS = new Set(['select', 'actions']);

// Radix Select/RadioGroup reject empty-string values. Sentinel stays
// client-side only.
const SORT_UNSET = '__none';

function resolveHeaderLabel<TRow>(col: ColumnDef<TRow>): string {
  const id = col.id ?? (col as { accessorKey?: string }).accessorKey ?? '';
  return typeof col.header === 'string' ? col.header : id;
}

function resolveColumnId<TRow>(col: ColumnDef<TRow>): string {
  return col.id ?? (col as { accessorKey?: string }).accessorKey ?? '';
}

// An on-screen column whose raw accessor value isn't presentable as-is
// (composite cells, raw enums/snake_case, unformatted dates) can opt out of
// the export picker via `meta: { excludeFromExport: true }` — pair it with
// a `csv.extraColumns` entry that supplies the humanized equivalent instead
// of leaving both the raw and humanized versions checkable side by side.
function isExportableColumn<TRow>(col: ColumnDef<TRow>): boolean {
  const id = resolveColumnId(col);
  if (NON_DATA_COLUMN_IDS.has(id)) return false;
  const meta = col.meta as { excludeFromExport?: boolean } | undefined;
  return !meta?.excludeFromExport;
}

// One exportable field, regardless of whether it came from an on-screen
// column or a page's declared `csv.extraColumns` — the column checklist,
// sort picker, and CSV-column builder all work off this unified shape so
// "sort by an export-only field" and "sort by an on-screen field" are the
// same code path.
type ExportField<TRow> = {
  id: string;
  header: string;
  source: 'column' | 'extra' | 'raw';
  accessor: (row: TRow, index: number) => string | number | null;
};

// One database-source's "load all columns" state, lazily fetched. `stale`
// means the loaded data no longer matches the current export scope (a
// filter/scope change happened after loading) — its fields are dropped from
// checkedCols/columnOrder when this happens (see the invalidation effect)
// so a stale/partial value can never silently end up in an export.
type RawSourceState = {
  status: 'idle' | 'loading' | 'loaded' | 'stale' | 'error';
  error?: string;
  colNames: string[];
  data: Record<string, Record<string, unknown>>;
};

const IDLE_RAW_STATE: RawSourceState = {
  status: 'idle',
  colNames: [],
  data: {},
};

export type DataTableExportSeed = {
  search: string;
  facets: FacetSelection[];
  statusTab?: string;
  /** Whether the shell's me-scope toggle ("Only mine", …) is active — the
   *  export must honour the same scope the on-screen table shows. */
  mine: boolean;
  visibleColumnIds: string[];
  initialSortId?: string;
  initialSortDesc?: boolean;
};

export type DataTableExportSheetProps<TRow> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: TRow[];
  columns: ColumnDef<TRow>[];
  facets: FacetConfig[];
  searchKeys?: Array<keyof TRow | ((row: TRow) => string)>;
  csv: CsvConfig<TRow>;
  statusTabs?: Array<StatusTabConfig<TRow>>;
  /** Passed only when the shell's me-scope toggle is enabled — lets the
   *  export apply (and the user adjust) the same "mine" scope. */
  meScope?: MeScopeConfig<TRow>;
  selectionEnabled: boolean;
  selectedRows: TRow[];
  seed: DataTableExportSeed;
};

export function DataTableExportSheet<TRow>({
  open,
  onOpenChange,
  data,
  columns,
  facets,
  searchKeys,
  csv,
  statusTabs,
  meScope,
  selectionEnabled,
  selectedRows,
  seed,
}: DataTableExportSheetProps<TRow>) {
  const columnFields = useMemo<ExportField<TRow>[]>(
    () =>
      columns
        .filter((c) => isExportableColumn(c))
        .map((c) => {
          const id = resolveColumnId(c);
          return {
            id,
            header: resolveHeaderLabel(c),
            source: 'column' as const,
            accessor: (row: TRow, index: number) => {
              const v = resolveColumnValue(columns, id, row, index);
              if (v == null) return null;
              // Match the on-screen Yes/No convention (field-grid.tsx) rather
              // than exporting the literal strings "true"/"false".
              if (typeof v === 'boolean') return v ? 'Yes' : 'No';
              return v as string | number;
            },
          };
        }),
    [columns]
  );

  const extraFields = useMemo<ExportField<TRow>[]>(
    () =>
      (csv.extraColumns ?? []).map((e) => ({
        id: e.id,
        header: e.header,
        source: 'extra' as const,
        accessor: (row: TRow) => e.accessor(row),
      })),
    [csv.extraColumns]
  );

  // Per-source "load all database columns" state (Idle until the user asks
  // for it — see csv.rawColumns, opt-in per table).
  const [rawBySource, setRawBySource] = useState<
    Record<string, RawSourceState>
  >({});

  const rawFields = useMemo<ExportField<TRow>[]>(() => {
    if (!csv.rawColumns) return [];
    const { keyOf, sources } = csv.rawColumns;
    return sources.flatMap((src) => {
      const state = rawBySource[src.id];
      if (state?.status !== 'loaded') return [];
      return state.colNames.map((col) => ({
        id: `raw:${src.id}:${col}`,
        header: `${humanizeFieldName(col)} (${src.label})`,
        source: 'raw' as const,
        accessor: (row: TRow): string | number | null => {
          const v = state.data[keyOf(row)]?.[col];
          if (v == null) return null;
          if (typeof v === 'boolean') return v ? 'Yes' : 'No';
          if (typeof v === 'object') return JSON.stringify(v);
          return v as string | number;
        },
      }));
    });
  }, [csv.rawColumns, rawBySource]);

  const allFields = useMemo(
    () => [...columnFields, ...extraFields, ...rawFields],
    [columnFields, extraFields, rawFields]
  );

  const showScopeChoice = selectionEnabled && selectedRows.length > 0;

  const [scope, setScope] = useState<'selected' | 'filtered'>('filtered');
  const [search, setSearch] = useState(seed.search);
  const [debouncedSearch, setDebouncedSearch] = useState(seed.search);
  const [facetSel, setFacetSel] = useState<FacetSelection[]>(seed.facets);
  const [statusTab, setStatusTab] = useState<string | undefined>(
    seed.statusTab
  );
  const [mine, setMine] = useState<boolean>(Boolean(seed.mine && meScope));
  const [checkedCols, setCheckedCols] = useState<Set<string>>(new Set());
  // Export column ORDER — the single source of truth for the order columns
  // appear in the downloaded CSV. Independent of `checkedCols` (membership);
  // kept in sync by `toggleCol` and directly reordered via drag in the
  // "Selected columns" pane.
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  // Filters the available-COLUMNS checklist (which fields to add) — distinct
  // from `search` above, which filters which ROWS get exported.
  const [columnSearch, setColumnSearch] = useState('');

  // Checked ids, in export order — drives both the "Selected columns" drag
  // pane and (via handleExport) the actual CSV column order.
  const selectedFieldIds = useMemo(
    () => columnOrder.filter((id) => checkedCols.has(id)),
    [columnOrder, checkedCols]
  );
  const [sortCol, setSortCol] = useState<string | undefined>(
    seed.initialSortId
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(
    seed.initialSortDesc ? 'desc' : 'asc'
  );

  // Copy every field from `seed` by VALUE on each open — the sheet's state
  // must never alias the shell's live filter/sort state (edits here must
  // not leak back into the on-screen table), but re-seeding on open keeps
  // "what I'm looking at" as the default starting point.
  useEffect(() => {
    if (!open) return;
    setScope(showScopeChoice ? 'selected' : 'filtered');
    setSearch(seed.search);
    setDebouncedSearch(seed.search);
    setFacetSel(seed.facets.map((f) => ({ id: f.id, values: [...f.values] })));
    setStatusTab(seed.statusTab);
    setMine(Boolean(seed.mine && meScope));
    setColumnSearch('');
    setRawBySource({});
    const checked = new Set<string>();
    columnFields.forEach((f) => {
      if (seed.visibleColumnIds.includes(f.id)) checked.add(f.id);
    });
    (csv.extraColumns ?? []).forEach((e) => {
      if (e.defaultChecked) checked.add(e.id);
    });
    setCheckedCols(checked);
    // Initial export order — checked on-screen columns first (declaration
    // order), then checked defaultChecked extras. Matches what a plain,
    // untouched export looked like before drag-reordering existed.
    setColumnOrder(
      [...columnFields, ...extraFields]
        .map((f) => f.id)
        .filter((id) => checked.has(id))
    );
    setSortCol(seed.initialSortId);
    setSortDir(seed.initialSortDesc ? 'desc' : 'asc');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounce the search box feeding the live preview — facet/status changes
  // are discrete clicks and recompute immediately.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  // Monotonic scope epoch — bumped whenever the export's row-scope inputs
  // change. `handleLoadRaw` captures the epoch when a fetch launches; a
  // resolution from an older epoch is keyed to a row set that no longer
  // matches the current scope, so it lands as 'stale' (never 'loaded') and
  // the group's auto-load refetches with the current keys. Guards the
  // in-flight case the effect below can't see (it only flips 'loaded').
  const scopeEpochRef = useRef(0);

  // A loaded raw-columns source is only valid for the row keys it was
  // fetched for. When the export scope changes after loading, mark it
  // stale AND drop its fields from checkedCols/columnOrder — a stale field
  // must never be silently exportable with partial/wrong data. No-ops on
  // first mount (rawBySource starts empty until the user loads something).
  useEffect(() => {
    scopeEpochRef.current += 1;
    setRawBySource((prev) => {
      const staleIds = Object.entries(prev)
        .filter(([, s]) => s.status === 'loaded')
        .map(([id]) => id);
      if (staleIds.length === 0) return prev;
      const next = { ...prev };
      for (const id of staleIds) {
        next[id] = { ...next[id], status: 'stale' };
      }
      return next;
    });
  }, [scope, debouncedSearch, facetSel, statusTab, mine]);

  useEffect(() => {
    if (Object.values(rawBySource).every((s) => s.status !== 'stale')) return;
    const staleFieldIds = new Set(
      rawFields
        .filter((f) => {
          const srcId = f.id.split(':')[1];
          return rawBySource[srcId ?? '']?.status === 'stale';
        })
        .map((f) => f.id)
    );
    if (staleFieldIds.size === 0) return;
    setCheckedCols((prev) => {
      const next = new Set(prev);
      staleFieldIds.forEach((id) => next.delete(id));
      return next;
    });
    setColumnOrder((prev) => prev.filter((id) => !staleFieldIds.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawBySource]);

  async function handleLoadRaw(source: CsvRawColumnSource) {
    if (!csv.rawColumns) return;
    const epoch = scopeEpochRef.current;
    setRawBySource((prev) => ({
      ...prev,
      [source.id]: { ...IDLE_RAW_STATE, status: 'loading' },
    }));
    try {
      const keys = previewRows.map(csv.rawColumns.keyOf);
      const data = await source.fetch(keys);
      if (epoch !== scopeEpochRef.current) {
        // Scope changed while this fetch was in flight — its payload is
        // keyed to the OLD row set (newly-matched rows would export blank
        // cells). Land it as 'stale' so the open group auto-reloads with
        // the current keys instead of silently accepting old data.
        setRawBySource((prev) => ({
          ...prev,
          [source.id]: { ...IDLE_RAW_STATE, status: 'stale' },
        }));
        return;
      }
      const colNames = Array.from(
        new Set(Object.values(data).flatMap((row) => Object.keys(row)))
      );
      setRawBySource((prev) => ({
        ...prev,
        [source.id]: { status: 'loaded', colNames, data },
      }));
    } catch (e) {
      if (epoch !== scopeEpochRef.current) {
        setRawBySource((prev) => ({
          ...prev,
          [source.id]: { ...IDLE_RAW_STATE, status: 'stale' },
        }));
        return;
      }
      setRawBySource((prev) => ({
        ...prev,
        [source.id]: {
          ...IDLE_RAW_STATE,
          status: 'error',
          error: e instanceof Error ? e.message : 'Failed to load columns',
        },
      }));
    }
  }

  // Drag reordering for the "Selected columns" pane. A small pointer
  // activation distance keeps a drag from swallowing the row's own remove
  // click; the keyboard sensor keeps reordering usable without a mouse.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  // Tracks the row being dragged so DragOverlay can render a floating copy
  // that follows the pointer — without this, dnd-kit only shifts sibling
  // rows in place and the dragged item itself gives no "lifted" feedback,
  // which reads poorly as the first drag interaction in this codebase.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColumnOrder((prev) => {
      const from = prev.indexOf(String(active.id));
      const to = prev.indexOf(String(over.id));
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  }

  function toggleCol(id: string, checked: boolean) {
    setCheckedCols((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    // columnOrder is the export-order source of truth (drag-reordered by the
    // user in the "Selected columns" pane) — checking appends to the end,
    // unchecking removes; re-checking later re-appends at the end.
    setColumnOrder((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  }

  function toggleFacet(columnId: string, values: string[]) {
    setFacetSel((prev) => {
      const without = prev.filter((f) => f.id !== columnId);
      return values.length ? [...without, { id: columnId, values }] : without;
    });
  }

  // Facet dropdown options, one full `data` scan per facet — memoized so
  // typing in the search box / toggling other filters (state changes that
  // don't touch `data`/`columns`/`facets`) doesn't re-derive every facet's
  // option list on every keystroke.
  const facetOptionsById = useMemo(() => {
    const map = new Map<string, Array<{ value: string; label: string }>>();
    for (const f of facets) {
      map.set(f.columnId, getFacetOptions(data, columns, f));
    }
    return map;
  }, [data, columns, facets]);

  // Rows this export would include — the SAME `filterRows` helper the shell
  // uses for its per-tab counts, so this can never disagree with what the
  // user sees reflected elsewhere in the table (KD #82/#84).
  const previewRows = useMemo(() => {
    if (scope === 'selected') return selectedRows;
    let rows = data;
    if (statusTabs && statusTab) {
      const tab = statusTabs.find((t) => t.value === statusTab);
      if (tab) rows = rows.filter(tab.predicate);
    }
    // Mirror the shell's on-screen scoping (tabFilteredData): the me-scope
    // toggle narrows the export exactly like it narrows the visible table.
    if (mine && meScope) {
      rows = rows.filter((r) => meScope.predicate(r, meScope.userId));
    }
    return filterRows(rows, {
      columns,
      facets: facetSel,
      search: debouncedSearch,
      searchKeys,
    });
  }, [
    scope,
    selectedRows,
    data,
    statusTabs,
    statusTab,
    mine,
    meScope,
    columns,
    facetSel,
    debouncedSearch,
    searchKeys,
  ]);

  function applySort(rows: TRow[]): TRow[] {
    if (!sortCol) return rows;
    const field = allFields.find((f) => f.id === sortCol);
    if (!field) return rows;
    const withValue = rows.map((r, i) => ({ r, v: field.accessor(r, i) }));
    withValue.sort((a, b) => {
      if (a.v == null && b.v == null) return 0;
      if (a.v == null) return 1; // nulls last regardless of direction
      if (b.v == null) return -1;
      const cmp =
        typeof a.v === 'number' && typeof b.v === 'number'
          ? a.v - b.v
          : String(a.v).localeCompare(String(b.v));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return withValue.map((x) => x.r);
  }

  function handleExport() {
    const rows = applySort(previewRows);
    // Map row -> final position so each field's accessor can resolve
    // accessorFn(row, index) against the row's real place in the exported
    // file (O(1) per row via the map, avoids an O(n^2) indexOf scan).
    const rowIndex = new Map<TRow, number>(rows.map((r, i) => [r, i]));
    const byId = new Map(allFields.map((f) => [f.id, f]));
    // Column ORDER (not allFields' declaration order) drives export column
    // order — this is what the "Selected columns" drag pane reorders.
    const cols = columnOrder
      .filter((id) => checkedCols.has(id))
      .map((id) => byId.get(id))
      .filter((f): f is ExportField<TRow> => Boolean(f))
      .map((f) => ({
        header: f.header,
        accessor: (row: TRow) => f.accessor(row, rowIndex.get(row) ?? 0),
      }));
    exportCsv(rows, cols, csv.filename);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-lg">
        <ScrollArea className="h-full">
          <SheetHeader className="space-y-2 border-b border-border p-6">
            <SheetTitle>Export CSV</SheetTitle>
            <SheetDescription>
              Choose what to include, then download.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 p-6">
            {showScopeChoice && (
              <section className="space-y-3">
                <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
                  Rows to export
                </h3>
                <RadioGroup
                  value={scope}
                  onValueChange={(v) => setScope(v as 'selected' | 'filtered')}
                >
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <RadioGroupItem value="selected" />
                    Selected rows ({selectedRows.length})
                  </label>
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <RadioGroupItem value="filtered" />
                    Rows matching the filters below
                  </label>
                </RadioGroup>
              </section>
            )}

            <section className="space-y-3">
              <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
                Columns
              </h3>
              <Input
                value={columnSearch}
                onChange={(e) => setColumnSearch(e.target.value)}
                placeholder="Filter columns…"
                className="h-8 text-xs"
              />
              <div className="space-y-1">
                <ColumnGroup
                  title="On screen"
                  fields={columnFields}
                  checkedCols={checkedCols}
                  toggleCol={toggleCol}
                  search={columnSearch}
                  defaultOpen
                />
                <ColumnGroup
                  title="Export only — not shown on screen"
                  fields={extraFields}
                  checkedCols={checkedCols}
                  toggleCol={toggleCol}
                  search={columnSearch}
                  defaultOpen
                />
                {csv.rawColumns?.sources.map((src) => (
                  <RawColumnGroup
                    key={src.id}
                    source={src}
                    state={rawBySource[src.id] ?? IDLE_RAW_STATE}
                    fields={rawFields.filter((f) =>
                      f.id.startsWith(`raw:${src.id}:`)
                    )}
                    checkedCols={checkedCols}
                    toggleCol={toggleCol}
                    search={columnSearch}
                    onLoad={() => handleLoadRaw(src)}
                  />
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <div className="space-y-0.5">
                <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
                  Selected columns
                </h3>
                {selectedFieldIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Drag the grip to set the order columns appear in the file.
                  </p>
                )}
              </div>
              {selectedFieldIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Check a column above to add it here — drag to set the export
                  order.
                </p>
              ) : (
                <DndContext
                  sensors={dndSensors}
                  collisionDetection={closestCenter}
                  onDragStart={(e: DragStartEvent) =>
                    setActiveDragId(String(e.active.id))
                  }
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => setActiveDragId(null)}
                >
                  <SortableContext
                    items={selectedFieldIds}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="space-y-1">
                      {selectedFieldIds.map((id) => {
                        const field = allFields.find((f) => f.id === id);
                        if (!field) return null;
                        return (
                          <SortableColumnRow
                            key={id}
                            id={id}
                            label={field.header}
                            onRemove={() => toggleCol(id, false)}
                          />
                        );
                      })}
                    </ul>
                  </SortableContext>
                  <DragOverlay>
                    {activeDragId
                      ? (() => {
                          const field = allFields.find(
                            (f) => f.id === activeDragId
                          );
                          return field ? (
                            <div className="flex items-center gap-2 rounded-md border border-brand-indigo/40 bg-card px-2 py-1.5 text-sm text-foreground shadow-lg">
                              <GripVertical
                                className="size-4 text-muted-foreground"
                                aria-hidden
                              />
                              <span className="flex-1 truncate">
                                {field.header}
                              </span>
                            </div>
                          ) : null;
                        })()
                      : null}
                  </DragOverlay>
                </DndContext>
              )}
            </section>

            <section
              className={cn(
                'space-y-3',
                scope === 'selected' && 'pointer-events-none opacity-50'
              )}
              // aria-disabled isn't a valid attribute for <section>'s implicit
              // role — pointer-events-none + opacity above already conveys the
              // disabled state; screen readers still see the (unreachable via
              // pointer) live filter controls, which is an acceptable minor
              // gap for this small, secondary bit of UI.
            >
              <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
                Filters
              </h3>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="h-8 text-xs"
              />
              {meScope && (
                <Toggle
                  pressed={mine}
                  onPressedChange={setMine}
                  size="sm"
                  className="h-8"
                  aria-label={meScope.label}
                >
                  {meScope.icon && (
                    <meScope.icon className="mr-1 h-3.5 w-3.5" />
                  )}
                  {meScope.label}
                </Toggle>
              )}
              {statusTabs && statusTabs.length > 0 && (
                <Select value={statusTab} onValueChange={setStatusTab}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {statusTabs.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {facets.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {facets.map((f) => (
                    <FacetDropdown
                      key={f.columnId}
                      label={f.label}
                      options={facetOptionsById.get(f.columnId) ?? []}
                      selected={
                        facetSel.find((s) => s.id === f.columnId)?.values ?? []
                      }
                      onChange={(next) => toggleFacet(f.columnId, next)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
                Sort export by
              </h3>
              <div className="flex items-center gap-3">
                <Select
                  value={sortCol ?? SORT_UNSET}
                  onValueChange={(v) =>
                    setSortCol(v === SORT_UNSET ? undefined : v)
                  }
                >
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue placeholder="No sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SORT_UNSET}>No sort</SelectItem>
                    {allFields.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.header}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <RadioGroup
                  value={sortDir}
                  onValueChange={(v) => setSortDir(v as 'asc' | 'desc')}
                  className={cn(
                    'flex flex-row gap-3',
                    !sortCol && 'pointer-events-none opacity-50'
                  )}
                >
                  <label className="flex items-center gap-1.5 text-xs text-foreground">
                    <RadioGroupItem value="asc" />
                    Ascending
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-foreground">
                    <RadioGroupItem value="desc" />
                    Descending
                  </label>
                </RadioGroup>
              </div>
            </section>
          </div>

          <SheetFooter className="flex-row items-center justify-between gap-2 border-t border-border p-6 sm:justify-between">
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {previewRows.length.toLocaleString('en-SG')} rows ·{' '}
              {checkedCols.size} column{checkedCols.size === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <SheetClose asChild>
                <Button type="button" variant="outline" size="sm">
                  Cancel
                </Button>
              </SheetClose>
              <Button
                type="button"
                size="sm"
                onClick={handleExport}
                disabled={previewRows.length === 0 || checkedCols.size === 0}
              >
                Export CSV
              </Button>
            </div>
          </SheetFooter>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// One collapsible, searchable, checkable group of export fields (on-screen /
// export-only / a raw database source). `defaultOpen` sets the group's own
// toggle state; while `search` is non-empty the group ignores that state and
// forces itself open when it has a match, closed (unrendered) when it
// doesn't — so a 150+ item raw group doesn't dominate the panel until the
// user actually asks for it.
function ColumnGroup<TRow>({
  title,
  fields,
  checkedCols,
  toggleCol,
  search,
  defaultOpen = false,
}: {
  title: string;
  fields: ExportField<TRow>[];
  checkedCols: Set<string>;
  toggleCol: (id: string, checked: boolean) => void;
  search: string;
  defaultOpen?: boolean;
}) {
  const [manualOpen, setManualOpen] = useState(defaultOpen);

  const filtered = useMemo(() => {
    if (!search) return fields;
    const q = search.toLowerCase();
    return fields.filter((f) => f.header.toLowerCase().includes(q));
  }, [fields, search]);

  if (fields.length === 0) return null;
  if (search && filtered.length === 0) return null;

  const isOpen = search ? true : manualOpen;

  return (
    <Collapsible open={isOpen} onOpenChange={setManualOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </span>
        <Badge
          variant="secondary"
          className="h-5 px-1.5 font-mono text-[10px] tabular-nums"
        >
          {filtered.length}
        </Badge>
        <ChevronDown
          className={cn(
            'ml-auto size-3.5 text-muted-foreground transition-transform',
            isOpen && 'rotate-180'
          )}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5 py-1.5">
        {filtered.map((f) => (
          <label
            key={f.id}
            className="flex items-center gap-2 pl-2 text-sm text-foreground"
          >
            <Checkbox
              checked={checkedCols.has(f.id)}
              onCheckedChange={(v) => toggleCol(f.id, Boolean(v))}
            />
            {f.header}
          </label>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

// One row in the "Selected columns" drag-to-reorder pane. Only the grip
// handle is draggable (not the whole row) so the remove button stays a
// normal click.
function SortableColumnRow({
  id,
  label,
  onRemove,
}: {
  id: string;
  label: string;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground',
        // DragOverlay renders the "real" dragged copy that follows the
        // pointer — while dragging, this original just marks the vacated
        // slot, so it reads as a placeholder rather than a second copy.
        isDragging && 'border-dashed opacity-30'
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={`Reorder ${label}`}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="flex-1 truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive"
        aria-label={`Remove ${label} from export`}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

// A raw database source's group — same collapsible/checkable shape as
// ColumnGroup, but the field list is empty until the user clicks "Load all
// columns" (a live fetch, never a static list — see CsvRawColumnsConfig),
// so it needs its own idle/loading/stale/error states instead of just
// hiding when `fields` is empty.
function RawColumnGroup<TRow>({
  source,
  state,
  fields,
  checkedCols,
  toggleCol,
  search,
  onLoad,
}: {
  source: CsvRawColumnSource;
  state: RawSourceState;
  fields: ExportField<TRow>[];
  checkedCols: Set<string>;
  toggleCol: (id: string, checked: boolean) => void;
  search: string;
  onLoad: () => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return fields;
    const q = search.toLowerCase();
    return fields.filter((f) => f.header.toLowerCase().includes(q));
  }, [fields, search]);

  const isOpen = search ? true : manualOpen;

  // Auto-load once the group is actually visible (opened by the user, or
  // auto-expanded because a search matched it) — no manual "Load" click
  // needed. Self-terminating: onLoad flips status to 'loading' on the next
  // render, so the idle/stale condition below stops matching. `stale`
  // (a filter/scope change invalidated a previous load) refetches the same
  // way, so a group that's already open stays fresh without user action.
  // Runs before the early-return below — hooks can't follow a conditional
  // return (Rules of Hooks).
  useEffect(() => {
    if (isOpen && (state.status === 'idle' || state.status === 'stale')) {
      onLoad();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, state.status]);

  // Hide only when actively searching, already loaded, and nothing matches
  // — otherwise the group must stay visible so its Load/Retry/Reload button
  // stays reachable.
  if (search && state.status === 'loaded' && filtered.length === 0) {
    return null;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setManualOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          All {source.label} columns
        </span>
        {state.status === 'loaded' && (
          <Badge
            variant="secondary"
            className="h-5 px-1.5 font-mono text-[10px] tabular-nums"
          >
            {filtered.length}
          </Badge>
        )}
        <ChevronDown
          className={cn(
            'ml-auto size-3.5 text-muted-foreground transition-transform',
            isOpen && 'rotate-180'
          )}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5 py-1.5 pl-2">
        {state.status === 'idle' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onLoad}
          >
            Load all columns
          </Button>
        )}
        {state.status === 'loading' && (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
        {state.status === 'error' && (
          <div className="space-y-1.5">
            <p className="text-xs text-destructive">
              {state.error ?? "Couldn't load columns."}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onLoad}
            >
              Retry
            </Button>
          </div>
        )}
        {state.status === 'stale' && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Filters changed — reload to include these columns again.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onLoad}
            >
              Reload
            </Button>
          </div>
        )}
        {state.status === 'loaded' &&
          (search ? (
            filtered.length > 0 ? (
              filtered.map((f) => (
                <label
                  key={f.id}
                  className="flex items-center gap-2 pl-2 text-sm text-foreground"
                >
                  <Checkbox
                    checked={checkedCols.has(f.id)}
                    onCheckedChange={(v) => toggleCol(f.id, Boolean(v))}
                  />
                  {f.header}
                </label>
              ))
            ) : (
              <p className="pl-2 text-xs text-muted-foreground">
                No columns match &quot;{search}&quot;.
              </p>
            )
          ) : (
            // A raw source can carry 100+ columns — dumping them all as
            // checkboxes defeats the point of a picker. Require the search
            // box above to narrow before anything renders.
            <p className="pl-2 text-xs text-muted-foreground">
              Search above to find any of the {fields.length} loaded columns.
            </p>
          ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
