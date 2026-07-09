import type {
  ColumnDef,
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
  /** Default false — export-only fields are opt-in per export so they don't
   *  bloat the file by default. Set true for a field most exports want. */
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

export type CsvRawColumnsConfig<TRow> = {
  keyOf: (row: TRow) => string;
  sources: CsvRawColumnSource[];
};

export type CsvConfig<TRow> = {
  filename: string;
  /**
   * Fields already fetched by the page's loader (often from a related
   * table, e.g. more `enrolment_status` columns alongside
   * `enrolment_applications`) that aren't rendered as an on-screen column.
   * These appear ONLY in the export sheet's column picker, never on the
   * live table — lets a page offer richer exports without cluttering the
   * screen. See the export sheet (`export-sheet.tsx`).
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
  csv?: CsvConfig<TRow>;
  url?: UrlStateConfig;

  emptyState?: EmptyStateConfig;
  emptyFilteredState?: { title: string; body?: string };
};
