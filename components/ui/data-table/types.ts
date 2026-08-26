import type {
  ColumnDef,
  RowData,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BulkAction } from './bulk-action-footer';

export type FacetConfig = {
  columnId: string;
  label: string;
  valueOptions?: string[];
};

/**
 * A group of facets collapsed behind ONE toolbar trigger (a Popover
 * stacking each facet's own dropdown). Use when a table needs many facets
 * that would otherwise wrap the shared toolbar — e.g. the admissions
 * applications table's 9 per-stage status filters. Grouped facets still
 * write to the same `columnFilters` state as top-level `facets`, so they
 * chip, clear, and persist via `url` identically.
 */
export type FacetGroupConfig = {
  label: string;
  facets: FacetConfig[];
};

export type StatusTabConfig<TRow> = {
  value: string;
  label: string;
  predicate: (row: TRow) => boolean;
  isDefault?: boolean;
  countOverride?: (rows: TRow[]) => number;
};

export type MeScopeConfig<TRow> = {
  /**
   * Explicit on/off gate for the Toggle. When set, takes precedence over
   * userId-truthiness. Use `enabled: true` when the predicate has nothing
   * to do with the viewer (e.g. a "waiting to be applied" filter) — pass
   * `userId: null` and let `enabled` carry the gate semantic.
   *
   * Default behavior (when omitted): falls back to Boolean(userId), which
   * matches the original "show only mine" use case.
   */
  enabled?: boolean;
  userId: string | null;
  label: string;
  icon?: LucideIcon;
  predicate: (row: TRow, userId: string | null) => boolean;
};

export type CsvExtraColumn<TRow> = {
  id: string;
  header: string;
  accessor: (row: TRow) => string | number | null;
  /** Default false, which means NEVER exported — there is no export picker
   *  left to opt a field in per-export. Set true to have this field always
   *  appended to the "what's on screen" export; only omit it for a field
   *  that genuinely isn't reachable yet (kept for a future consumer). */
  defaultChecked?: boolean;
};

export type CsvRawColumnSource = {
  /** Stable id, namespaced into every column this source discovers
   *  (`raw:{id}:{column}`) — also shown as the "(label)" suffix on each
   *  discovered column's header. */
  id: string;
  /** Human label for the source's group heading + per-column suffix, e.g.
   *  "Applications" → "Preferred Payment Scheme (Applications)". */
  label: string;
  /**
   * On-demand fetch, called with the keys of whatever rows are currently in
   * export scope (never the full unfiltered dataset). Must return a map
   * ALREADY KEYED by the same value `CsvRawColumnsConfig.keyOf` produces for
   * a row — the export sheet does a plain lookup, no re-keying.
   */
  fetch: (keys: string[]) => Promise<Record<string, Record<string, unknown>>>;
};

/**
 * A named "export everything from these sources" choice, offered alongside
 * the built-in "what's on screen" option. Declared per table because only
 * the table knows which of its raw sources belong together — e.g. the
 * applications record alone vs. the record plus its pipeline status.
 */
export type CsvExportPreset = {
  id: string;
  label: string;
  /**
   * Plain-English sentence explaining what this preset adds, shown under
   * its label in the export sheet. Give each preset its own — a shared
   * sentence can't say what's actually different between presets (e.g. that
   * a second preset adds pipeline/status fields the first doesn't have).
   * Optional only for back-compat; every real consumer should supply one.
   */
  description?: string;
  /** Ids of `CsvRawColumnsConfig.sources` this preset loads, in order. */
  sourceIds: string[];
};

export type CsvRawColumnsConfig<TRow> = {
  keyOf: (row: TRow) => string;
  sources: CsvRawColumnSource[];
  exportPresets?: CsvExportPreset[];
};

export type CsvConfig<TRow> = {
  filename: string;
  /**
   * Fields already fetched by the page's loader (often from a related
   * table, e.g. more `enrolment_status` columns alongside
   * `enrolment_applications`) that aren't rendered as an on-screen column.
   * Only entries with `defaultChecked: true` are ever exported — they are
   * appended automatically to the "what's on screen" export. An entry
   * without `defaultChecked` is never exported (there is no picker left
   * that would let a user opt it in per-export) — don't add one unless it
   * belongs in every export. See `export-payload.ts::buildScreenFields`.
   */
  extraColumns?: Array<CsvExtraColumn<TRow>>;
  /**
   * Opt-in "load every database column" capability — only meaningful for
   * tables that mirror real DB rows (e.g. admissions applications/status).
   * Derived/joined tables (audit-log-derived, multi-table joins with
   * computed aggregates) simply omit this; there is no DB column to
   * enumerate for them. See `CsvRawColumnsConfig`.
   */
  rawColumns?: CsvRawColumnsConfig<TRow>;
  /**
   * Opt in to the advanced export sheet — pick and reorder individual
   * fields, build filter rules, set a limit and a sort.
   *
   * OMITTING THIS IS THE DEFAULT AND MUST STAY A NO-OP. KD #162 measured
   * that 14 of 16 exporting tables have nothing beyond their on-screen
   * columns, so they download instantly with no dialog at all; a third of
   * a second beats a sheet asking five questions with one possible answer.
   * That finding still holds — this flag exists for the exception KD #162
   * itself named ("does a defined 'full' set exist beyond the screen"),
   * which today is only `StudentDataTable`.
   *
   * Turning it on for a table with no `rawColumns` is legal but thin: the
   * field picker can then only offer the columns already on screen, which
   * the Columns menu already does. Prefer instant download there.
   */
  advanced?: boolean;
};

export type UrlStateConfig = {
  enabled: boolean;
  namespace?: string;
  paramKeys?: { search?: string; status?: string; mine?: string };
};

export type EmptyStateConfig = {
  icon?: LucideIcon;
  title: string;
  body?: string;
  cta?: { label: string; href?: string; onClick?: () => void };
};

export type SelectionConfig<TRow> = {
  enabled: boolean;
  bulkActions?: Array<BulkAction<TRow>>;
  /** Optional per-row gate. When provided, only rows for which this returns
   *  true are selectable (TanStack `enableRowSelection` predicate). Use to
   *  exclude rows a bulk action can't apply to (e.g. already-locked sheets). */
  enableRowSelection?: (row: TRow) => boolean;
};

export type ExpandableConfig<TRow> = {
  enabled: boolean;
  /** Rows sharing the same key are grouped under one collapsible parent
   *  row. Grouping is applied to the CURRENT PAGE's rows only (after
   *  filter/sort/pagination) — a group can't span two pages. Acceptable
   *  for the small internal-triage-queue volumes this targets; revisit
   *  with group-aware pagination if a future consumer needs it. */
  groupBy: (row: TRow) => string;
  /** Renders the parent row's content — spans the full column width (a
   *  single `colSpan={columns.length}` cell). Receives the group's member
   *  rows in their already-filtered/sorted order, current expand state,
   *  and a toggle callback. All groups start expanded by default. */
  renderGroupHeader: (group: {
    key: string;
    rows: TRow[];
    isExpanded: boolean;
    toggle: () => void;
  }) => import('react').ReactNode;
};

export type DataTableProps<TRow> = {
  data: TRow[];
  columns: ColumnDef<TRow>[];
  getRowId: (row: TRow) => string;

  searchKeys?: Array<keyof TRow | ((row: TRow) => string)>;
  searchPlaceholder?: string;
  /** Seed value for the search input when no URL `?q=` param is present.
   *  Used for server-driven deep-links (e.g. open pre-filtered to a section). */
  initialSearch?: string;

  facets?: FacetConfig[];
  /** Optional — one or more facet groups, each collapsed behind a single
   *  toolbar trigger. See `FacetGroupConfig`. Omit for no change in
   *  behavior (defaults to `[]`, renders nothing extra). */
  facetGroups?: FacetGroupConfig[];
  statusTabs?: Array<StatusTabConfig<TRow>>;
  meScope?: MeScopeConfig<TRow>;

  toolbarLeading?: ReactNode;
  /**
   * Extra FILTER controls, rendered at the end of the left-hand cluster with
   * the search box and the facets.
   *
   * Distinct from `toolbarTrailing`, which lands in the right-hand group
   * alongside Export CSV and Columns. Those are actions; a control that
   * changes which rows are shown belongs with the other things that do, or the
   * reader has to learn that one filter lives somewhere else.
   */
  toolbarFilters?: ReactNode;
  toolbarTrailing?: ReactNode;

  initialSort?: SortingState;
  initialColumnVisibility?: VisibilityState;
  stickyHeader?: boolean;

  pageSize?: number;
  pageSizeOptions?: number[];
  hidePagination?: boolean;

  selection?: SelectionConfig<TRow>;
  /** Changing this value (e.g. an incrementing counter) clears the current
   *  row selection. Use after a bulk action completes to drop the footer. */
  selectionResetSignal?: number;
  expandable?: ExpandableConfig<TRow>;
  csv?: CsvConfig<TRow>;
  url?: UrlStateConfig;

  emptyState?: EmptyStateConfig;
  emptyFilteredState?: { title: string; body?: string };
};

// Typed extension of TanStack's per-column `meta` bag. Previously both keys
// below were read through inline casts; declaring them here means a typo is a
// compile error instead of a silent undefined.
//
// NOTE this augmentation is GLOBAL once this module is in the program — any
// future `meta: { somethingElse }` anywhere in the app becomes a type error
// until the key is added here. That is deliberate.
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /**
     * Plain-English column name for the "Columns" visibility menu and the
     * CSV header row when this column is exported. REQUIRED whenever
     * `header` is a render function (e.g. `<SortableHeader>`), because the
     * label text is then not statically reachable from the column
     * definition. Normally identical to the visible header; expand it where
     * the header is a glyph (`#`, `%`) or an abbreviation. See
     * ./column-label.ts.
     */
    label?: string;
    /**
     * Excludes an on-screen column from every CSV export — for columns
     * whose raw accessor value isn't presentable (composite cells, raw
     * enums, unformatted dates). Pair with a `csv.extraColumns` entry
     * (`defaultChecked: true`) supplying the humanized equivalent if the
     * field should still be exportable.
     */
    excludeFromExport?: boolean;
  }
}
