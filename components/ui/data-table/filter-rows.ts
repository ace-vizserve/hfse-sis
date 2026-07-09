import type { ColumnDef } from '@tanstack/react-table';
import type { FacetConfig } from './types';

// Shared row-filtering primitives. Single source of truth for two call
// sites that must never disagree: the shell's per-tab counts (`index.tsx`'s
// `tabCountData`) and the export sheet's independent filter builder +
// live row-count preview. Extracted from what used to be inline logic in
// `tabCountData` — see KD #82/#84: a count/filter that reads a raw
// `row[id]` silently breaks for `accessorFn`-backed columns (computed
// columns like `name` or `staleness`), so both a count and the rows it
// claims to describe must share one implementation.

/**
 * Resolve a column definition's accessor once for a given `columnId` — the
 * shared lookup behind `resolveColumnValue`, hoisted so hot paths that
 * resolve the same column across many rows (the `filterRows` facet loop,
 * `getFacetOptions`) do a single `columns.find(...)` instead of one per row.
 */
function getColumnAccessor<TRow>(
  columns: ColumnDef<TRow>[],
  columnId: string
): (row: TRow, index: number) => unknown {
  const col = columns.find(
    (c) =>
      c.id === columnId ||
      ('accessorKey' in c &&
        (c as { accessorKey?: string }).accessorKey === columnId)
  ) as
    | {
        accessorFn?: (row: TRow, index: number) => unknown;
        accessorKey?: string;
      }
    | undefined;
  if (col && typeof col.accessorFn === 'function') {
    const accessorFn = col.accessorFn;
    return (row, index) => accessorFn(row, index);
  }
  const key = col?.accessorKey ?? columnId;
  return (row) => (row as unknown as Record<string, unknown>)[key];
}

/**
 * Resolve a column's value for a given row via its `accessorFn` OR
 * `accessorKey` — never a raw `row[id]` lookup, which is `undefined` for
 * accessorFn-backed columns (or columns whose `id` differs from their
 * `accessorKey`). Convenience one-shot wrapper around
 * `getColumnAccessor` — prefer resolving the accessor once and reusing it
 * when calling across many rows for the same column (see `filterRows` /
 * `getFacetOptions` below).
 */
export function resolveColumnValue<TRow>(
  columns: ColumnDef<TRow>[],
  columnId: string,
  row: TRow,
  index: number
): unknown {
  return getColumnAccessor(columns, columnId)(row, index);
}

export type FacetSelection = { id: string; values: string[] };

/**
 * Apply facet (column filter) + global search to a row array. Facets use
 * the same "(unassigned)" sentinel as the shell for null/empty values so a
 * facet's "(unassigned)" option matches rows the same way in both places.
 */
export function filterRows<TRow>(
  rows: TRow[],
  opts: {
    columns: ColumnDef<TRow>[];
    facets?: FacetSelection[];
    search?: string;
    searchKeys?: Array<keyof TRow | ((row: TRow) => string)>;
  }
): TRow[] {
  const { columns, facets = [], search, searchKeys } = opts;
  let out = rows;

  for (const f of facets) {
    if (!f.values || f.values.length === 0) continue;
    const valueSet = new Set(f.values.map((v) => String(v)));
    const accessor = getColumnAccessor(columns, f.id);
    out = out.filter((r, i) => {
      const raw = accessor(r, i);
      const cell = raw == null || raw === '' ? '(unassigned)' : String(raw);
      return valueSet.has(cell);
    });
  }

  if (search && searchKeys && searchKeys.length > 0) {
    const lower = search.toLowerCase();
    out = out.filter((r) => {
      const hay = searchKeys
        .map((k) =>
          typeof k === 'function'
            ? k(r)
            : String(
                (r as unknown as Record<string, unknown>)[k as string] ?? ''
              )
        )
        .join(' ')
        .toLowerCase();
      return hay.includes(lower);
    });
  }

  return out;
}

/**
 * Derive the distinct-value option list for a facet over a plain row array
 * — the equivalent of what the on-screen table gets "for free" from
 * TanStack's `col.getFacetedUniqueValues()`, but usable outside a live
 * `useReactTable` instance (the export sheet operates on the raw `data`
 * array, not a table row model). Prefers an explicit `valueOptions` list
 * when the facet config provides one (matches the on-screen FacetDropdown's
 * own precedence).
 */
export function getFacetOptions<TRow>(
  data: TRow[],
  columns: ColumnDef<TRow>[],
  facet: FacetConfig
): Array<{ value: string; label: string }> {
  if (facet.valueOptions) {
    return facet.valueOptions.map((v) => ({ value: v, label: v }));
  }
  const accessor = getColumnAccessor(columns, facet.columnId);
  const values = new Set<string>();
  data.forEach((row, i) => {
    const raw = accessor(row, i);
    if (typeof raw === 'string' && raw.trim() !== '') values.add(raw);
  });
  return Array.from(values)
    .sort()
    .map((v) => ({ value: v, label: v }));
}
