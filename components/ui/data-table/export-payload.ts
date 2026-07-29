import type { ColumnDef } from '@tanstack/react-table';

import { resolveColumnDefLabel } from './column-label';
import { resolveColumnValue } from './filter-rows';
import type { CsvExtraColumn } from './types';

// Non-data columns every DataTable consumer uses the same ids for — never
// exported. `action` (singular) is section-roster-table's; `open` is the
// audit logs' row-action link menu.
const NON_DATA_COLUMN_IDS = new Set(['select', 'actions', 'action', 'open']);

/** One exportable field — an on-screen column, a declared extra, or a raw
 *  DB column. Every export surface builds its CSV from this shape. */
export type ExportField<TRow> = {
  id: string;
  header: string;
  accessor: (row: TRow, index: number) => string | number | null;
};

export function resolveColumnId<TRow>(col: ColumnDef<TRow>): string {
  return col.id ?? (col as { accessorKey?: string }).accessorKey ?? '';
}

export function isExportableColumn<TRow>(col: ColumnDef<TRow>): boolean {
  const id = resolveColumnId(col);
  if (NON_DATA_COLUMN_IDS.has(id)) return false;
  return !col.meta?.excludeFromExport;
}

function toCell(v: unknown): string | number | null {
  if (v == null) return null;
  // Match the on-screen Yes/No convention (field-grid.tsx) rather than
  // exporting the literal strings "true"/"false".
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return v as string | number;
}

/**
 * The default export column set: the export-eligible columns the user can
 * currently SEE, in the order they see them, plus any extras the table
 * flagged `defaultChecked`. Object-valued columns (those whose raw values are
 * objects) are dropped entirely — they cannot be meaningfully exported. Columns
 * with all-null values are kept (an empty column is legitimate).
 */
export function buildScreenFields<TRow>(
  columns: ColumnDef<TRow>[],
  visibleColumnIds: string[],
  extraColumns: Array<CsvExtraColumn<TRow>> | undefined,
  rows: TRow[]
): ExportField<TRow>[] {
  const byId = new Map<string, ColumnDef<TRow>>();
  for (const c of columns) byId.set(resolveColumnId(c), c);

  // Identify object-valued columns by probing the first non-null value.
  const isObjectColumn = new Set<string>();
  for (const columnId of visibleColumnIds) {
    const col = byId.get(columnId);
    if (!col) continue;
    for (const row of rows) {
      const rawValue = resolveColumnValue(columns, columnId, row, 0);
      if (rawValue != null) {
        if (typeof rawValue === 'object') {
          isObjectColumn.add(columnId);
        }
        break; // Stop at first non-null value for this column.
      }
    }
  }

  const columnFields = visibleColumnIds
    .map((id) => byId.get(id))
    .filter((c): c is ColumnDef<TRow> => Boolean(c) && isExportableColumn(c!))
    .filter((c) => !isObjectColumn.has(resolveColumnId(c)))
    .map((c) => {
      const id = resolveColumnId(c);
      return {
        id,
        header: resolveColumnDefLabel(c),
        accessor: (row: TRow, index: number) =>
          toCell(resolveColumnValue(columns, id, row, index)),
      };
    });

  const extraFields = (extraColumns ?? [])
    .filter((e) => e.defaultChecked)
    .map((e) => ({
      id: e.id,
      header: e.header,
      accessor: (row: TRow) => e.accessor(row),
    }));

  return [...columnFields, ...extraFields];
}

/**
 * Bind fields to a concrete row list for `exportCsv`. Pre-computing the
 * row->index map keeps index-dependent accessors O(1) per row instead of
 * an O(n^2) indexOf scan.
 */
export function fieldsToCsvColumns<TRow>(
  rows: TRow[],
  fields: ExportField<TRow>[]
): Array<{ header: string; accessor: (row: TRow) => string | number | null }> {
  const rowIndex = new Map<TRow, number>(rows.map((r, i) => [r, i]));
  return fields.map((f) => ({
    header: f.header,
    accessor: (row: TRow) => f.accessor(row, rowIndex.get(row) ?? 0),
  }));
}
