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
  showUnassigned?: boolean;
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

export type CsvConfig<TRow> = {
  filename: string;
  columns?: Array<{
    header: string;
    accessor: (row: TRow) => string | number | null;
  }>;
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
