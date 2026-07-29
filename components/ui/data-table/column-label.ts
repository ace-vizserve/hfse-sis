import type { Column, ColumnDef } from '@tanstack/react-table';

import { humanizeFieldName } from './humanize-field';

// The single source of truth for a column's DISPLAY NAME — the text shown in
// the "Columns" visibility menu and the header row of a downloaded CSV
// export.
//
// Why this exists: a column's `header` is presentation, not a name. Almost
// every table in this app writes
//
//   header: ({ column }) => <SortableHeader column={column}>Section</SortableHeader>
//
// which is a FUNCTION, so the old rule (`typeof header === 'string' ? header
// : column.id`) fell through to the raw id and surfaced developer
// identifiers — `levelLabel`, `fcaName`, even
// `writeups_9c44414f-8f4d-4c62-99a0-442fa90a8a38` — in a menu school admins
// read. The label text lives inside the SortableHeader's children and is not
// statically reachable from the column definition, so columns whose header is
// a render function must declare `meta: { label }`.
//
// Deriving the label by invoking the header function and reading
// `element.props.children` was considered and rejected: table-core builds
// header instances from getVisibleLeafColumns(), so a HIDDEN column — exactly
// the one whose label a user needs in order to un-hide it — has no header
// context to pass, and some consumers' headers read `({ table })` and would
// throw on a fabricated one.
//
// Fallback order: meta.label → a plain non-empty string header →
// humanizeFieldName(id). The last is a safety net, not the plan; the coverage
// test in __tests__/ui/ fails the build if a render-function header ships
// without a label.
function labelFrom(id: string, header: unknown, meta: unknown): string {
  const explicit = (meta as { label?: string } | undefined)?.label;
  if (explicit) return explicit;
  // `.trim()` matters: several action columns use `header: ''`, which is a
  // string and would otherwise render a blank, unlabelled checkbox row.
  if (typeof header === 'string' && header.trim() !== '') return header;
  return humanizeFieldName(id);
}

/**
 * Display name for a live column instance — used by the shell's "Columns"
 * visibility menu. TanStack has already resolved `accessorKey` into `id` by
 * this point, so no accessorKey branch is needed here.
 */
export function resolveColumnLabel<TRow>(
  column: Column<TRow, unknown>
): string {
  return labelFrom(column.id, column.columnDef.header, column.columnDef.meta);
}

/**
 * Display name for a static column definition — used by the export sheet,
 * which builds its field list from `columns` without ever constructing a
 * table. Kept as a separate export rather than one loosely-typed function:
 * `Column` and `ColumnDef` overlap structurally, so a single permissive
 * signature would silently accept the wrong shape and return a humanized
 * empty string.
 */
export function resolveColumnDefLabel<TRow>(col: ColumnDef<TRow>): string {
  const id = col.id ?? (col as { accessorKey?: string }).accessorKey ?? '';
  return labelFrom(id, col.header, col.meta);
}
