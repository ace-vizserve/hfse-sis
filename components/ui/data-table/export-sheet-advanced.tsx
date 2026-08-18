'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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
import { Download, GripVertical, Loader2, Plus, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

import { resolveColumnDefLabel } from './column-label';
import { exportCsv } from './csv';
import {
  fieldsToCsvColumns,
  isExportableColumn,
  resolveColumnId,
  type ExportField,
} from './export-payload';
import {
  addChild,
  applyFilterRules,
  countRules,
  distinctValuesFor,
  inferFieldType,
  operatorsFor,
  removeNode,
  updateNode,
  type FieldType,
  type FilterGroup,
  type FilterNode,
  type FilterRule,
  type OperatorId,
} from './export-filter-rules';
import {
  filterRows,
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

// The advanced export sheet — pick and reorder individual fields, set a
// sort and a limit, and see exactly how many rows the file will contain.
//
// OPT-IN ONLY, via `csv.advanced`. KD #162 removed the shared five-section
// sheet because 14 of 16 exporting tables had nothing to configure; that
// finding still stands, so a table without the flag keeps its instant
// download and never mounts this. This exists for the exception KD #162
// itself named — a table with a defined "full" field set beyond the screen.
//
// Most of the machinery below is recovered from that deleted sheet
// (`git show 33cadd30^:components/ui/data-table/export-sheet.tsx`) rather
// than rewritten: the scope-epoch guard, the stale-source invalidation and
// the drag reordering were all correct and hard-won. Two things deliberately
// did NOT come back:
//
//   1. The old sheet JSON-stringified object-valued columns. KD #162 changed
//      that to dropping them entirely, and the probe must scan EVERY value —
//      `residenceHistory` is a JSON string on some production rows and a real
//      array on others, so sampling the first non-null value made the result
//      depend on which row happened to sort first.
//   2. Its private copies of `resolveColumnId` / `isExportableColumn` /
//      `ExportField`. Those now live in `export-payload.ts` and are shared
//      with the instant-download path, so the two can never diverge.

const SORT_UNSET = '__none';

/** An exportable field plus where it came from, so the UI can mark raw
 *  database fields without labelling the ordinary on-screen ones. */
type AdvancedField<TRow> = ExportField<TRow> & {
  sourceKind: 'column' | 'extra' | 'raw';
  /** Only for raw fields — the declared source label, e.g. "Applications". */
  sourceLabel?: string;
};

/** One raw source's lazily-fetched state. `stale` means the loaded payload
 *  no longer matches the current row scope, so its fields are dropped from
 *  the selection rather than silently exporting values for the wrong rows. */
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
  mine: boolean;
  visibleColumnIds: string[];
  initialSortId?: string;
  initialSortDesc?: boolean;
};

export type DataTableExportSheetAdvancedProps<TRow> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every row the table holds, before the screen's own filters. */
  data: TRow[];
  /** The rows the screen is showing right now — supplied by the shell so the
   *  "on screen" figure is the shell's own count, never re-derived here. */
  screenRowCount: number;
  columns: ColumnDef<TRow>[];
  facets: FacetConfig[];
  searchKeys?: Array<keyof TRow | ((row: TRow) => string)>;
  csv: CsvConfig<TRow>;
  statusTabs?: Array<StatusTabConfig<TRow>>;
  meScope?: MeScopeConfig<TRow>;
  selectionEnabled: boolean;
  selectedRows: TRow[];
  seed: DataTableExportSeed;
};

export function DataTableExportSheetAdvanced<TRow>({
  open,
  onOpenChange,
  data,
  screenRowCount,
  columns,
  facets,
  searchKeys,
  csv,
  statusTabs,
  meScope,
  selectionEnabled,
  selectedRows,
  seed,
}: DataTableExportSheetAdvancedProps<TRow>) {
  // ── available fields ────────────────────────────────────────────────────
  const columnFields = useMemo<AdvancedField<TRow>[]>(
    () =>
      columns.filter(isExportableColumn).map((c) => {
        const id = resolveColumnId(c);
        return {
          id,
          header: resolveColumnDefLabel(c),
          sourceKind: 'column' as const,
          accessor: (row: TRow, index: number) => {
            const v = resolveColumnValue(columns, id, row, index);
            if (v == null) return null;
            if (typeof v === 'boolean') return v ? 'Yes' : 'No';
            if (typeof v === 'object') return null;
            return v as string | number;
          },
        };
      }),
    [columns]
  );

  const extraFields = useMemo<AdvancedField<TRow>[]>(
    () =>
      (csv.extraColumns ?? []).map((e) => ({
        id: e.id,
        header: e.header,
        sourceKind: 'extra' as const,
        accessor: (row: TRow) => e.accessor(row),
      })),
    [csv.extraColumns]
  );

  const [rawBySource, setRawBySource] = useState<
    Record<string, RawSourceState>
  >({});

  const rawFields = useMemo<AdvancedField<TRow>[]>(() => {
    if (!csv.rawColumns) return [];
    const { keyOf, sources } = csv.rawColumns;
    return sources.flatMap((src) => {
      const state = rawBySource[src.id];
      if (state?.status !== 'loaded') return [];
      return state.colNames.map((col) => ({
        id: `raw:${src.id}:${col}`,
        header: humanizeFieldName(col),
        sourceKind: 'raw' as const,
        sourceLabel: src.label,
        accessor: (row: TRow): string | number | null => {
          const v = state.data[keyOf(row)]?.[col];
          if (v == null) return null;
          if (typeof v === 'boolean') return v ? 'Yes' : 'No';
          return v as string | number;
        },
      }));
    });
  }, [csv.rawColumns, rawBySource]);

  const allFields = useMemo(
    () => [...columnFields, ...extraFields, ...rawFields],
    [columnFields, extraFields, rawFields]
  );

  // ── controls ────────────────────────────────────────────────────────────
  const showScopeChoice = selectionEnabled && selectedRows.length > 0;
  const [scope, setScope] = useState<'selected' | 'filtered'>('filtered');
  const [search, setSearch] = useState(seed.search);
  const [debouncedSearch, setDebouncedSearch] = useState(seed.search);
  const [facetSel, setFacetSel] = useState<FacetSelection[]>(seed.facets);
  const [statusTab, setStatusTab] = useState<string | undefined>(
    seed.statusTab
  );
  const [mine, setMine] = useState<boolean>(Boolean(seed.mine && meScope));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortCol, setSortCol] = useState<string | undefined>(
    seed.initialSortId
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(
    seed.initialSortDesc ? 'desc' : 'asc'
  );
  const [limit, setLimit] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterRoot, setFilterRoot] = useState<FilterGroup>(() => ({
    kind: 'group',
    id: 'root',
    conjunction: 'and',
    children: [],
  }));
  const nextIdRef = useRef(0);
  const newId = () => `n${(nextIdRef.current += 1)}`;

  // Re-seed by VALUE on every open: the sheet must never alias the shell's
  // live state (edits here must not leak back into the table), but starting
  // from what the user is looking at is the whole point of the seed.
  useEffect(() => {
    if (!open) return;
    setScope(showScopeChoice ? 'selected' : 'filtered');
    setSearch(seed.search);
    setDebouncedSearch(seed.search);
    setFacetSel(seed.facets.map((f) => ({ id: f.id, values: [...f.values] })));
    setStatusTab(seed.statusTab);
    setMine(Boolean(seed.mine && meScope));
    setRawBySource({});
    setLimit(String(screenRowCount));
    setError(null);
    setSelectedIds(
      [
        ...columnFields.filter((f) => seed.visibleColumnIds.includes(f.id)),
        ...extraFields.filter(
          (f) =>
            (csv.extraColumns ?? []).find((e) => e.id === f.id)?.defaultChecked
        ),
      ].map((f) => f.id)
    );
    setSortCol(seed.initialSortId);
    setSortDir(seed.initialSortDesc ? 'desc' : 'asc');
    setFilterRoot({
      kind: 'group',
      id: 'root',
      conjunction: 'and',
      children: [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  // ── raw sources ─────────────────────────────────────────────────────────
  // Monotonic epoch, bumped whenever the row scope changes. A fetch captures
  // the epoch it started in; resolving against a newer one means the payload
  // is keyed to rows that are no longer in scope, so it lands as `stale`
  // instead of `loaded` and can never be exported.
  const scopeEpochRef = useRef(0);

  useEffect(() => {
    scopeEpochRef.current += 1;
    setRawBySource((prev) => {
      const loaded = Object.entries(prev).filter(
        ([, s]) => s.status === 'loaded'
      );
      if (loaded.length === 0) return prev;
      const next = { ...prev };
      for (const [id] of loaded) next[id] = { ...next[id], status: 'stale' };
      return next;
    });
  }, [scope, debouncedSearch, facetSel, statusTab, mine]);

  // A stale source's fields must leave the selection too, or the file would
  // carry columns resolved against the previous row set.
  useEffect(() => {
    const staleSourceIds = new Set(
      Object.entries(rawBySource)
        .filter(([, s]) => s.status === 'stale')
        .map(([id]) => id)
    );
    if (staleSourceIds.size === 0) return;
    setSelectedIds((prev) =>
      prev.filter((id) => {
        if (!id.startsWith('raw:')) return true;
        return !staleSourceIds.has(id.split(':')[1] ?? '');
      })
    );
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
      const payload = await source.fetch(keys);
      if (epoch !== scopeEpochRef.current) {
        setRawBySource((prev) => ({
          ...prev,
          [source.id]: { ...IDLE_RAW_STATE, status: 'stale' },
        }));
        return;
      }
      // Drop object-valued columns entirely (KD #162 — a JSON blob in a
      // spreadsheet cell helps nobody), checking EVERY row rather than the
      // first non-null one so the result cannot depend on row order.
      const colNames = Array.from(
        new Set(Object.values(payload).flatMap((r) => Object.keys(r)))
      ).filter(
        (col) =>
          !Object.values(payload).some(
            (r) => r[col] != null && typeof r[col] === 'object'
          )
      );
      setRawBySource((prev) => ({
        ...prev,
        [source.id]: { status: 'loaded', colNames, data: payload },
      }));
    } catch (e) {
      setRawBySource((prev) => ({
        ...prev,
        [source.id]: {
          ...IDLE_RAW_STATE,
          status: epoch === scopeEpochRef.current ? 'error' : 'stale',
          error:
            e instanceof Error ? e.message : 'Could not load these fields.',
        },
      }));
    }
  }

  // ── rows ────────────────────────────────────────────────────────────────
  // Reuses the shell's own `filterRows`, so a count here can never disagree
  // with the same filters applied on screen (KD #82/#84).
  const previewRows = useMemo(() => {
    if (scope === 'selected') return selectedRows;
    let rows = data;
    if (statusTabs && statusTab) {
      const tab = statusTabs.find((t) => t.value === statusTab);
      if (tab) rows = rows.filter(tab.predicate);
    }
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

  const byId = useMemo(
    () => new Map(allFields.map((f) => [f.id, f])),
    [allFields]
  );

  function applySort(rows: TRow[]): TRow[] {
    if (!sortCol) return rows;
    const field = byId.get(sortCol);
    if (!field) return rows;
    const withValue = rows.map((r, i) => ({ r, v: field.accessor(r, i) }));
    withValue.sort((a, b) => {
      if (a.v == null && b.v == null) return 0;
      if (a.v == null) return 1; // nulls last, whichever direction
      if (b.v == null) return -1;
      const cmp =
        typeof a.v === 'number' && typeof b.v === 'number'
          ? a.v - b.v
          : String(a.v).localeCompare(String(b.v));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return withValue.map((x) => x.r);
  }

  // Field type + value options, derived from EVERY row rather than a sample
  // (KD #162's rule, applied to typing as well as to the object probe) and
  // computed lazily per field — 118 raw fields × every row is not worth
  // paying for the ones nobody filters on.
  const fieldMetaFor = useMemo(() => {
    const cache = new Map<
      string,
      { type: FieldType; options: string[] | null }
    >();
    return (fieldId: string) => {
      const hit = cache.get(fieldId);
      if (hit) return hit;
      const field = byId.get(fieldId);
      const values = field ? data.map((r, i) => field.accessor(r, i)) : [];
      const meta = {
        type: inferFieldType(values),
        options: distinctValuesFor(values),
      };
      cache.set(fieldId, meta);
      return meta;
    };
  }, [byId, data]);

  const ruleFilteredRows = useMemo(
    () =>
      applyFilterRules(previewRows, filterRoot, (row, index) => ({
        valueOf: (fieldId) => byId.get(fieldId)?.accessor(row, index) ?? null,
        typeOf: (fieldId) => fieldMetaFor(fieldId).type,
      })),
    [previewRows, filterRoot, byId, fieldMetaFor]
  );

  const parsedLimit = (() => {
    const n = Number.parseInt(limit, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const finalCount = parsedLimit
    ? Math.min(parsedLimit, ruleFilteredRows.length)
    : ruleFilteredRows.length;
  const ruleCount = countRules(filterRoot);

  // ── field selection + drag ──────────────────────────────────────────────
  const selectedFields = useMemo(
    () =>
      selectedIds
        .map((id) => byId.get(id))
        .filter((f): f is AdvancedField<TRow> => Boolean(f)),
    [selectedIds, byId]
  );

  const availableFields = useMemo(
    () => allFields.filter((f) => !selectedIds.includes(f.id)),
    [allFields, selectedIds]
  );

  const dndSensors = useSensors(
    // A small activation distance keeps a drag from swallowing the row's own
    // remove click; the keyboard sensor keeps reordering usable without a mouse.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overDragId, setOverDragId] = useState<string | null>(null);

  // Where the dragged row would land, as an index into the list. Rendered as
  // an explicit line rather than relying on the gap the siblings open — the
  // gap alone reads as a rendering glitch on a first encounter, and this is
  // the only drag-and-drop surface in the app.
  const dropIndex = useMemo(() => {
    if (!activeDragId || !overDragId || activeDragId === overDragId)
      return null;
    const from = selectedIds.indexOf(activeDragId);
    const to = selectedIds.indexOf(overDragId);
    if (from === -1 || to === -1) return null;
    return from < to ? to + 1 : to;
  }, [activeDragId, overDragId, selectedIds]);

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    setOverDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSelectedIds((prev) => {
      const from = prev.indexOf(String(active.id));
      const to = prev.indexOf(String(over.id));
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  }

  function resetToScreen() {
    setSearch(seed.search);
    setDebouncedSearch(seed.search);
    setFacetSel(seed.facets.map((f) => ({ id: f.id, values: [...f.values] })));
    setStatusTab(seed.statusTab);
    setMine(Boolean(seed.mine && meScope));
    setLimit(String(screenRowCount));
    // Rules are not part of the screen's state, so "back to the screen"
    // means none of them — leaving them behind would make the button lie.
    setFilterRoot({
      kind: 'group',
      id: 'root',
      conjunction: 'and',
      children: [],
    });
    setSortCol(seed.initialSortId);
    setSortDir(seed.initialSortDesc ? 'desc' : 'asc');
    setSelectedIds(
      columnFields
        .filter((f) => seed.visibleColumnIds.includes(f.id))
        .map((f) => f.id)
    );
  }

  function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      const sorted = applySort(ruleFilteredRows);
      const rows = parsedLimit ? sorted.slice(0, parsedLimit) : sorted;
      const fields = selectedIds
        .map((id) => byId.get(id))
        .filter((f): f is AdvancedField<TRow> => Boolean(f));
      exportCsv(rows, fieldsToCsvColumns(rows, fields), csv.filename);
      onOpenChange(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not build the export. Try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  const activeField = activeDragId ? byId.get(activeDragId) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Wider than the simple sheet on purpose: a filter rule is four
          controls on one line, and at `max-w-lg` the field and value pickers
          truncate to the point of being unreadable. */}
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="gap-1 border-b border-hairline px-6 pb-4 pt-6">
          <SheetTitle className="font-serif text-xl font-semibold tracking-tight">
            Export CSV
          </SheetTitle>
          {/* Visible rather than sr-only: the header was a lone title with
              nothing under it. Naming the file is the useful context — it
              says which table and which year this came from. */}
          <SheetDescription className="text-[12.5px] text-ink-4">
            Choose the rows and fields, then download{' '}
            <span className="font-mono text-[11.5px] text-ink-3">
              {csv.filename}
            </span>
            .
          </SheetDescription>
        </SheetHeader>

        {/* `min-h-0` is load-bearing: without it this never scrolls, it just
            grows past the sheet and takes the footer with it. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {/* ── Scope ─────────────────────────────────────────────────── */}
          <section className="border-t border-hairline py-5 first:border-t-0 first:pt-5">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
                Scope
              </h3>
              <span className="text-[11px] text-ink-5">
                Starts from the screen
              </span>
            </div>

            <div className="grid gap-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-ink-4">
                    Sort by
                  </span>
                  <Select
                    value={sortCol ?? SORT_UNSET}
                    onValueChange={(v) =>
                      setSortCol(v === SORT_UNSET ? undefined : v)
                    }
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SORT_UNSET}>Table order</SelectItem>
                      {selectedFields.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-ink-4">
                    Order
                  </span>
                  <Select
                    value={sortDir}
                    onValueChange={(v) => setSortDir(v as 'asc' | 'desc')}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asc">A → Z / oldest</SelectItem>
                      <SelectItem value="desc">Z → A / newest</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 flex items-baseline justify-between gap-2 text-[11px] text-ink-4">
                    Limit
                    {/* The cap only ever removes rows — it cannot conjure
                        them. Without this, typing a number larger than the
                        matching count looks broken: the button keeps
                        reporting the smaller figure with no explanation. */}
                    <span className="text-ink-5">
                      {`of ${ruleFilteredRows.length.toLocaleString('en-SG')} matching`}
                    </span>
                  </span>
                  {/* Seeded to the number of rows on screen, so the default
                      export is the table you are looking at. Clearing it
                      means "no cap", which is why it is not `required`. */}
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    max={ruleFilteredRows.length || undefined}
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    placeholder="All"
                    className="h-9 font-mono text-xs"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-ink-4">
                    Search
                  </span>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter rows…"
                    className="h-9 text-xs"
                  />
                </label>
              </div>
            </div>
          </section>

          {/* ── Filter ────────────────────────────────────────────────── */}
          <section className="border-t border-hairline py-5 first:border-t-0 first:pt-5">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
                Filter
              </h3>
              {ruleCount > 0 && (
                <span className="text-[11px] text-ink-5">
                  {ruleCount} {ruleCount === 1 ? 'rule' : 'rules'}
                </span>
              )}
            </div>

            <FilterGroupEditor
              group={filterRoot}
              isRoot
              fields={allFields}
              metaFor={fieldMetaFor}
              onChangeNode={(id, patch) =>
                setFilterRoot((prev) => updateNode(prev, id, patch))
              }
              onRemoveNode={(id) =>
                setFilterRoot((prev) => removeNode(prev, id))
              }
              onAddRule={(groupId, fieldId) => {
                const type = fieldMetaFor(fieldId).type;
                setFilterRoot((prev) =>
                  addChild(prev, groupId, {
                    kind: 'rule',
                    id: newId(),
                    fieldId,
                    operator: operatorsFor(type)[0].id,
                    value: '',
                  })
                );
              }}
              onAddGroup={(groupId) =>
                setFilterRoot((prev) =>
                  addChild(prev, groupId, {
                    kind: 'group',
                    id: newId(),
                    conjunction: 'or',
                    children: [],
                  })
                )
              }
            />
          </section>

          {/* ── Fields ────────────────────────────────────────────────── */}
          <section className="border-t border-hairline py-5 first:border-t-0 first:pt-5">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
                Fields
              </h3>
              <span className="text-[11px] text-ink-5">
                Drag to set column order
              </span>
            </div>

            {selectedFields.length === 0 ? (
              <p className="rounded-md border border-dashed border-hairline-strong bg-muted px-3 py-6 text-center text-[12.5px] text-ink-5">
                No fields chosen. Add at least one to export.
              </p>
            ) : (
              <DndContext
                sensors={dndSensors}
                collisionDetection={closestCenter}
                onDragStart={(e: DragStartEvent) =>
                  setActiveDragId(String(e.active.id))
                }
                onDragOver={(e) =>
                  setOverDragId(e.over ? String(e.over.id) : null)
                }
                onDragCancel={() => {
                  setActiveDragId(null);
                  setOverDragId(null);
                }}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={selectedIds}
                  strategy={verticalListSortingStrategy}
                >
                  {/* Its own scroll box. A roster export routinely carries a
                      dozen fields, and without a ceiling the list pushes the
                      row count and the filter rules off the top of the sheet
                      — the two things you most need to see while editing it. */}
                  <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
                    {selectedFields.map((f, i) => (
                      <Fragment key={f.id}>
                        {dropIndex === i && <DropLine />}
                        <SortableFieldRow
                          id={f.id}
                          header={f.header}
                          sourceLabel={f.sourceLabel}
                          dimmed={activeDragId === f.id}
                          onRemove={() =>
                            setSelectedIds((prev) =>
                              prev.filter((x) => x !== f.id)
                            )
                          }
                        />
                      </Fragment>
                    ))}
                    {dropIndex === selectedFields.length && <DropLine />}
                  </div>
                </SortableContext>

                {/* The lifted copy that follows the pointer — without it
                    dnd-kit only shifts siblings and the dragged row gives no
                    feedback at all. */}
                <DragOverlay>
                  {activeField ? (
                    // Lifted AND tilted — the tilt is what makes it read as
                    // picked up rather than as a duplicate row.
                    <div
                      data-testid="export-field-drag-overlay"
                      className="flex h-9 rotate-1 items-center gap-2.5 rounded-md border border-brand-indigo-soft bg-background px-3 text-[12.5px] text-ink-2 shadow-lg"
                    >
                      <GripVertical className="size-3.5 text-ink-5" />
                      <span className="flex-1 truncate">
                        {activeField.header}
                      </span>
                      {activeField.sourceLabel && (
                        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-brand-indigo-soft">
                          {activeField.sourceLabel}
                        </span>
                      )}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <ActionPicker
                label="Add field"
                fields={availableFields}
                rawSources={csv.rawColumns?.sources ?? []}
                rawBySource={rawBySource}
                onPickField={(id) => setSelectedIds((prev) => [...prev, id])}
                onSelectAll={(ids) =>
                  setSelectedIds((prev) => [...prev, ...ids])
                }
                onLoadSource={handleLoadRaw}
              />
              <span className="font-mono text-[10px] text-ink-5">
                {selectedFields.length} of {allFields.length}
              </span>
            </div>
          </section>

          {error && (
            <p className="pt-1 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        {/* Both actions grouped right. Splitting them to opposite edges gave
            "Reset to screen" the same visual weight as the primary action,
            which it does not have. */}
        <SheetFooter className="flex-row items-center justify-end gap-2 border-t border-hairline bg-muted px-6 py-4">
          <Button variant="ghost" size="sm" onClick={resetToScreen}>
            Reset to screen
          </Button>
          <Button
            onClick={handleDownload}
            disabled={busy || selectedFields.length === 0}
            loading={busy}
            loadingText="Preparing…"
          >
            <Download className="mr-1 size-3.5" />
            {`Download ${finalCount.toLocaleString('en-SG')} ${finalCount === 1 ? 'row' : 'rows'}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ── filter rule builder ───────────────────────────────────────────────────

type FieldMeta = { type: FieldType; options: string[] | null };

type EditorProps<TRow> = {
  fields: AdvancedField<TRow>[];
  metaFor: (fieldId: string) => FieldMeta;
  onChangeNode: (id: string, patch: (n: FilterNode) => FilterNode) => void;
  onRemoveNode: (id: string) => void;
  onAddRule: (groupId: string, fieldId: string) => void;
  onAddGroup: (groupId: string) => void;
};

// Rules render as compact one-line chips, the way Directus does it — a rule
// is one short sentence ("Nationality  Is  Singapore"), not three stacked
// full-width dropdowns.
//
// The first build used a 4-column grid of Selects per rule and a shared
// "Add filter" link at every nesting level. With two groups open that
// produced three identical links and two "Remove group" buttons, with no
// visible nesting and no way to tell which group a link belonged to.
//
// A group is now its own chip — `AND — All of the following` — with its
// children indented beneath a rail, so nesting is visible rather than
// inferred, and each group carries exactly one "Add rule" of its own.

function FilterGroupEditor<TRow>({
  group,
  isRoot,
  ...rest
}: EditorProps<TRow> & { group: FilterGroup; isRoot?: boolean }) {
  const { fields, onAddRule, onAddGroup, onChangeNode, onRemoveNode } = rest;

  const body = (
    <div className="space-y-1.5">
      {group.children.map((child) =>
        child.kind === 'rule' ? (
          <FilterRuleEditor key={child.id} rule={child} {...rest} />
        ) : (
          <div key={child.id}>
            <div className="flex items-center gap-2 rounded-md border border-hairline bg-background px-2 py-1.5 text-[12.5px]">
              <button
                type="button"
                aria-label="Match all or any"
                onClick={() =>
                  onChangeNode(child.id, (n) =>
                    n.kind === 'group'
                      ? {
                          ...n,
                          conjunction: n.conjunction === 'and' ? 'or' : 'and',
                        }
                      : n
                  )
                }
                className="flex items-center gap-2 rounded text-left hover:opacity-80"
              >
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em]',
                    child.conjunction === 'and'
                      ? 'bg-primary/10 text-brand-indigo-deep'
                      : 'bg-brand-amber/15 text-brand-amber-deep'
                  )}
                >
                  {child.conjunction}
                </span>
                {/* One interpolation, not three text nodes — a line-broken
                    JSX string is split across nodes and stops matching. */}
                <span className="text-ink-4">
                  {`— ${child.conjunction === 'and' ? 'All' : 'Any'} of the following`}
                </span>
              </button>
              <button
                type="button"
                aria-label="Remove group"
                onClick={() => onRemoveNode(child.id)}
                className="ml-auto grid size-5 shrink-0 place-items-center rounded text-ink-5 hover:bg-accent hover:text-brand-indigo-deep"
              >
                <X className="size-3" />
              </button>
            </div>

            <div className="mt-1.5 ml-2 border-l-2 border-brand-indigo-soft/50 pl-3">
              <FilterGroupEditor group={child} {...rest} />
              <ActionPicker
                label="Add rule"
                fields={fields}
                rawSources={[]}
                rawBySource={{}}
                onPickField={(fieldId) => onAddRule(child.id, fieldId)}
                onLoadSource={() => {}}
              />
            </div>
          </div>
        )
      )}
    </div>
  );

  if (!isRoot) return body;

  return (
    <>
      {group.children.length === 0 ? (
        <p className="rounded-md border border-dashed border-hairline-strong bg-muted px-3 py-4 text-center text-[12px] text-ink-5">
          Exporting every row on screen. Add a rule to narrow it.
        </p>
      ) : (
        <div className="rounded-md border border-hairline bg-muted/60 p-2">
          {group.children.length > 1 && (
            <p className="px-0.5 pb-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-5">
              All of the following
            </p>
          )}
          {body}
        </div>
      )}
      <div className="pt-2">
        <ActionPicker
          label="Add filter"
          fields={fields}
          rawSources={[]}
          rawBySource={{}}
          includeGroupOption
          onPickField={(fieldId) => onAddRule(group.id, fieldId)}
          onAddGroup={() => onAddGroup(group.id)}
          onLoadSource={() => {}}
        />
      </div>
    </>
  );
}

function FilterRuleEditor<TRow>({
  rule,
  fields,
  metaFor,
  onChangeNode,
  onRemoveNode,
}: EditorProps<TRow> & { rule: FilterRule }) {
  const meta = metaFor(rule.fieldId);
  const operators = operatorsFor(meta.type);
  const activeOp = operators.find((o) => o.id === rule.operator);
  const fieldLabel =
    fields.find((f) => f.id === rule.fieldId)?.header ?? rule.fieldId;
  const usePicker = Boolean(
    meta.options &&
    (rule.operator === 'equals' || rule.operator === 'notEquals')
  );

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-hairline bg-background px-2 py-1.5 text-[12.5px]">
      <FieldPicker
        fields={fields}
        label={fieldLabel}
        onPick={(fieldId) =>
          onChangeNode(rule.id, (n) => {
            if (n.kind !== 'rule') return n;
            // A new field can be a new type, which can invalidate the
            // operator — fall back rather than leave a rule that silently
            // never matches.
            const nextOps = operatorsFor(metaFor(fieldId).type);
            const keep = nextOps.some((o) => o.id === n.operator);
            return {
              ...n,
              fieldId,
              operator: keep ? n.operator : nextOps[0].id,
              value: keep ? n.value : '',
            };
          })
        }
      />

      <Select
        value={rule.operator}
        onValueChange={(operator) =>
          onChangeNode(rule.id, (n) =>
            n.kind === 'rule' ? { ...n, operator: operator as OperatorId } : n
          )
        }
      >
        <SelectTrigger
          aria-label="Condition"
          className="h-6 w-auto gap-1 border-0 bg-transparent px-1 py-0 text-[12.5px] font-semibold text-brand-indigo-deep shadow-none focus:ring-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {activeOp?.needsValue ? (
        usePicker ? (
          <Select
            value={rule.value}
            onValueChange={(value) =>
              onChangeNode(rule.id, (n) =>
                n.kind === 'rule' ? { ...n, value } : n
              )
            }
          >
            <SelectTrigger
              aria-label="Value"
              className="h-6 min-w-0 flex-1 gap-1 border-0 bg-transparent px-1 py-0 text-[12.5px] shadow-none focus:ring-0"
            >
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {(meta.options ?? []).map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <input
            value={rule.value}
            onChange={(e) =>
              onChangeNode(rule.id, (n) =>
                n.kind === 'rule' ? { ...n, value: e.target.value } : n
              )
            }
            aria-label="Value"
            placeholder={meta.type === 'date' ? 'YYYY-MM-DD' : 'Value'}
            className="min-w-0 flex-1 bg-transparent px-1 text-[12.5px] text-foreground outline-none placeholder:text-ink-5"
          />
        )
      ) : (
        <span className="flex-1" />
      )}

      <button
        type="button"
        onClick={() => onRemoveNode(rule.id)}
        aria-label={`Remove rule on ${fieldLabel}`}
        className="grid size-5 shrink-0 place-items-center rounded text-ink-5 hover:bg-accent hover:text-brand-indigo-deep"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/**
 * The field list, grouped by where each field comes from.
 *
 * `On screen` are the table's own columns; the rest are raw database fields,
 * grouped under their source label. Grouping does the work the old source
 * badge did, but at the point of choosing rather than after.
 */
function groupFields<TRow>(fields: AdvancedField<TRow>[]) {
  const onScreen = fields.filter((f) => f.sourceKind !== 'raw');
  const raw = new Map<string, AdvancedField<TRow>[]>();
  for (const f of fields) {
    if (f.sourceKind !== 'raw' || !f.sourceLabel) continue;
    raw.set(f.sourceLabel, [...(raw.get(f.sourceLabel) ?? []), f]);
  }
  return { onScreen, raw };
}

/**
 * A one-shot Select: it has no value of its own, it just runs an action and
 * resets. Radix keeps a controlled Select showing the last pick, so the
 * trigger would start reading "Nationality" instead of "Add filter" — the
 * remount key is what keeps it an action rather than a field.
 */
// cmdk leaves a group heading at body size in `text-foreground`, so "On
// screen" and "Applications" read as options rather than as labels. This is
// SelectLabel's treatment (components/ui/select.tsx), applied through cmdk's
// heading hook so the two pickers look like one system.
const GROUP_HEADING = [
  '[&_[cmdk-group-heading]]:font-mono',
  '[&_[cmdk-group-heading]]:text-[10px]',
  '[&_[cmdk-group-heading]]:font-semibold',
  '[&_[cmdk-group-heading]]:uppercase',
  '[&_[cmdk-group-heading]]:tracking-[0.14em]',
  '[&_[cmdk-group-heading]]:text-ink-4',
  '[&_[cmdk-group-heading]]:pt-2',
].join(' ');

/**
 * A one-shot picker: it has no value of its own, it runs an action and
 * closes. Built on `Command` rather than `Select` because it needs BOTH a
 * search box and group headings — a hundred-odd raw database fields is far
 * past what anyone will scroll, and Radix's Select has no search.
 *
 * `portal={false}` matters: portalled popover content sits outside the
 * Sheet's subtree, where its scroll lock swallows wheel events, so the list
 * shows a scrollbar it refuses to move.
 */
function ActionPicker<TRow>({
  label,
  fields,
  rawSources,
  rawBySource,
  includeGroupOption,
  onPickField,
  onAddGroup,
  onSelectAll,
  onLoadSource,
}: {
  label: string;
  fields: AdvancedField<TRow>[];
  rawSources: CsvRawColumnSource[];
  rawBySource: Record<string, RawSourceState>;
  includeGroupOption?: boolean;
  onPickField: (fieldId: string) => void;
  onAddGroup?: () => void;
  /** Supplied only where taking everything makes sense — adding every field
   *  to the export does; turning every field into a filter rule does not. */
  onSelectAll?: (fieldIds: string[]) => void;
  onLoadSource: (source: CsvRawColumnSource) => void;
}) {
  const [open, setOpen] = useState(false);
  const { onScreen, raw } = groupFields(fields);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 w-fit items-center gap-1 whitespace-nowrap rounded text-[12.5px] font-medium text-primary hover:underline hover:underline-offset-4"
        >
          <Plus className="size-3.5 shrink-0" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        portal={false}
        collisionPadding={12}
        className="w-72 p-0"
      >
        <Command>
          <CommandInput placeholder="Search fields…" className="h-9" />
          <CommandList className="max-h-64">
            <CommandEmpty>No field matches.</CommandEmpty>

            {includeGroupOption && (
              <CommandGroup heading="Group" className={GROUP_HEADING}>
                <CommandItem
                  value="and or group"
                  onSelect={() => {
                    onAddGroup?.();
                    setOpen(false);
                  }}
                >
                  And / Or group
                </CommandItem>
              </CommandGroup>
            )}

            {onSelectAll && fields.length > 0 && (
              <CommandGroup>
                {/* Names the count, because "all" means the fields listed
                    here — a raw source you have not loaded is not among
                    them. */}
                <CommandItem
                  value="add all fields"
                  onSelect={() => {
                    onSelectAll(fields.map((f) => f.id));
                    setOpen(false);
                  }}
                >
                  <Plus className="mr-1.5 size-3.5" />
                  {`Add all ${fields.length} ${fields.length === 1 ? 'field' : 'fields'}`}
                </CommandItem>
              </CommandGroup>
            )}

            {onScreen.length > 0 && (
              <CommandGroup heading="On screen" className={GROUP_HEADING}>
                {onScreen.map((f) => (
                  <CommandItem
                    key={f.id}
                    value={f.header}
                    onSelect={() => {
                      onPickField(f.id);
                      setOpen(false);
                    }}
                  >
                    {f.header}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {rawSources.map((src) => {
              const state = rawBySource[src.id];
              const loaded = raw.get(src.label) ?? [];
              if (state?.status === 'loaded') {
                if (loaded.length === 0) return null;
                return (
                  <CommandGroup
                    key={src.id}
                    heading={src.label}
                    className={GROUP_HEADING}
                  >
                    {loaded.map((f) => (
                      <CommandItem
                        key={f.id}
                        value={`${f.header} ${src.label}`}
                        onSelect={() => {
                          onPickField(f.id);
                          setOpen(false);
                        }}
                      >
                        {f.header}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              }
              return (
                <CommandGroup
                  key={src.id}
                  heading={src.label}
                  className={GROUP_HEADING}
                >
                  <CommandItem
                    value={`load ${src.label}`}
                    disabled={state?.status === 'loading'}
                    onSelect={() => onLoadSource(src)}
                  >
                    {state?.status === 'loading' ? (
                      <>
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        {`Loading ${src.label} fields…`}
                      </>
                    ) : state?.status === 'error' ? (
                      <span className="text-destructive">
                        {`Couldn't load ${src.label} fields — try again`}
                      </span>
                    ) : (
                      <>
                        <Plus className="mr-1.5 size-3.5" />
                        {`Load all ${src.label} fields`}
                      </>
                    )}
                  </CommandItem>
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The field name inside a rule chip — searchable, and grouped by source. */
function FieldPicker<TRow>({
  fields,
  label,
  onPick,
}: {
  fields: AdvancedField<TRow>[];
  label: string;
  onPick: (fieldId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { onScreen, raw } = groupFields(fields);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Field"
          className="max-w-40 shrink-0 truncate rounded px-1 py-0.5 text-left font-medium text-foreground hover:bg-accent"
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        portal={false}
        collisionPadding={12}
        className="w-64 p-0"
      >
        <Command>
          <CommandInput placeholder="Search fields…" className="h-9" />
          <CommandList className="max-h-64">
            <CommandEmpty>No field matches.</CommandEmpty>
            {onScreen.length > 0 && (
              <CommandGroup heading="On screen" className={GROUP_HEADING}>
                {onScreen.map((f) => (
                  <CommandItem
                    key={f.id}
                    value={f.header}
                    onSelect={() => {
                      onPick(f.id);
                      setOpen(false);
                    }}
                  >
                    {f.header}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {[...raw.entries()].map(([sourceLabel, list]) => (
              <CommandGroup
                key={sourceLabel}
                heading={sourceLabel}
                className={GROUP_HEADING}
              >
                {list.map((f) => (
                  <CommandItem
                    key={f.id}
                    value={`${f.header} ${sourceLabel}`}
                    onSelect={() => {
                      onPick(f.id);
                      setOpen(false);
                    }}
                  >
                    {f.header}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The landing marker — a rule with a leading dot, so the target reads even
 *  where the opened gap is ambiguous (top and bottom of the list). */
function DropLine() {
  return (
    <div
      data-testid="export-field-drop-line"
      aria-hidden
      className="relative h-0.5 rounded-full bg-primary"
    >
      <span className="absolute -left-0.75 -top-0.75 size-1.75 rounded-full bg-primary" />
    </div>
  );
}

// ── one draggable field row ───────────────────────────────────────────────
function SortableFieldRow({
  id,
  header,
  sourceLabel,
  dimmed,
  onRemove,
}: {
  id: string;
  header: string;
  sourceLabel?: string;
  dimmed: boolean;
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

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex h-9 items-center gap-2.5 rounded-md border border-hairline bg-background px-3 text-[12.5px] text-ink-2',
        // The row left behind dims in place, so the gap reads as "this is
        // where it came from" rather than as a rendering glitch.
        (dimmed || isDragging) && 'opacity-35'
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-ink-5 hover:text-ink-3 active:cursor-grabbing"
        aria-label={`Reorder ${header}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      <span className="flex-1 truncate">{header}</span>
      {sourceLabel && (
        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-brand-indigo-soft">
          {sourceLabel}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${header}`}
        className="text-ink-5 hover:text-brand-indigo-deep"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
