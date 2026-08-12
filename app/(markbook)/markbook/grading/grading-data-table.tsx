'use client';

import { CheckCircle2, ExternalLink, Lock, UserCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable, RowActionsMenu } from '@/components/ui/data-table';
import {
  type FacetConfig,
  type StatusTabConfig,
  type MeScopeConfig,
  type SelectionConfig,
} from '@/components/ui/data-table/types';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { cn } from '@/lib/utils';

// Self-contained per-row "Lock sheet" menu item. Owns its own AlertDialog +
// useMutation so it doesn't couple to the parent's bulk-lock state machine.
// Mirrors the existing bulk-lock mutation pattern exactly (same endpoint, same
// error voices, same router.refresh() on success).
function LockSheetMenuItem({ sheetId }: { sheetId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const lockMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ locked?: number; skipped?: number }>(
        '/api/grading-sheets/bulk-lock',
        jsonInit('POST', { ids: [sheetId] })
      ),
    onSuccess: () => {
      toast.success('Sheet locked.');
      setOpen(false);
      router.refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        toast.error(e.message || 'Could not lock the sheet.');
      } else {
        toast.error('Could not reach the server. Please try again.');
      }
    },
  });

  const busy = lockMutation.isPending;

  return (
    <>
      <DropdownMenuItem
        onSelect={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        <Lock className="size-3.5" />
        Lock sheet
      </DropdownMenuItem>
      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock this sheet?</AlertDialogTitle>
            <AlertDialogDescription>
              Locking stops teachers from editing scores on this sheet. After
              locking, any further change has to go through the grade
              change-request flow for approval. You can unlock a sheet later if
              needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                lockMutation.mutate();
              }}
              disabled={busy}
            >
              <Lock className="mr-1 h-4 w-4" />
              {busy ? 'Locking…' : 'Lock sheet'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export type GradingSheetRow = {
  id: string;
  section: string;
  level: string;
  /** 'primary' | 'secondary' — coarser-than-`level` filter axis for the
   *  School level facet. Sourced from levels.level_type. */
  school_level: 'primary' | 'secondary';
  subject: string;
  /** Subject format: true for numeric-graded (quarterly), false for the
   *  letter-graded subjects (CL/CA/PEH/PMPD per KD #95; MUSIC/ARTS/PE/HE
   *  were retired and replaced by numeric-graded MAPEH by migration 081). */
  is_examinable: boolean;
  term: string;
  teacher: string | null;
  /** auth user_id of the (section, subject) subject_teacher — drives the
   *  "My sheets" toggle alongside form_adviser_id. */
  subject_teacher_id?: string | null;
  /** Display name of the section's form_adviser — populates the hidden-by-
   *  default Form adviser column + faceted filter cell value. */
  form_adviser?: string | null;
  /** auth user_id of the section's form_adviser — drives "My sheets". */
  form_adviser_id?: string | null;
  /** True when the VIEWER is standing in on this slot for an absent colleague.
   *  Drives "My sheets" alongside the two ids above, and nothing else — the
   *  Teacher and Form adviser columns keep naming the regular teacher for the
   *  whole of a cover, because they answer who the class belongs to rather
   *  than who is working it this week (migrations 112/113). */
  covering?: boolean;
  is_locked: boolean;
  graded_count: number;
  total_students: number;
  graded_pct: number;
};

const BADGE_CLASS =
  'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

// Row-selection checkbox column. Only unlocked sheets are selectable — locking
// is a no-op on an already-locked sheet, so the column disables those rows and
// the header "select all" only toggles the open ones. Prepended to COLUMNS via
// buildColumns() only when the viewer can lock.
const SELECT_COLUMN: ColumnDef<GradingSheetRow> = {
  id: 'select',
  header: ({ table }) => {
    const selectableRows = table
      .getRowModel()
      .rows.filter((r) => r.getCanSelect());
    const selectedCount = selectableRows.filter((r) =>
      r.getIsSelected()
    ).length;
    const allSelected =
      selectableRows.length > 0 && selectedCount === selectableRows.length;
    const someSelected = selectedCount > 0 && !allSelected;
    return (
      <Checkbox
        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
        onCheckedChange={(value) => {
          for (const r of selectableRows) r.toggleSelected(!!value);
        }}
        disabled={selectableRows.length === 0}
        aria-label="Select all open sheets"
      />
    );
  },
  cell: ({ row }) => (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={(value) => row.toggleSelected(!!value)}
      disabled={!row.getCanSelect()}
      aria-label="Select sheet"
    />
  ),
  enableSorting: false,
  enableHiding: false,
};

const COLUMNS: ColumnDef<GradingSheetRow>[] = [
  {
    accessorKey: 'level',
    header: ({ column }) => (
      <SortableHeader column={column}>Level</SortableHeader>
    ),
    meta: { label: 'Level' },
    cell: ({ row }) => (
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {row.original.level}
      </span>
    ),
    filterFn: (row, id, value) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return true;
      return Array.isArray(value)
        ? value.includes(row.getValue(id))
        : row.getValue(id) === value;
    },
  },
  {
    accessorKey: 'section',
    header: ({ column }) => (
      <SortableHeader column={column}>Section</SortableHeader>
    ),
    meta: { label: 'Section' },
    cell: ({ row }) => (
      <IdentifierLink href={`/markbook/grading/${row.original.id}`}>
        {row.original.section}
      </IdentifierLink>
    ),
    filterFn: (row, id, value) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return true;
      return Array.isArray(value)
        ? value.includes(row.getValue(id))
        : row.getValue(id) === value;
    },
  },
  {
    accessorKey: 'subject',
    header: ({ column }) => (
      <SortableHeader column={column}>Subject</SortableHeader>
    ),
    meta: { label: 'Subject' },
    cell: ({ row }) => (
      <span className="text-foreground">{row.original.subject}</span>
    ),
    filterFn: (row, id, value) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return true;
      return Array.isArray(value)
        ? value.includes(row.getValue(id))
        : row.getValue(id) === value;
    },
  },
  {
    accessorKey: 'term',
    header: ({ column }) => (
      <SortableHeader column={column}>Term</SortableHeader>
    ),
    meta: { label: 'Term' },
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.term}</span>
    ),
    filterFn: (row, id, value) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return true;
      return Array.isArray(value)
        ? value.includes(row.getValue(id))
        : row.getValue(id) === value;
    },
  },
  {
    accessorKey: 'school_level',
    header: 'School level',
    cell: ({ row }) => (
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {row.original.school_level === 'primary' ? 'Primary' : 'Secondary'}
      </span>
    ),
    filterFn: (row, _id, value) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return true;
      const cell =
        row.original.school_level === 'primary' ? 'Primary' : 'Secondary';
      return Array.isArray(value) ? value.includes(cell) : cell === value;
    },
  },
  {
    accessorKey: 'is_examinable',
    header: 'Format',
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.is_examinable ? 'Examinable' : 'Non-examinable'}
      </span>
    ),
    filterFn: (row, _id, value) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return true;
      const cell = row.original.is_examinable ? 'Examinable' : 'Non-examinable';
      return Array.isArray(value) ? value.includes(cell) : cell === value;
    },
  },
  {
    accessorKey: 'teacher',
    header: 'Teacher',
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.teacher ?? '—'}
      </span>
    ),
    filterFn: (row, id, value) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return true;
      // Map null teacher → "(unassigned)" pseudo-value so registrars
      // can filter to sheets that haven't been assigned yet.
      const raw = row.getValue(id);
      const cell = raw == null || raw === '' ? '(unassigned)' : raw;
      return Array.isArray(value) ? value.includes(cell) : cell === value;
    },
  },
  {
    accessorKey: 'form_adviser',
    header: 'Form adviser',
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.form_adviser ?? '—'}
      </span>
    ),
    filterFn: (row, id, value) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return true;
      const raw = row.getValue(id);
      const cell = raw == null || raw === '' ? '(unassigned)' : raw;
      return Array.isArray(value) ? value.includes(cell) : cell === value;
    },
  },
  {
    accessorKey: 'graded_pct',
    header: ({ column }) => (
      <SortableHeader column={column}>Graded</SortableHeader>
    ),
    meta: { label: 'Graded' },
    cell: ({ row }) => {
      const { graded_count, total_students, graded_pct } = row.original;
      if (total_students === 0) {
        return (
          <Badge variant="outline" className={BADGE_CLASS}>
            No students
          </Badge>
        );
      }
      // Same 3-tier severity signal the prior badge conveyed (mint at 100%,
      // amber from 50-99%, destructive below 50%) — a sheet stuck at 20%
      // graded near a deadline should still read as alarming, not just
      // "not yet mint".
      const barClass =
        graded_pct === 100
          ? 'bg-brand-mint'
          : graded_pct >= 50
            ? 'bg-brand-amber'
            : 'bg-destructive';
      return (
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[13px] tabular-nums text-foreground">
            {graded_count}
            <span className="text-muted-foreground">/{total_students}</span>
          </span>
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full transition-all', barClass)}
              style={{ width: `${graded_pct}%` }}
            />
          </div>
          <span className="w-9 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
            {graded_pct}%
          </span>
        </div>
      );
    },
    sortingFn: (a, b) => a.original.graded_pct - b.original.graded_pct,
    filterFn: (row, _id, value) => {
      const { graded_pct, total_students } = row.original;
      if (value === 'incomplete') return total_students > 0 && graded_pct < 100;
      if (value === 'complete') return total_students > 0 && graded_pct === 100;
      if (value === 'empty') return total_students === 0;
      return true;
    },
  },
  {
    accessorKey: 'is_locked',
    header: 'Status',
    cell: ({ row }) =>
      row.original.is_locked ? (
        <Badge variant="blocked" className={BADGE_CLASS}>
          <Lock className="h-3 w-3" />
          Locked
        </Badge>
      ) : (
        <Badge variant="success" className={BADGE_CLASS}>
          <CheckCircle2 className="h-3 w-3" />
          Open
        </Badge>
      ),
    filterFn: (row, id, value) => {
      if (value === 'all') return true;
      if (value === 'locked') return row.getValue(id) === true;
      if (value === 'open') return row.getValue(id) === false;
      return true;
    },
  },
];

const STATUS_TABS: StatusTabConfig<GradingSheetRow>[] = [
  {
    value: 'all',
    label: 'All',
    predicate: () => true,
    isDefault: true,
  },
  {
    value: 'open',
    label: 'Open',
    predicate: (r) => !r.is_locked,
  },
  {
    value: 'locked',
    label: 'Locked',
    predicate: (r) => r.is_locked,
  },
  {
    value: 'incomplete',
    label: 'Incomplete',
    predicate: (r) => r.total_students > 0 && r.graded_pct < 100,
  },
];

export function GradingDataTable({
  data,
  initialSearch,
  teacherOptions,
  formAdviserOptions,
  currentUserId,
  canLock = false,
}: {
  data: GradingSheetRow[];
  /** Seed value for the global search input — used to deep-link from
   *  `/markbook/sections/[id]` "Grading sheets →" CTA, which passes the
   *  section name so the table opens pre-filtered to that section. The
   *  URL `?q=` param wins over this seed when present. */
  initialSearch?: string;
  /** Curated list of subject-teacher display names in the current AY.
   *  When provided, replaces the faceted unique values in the Teacher
   *  dropdown — so the dropdown lists every assigned teacher regardless
   *  of which other filters are active. Faceted "(unassigned)" pseudo
   *  is still appended when any visible row has `teacher = null`. */
  teacherOptions?: string[];
  /** Curated list of form-adviser display names in the current AY. */
  formAdviserOptions?: string[];
  /** Logged-in auth user_id — drives the "My sheets" toggle. When null
   *  the toggle hides (no teacher session, e.g. anonymous render). */
  currentUserId?: string | null;
  /** When true (registrar / school_admin / superadmin) the table enables
   *  multi-select on open (unlocked) rows + a "Lock selected" bulk action.
   *  Teachers never see selection — they can't lock. */
  canLock?: boolean;
}) {
  const router = useRouter();
  // Sheets queued for bulk lock — non-empty drives the confirm dialog open.
  const [pendingLock, setPendingLock] = useState<GradingSheetRow[]>([]);
  const [clearSelectionToken, setClearSelectionToken] = useState(0);

  // Tier-2 mutation (Model A): the bulk-lock POST runs through useMutation. The
  // success body carries `locked`/`skipped`, so that toast stays in onSuccess.
  // The two distinct error voices are preserved: an ApiError (non-2xx) surfaces
  // the route's message ('Could not lock the selected sheets.' fallback), while
  // any other failure (network) keeps the 'Could not reach the server.' copy.
  const lockMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ locked?: number; skipped?: number }>(
        '/api/grading-sheets/bulk-lock',
        jsonInit('POST', { ids })
      ),
    onSuccess: (json) => {
      const locked = json.locked ?? 0;
      const skipped = json.skipped ?? 0;
      toast.success(
        skipped > 0
          ? `Locked ${locked} ${locked === 1 ? 'sheet' : 'sheets'} (${skipped} already locked)`
          : `Locked ${locked} ${locked === 1 ? 'sheet' : 'sheets'}`
      );
      setPendingLock([]);
      setClearSelectionToken((t) => t + 1);
      router.refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        toast.error(e.message || 'Could not lock the selected sheets.');
      } else {
        toast.error('Could not reach the server. Please try again.');
      }
    },
  });

  const isLocking = lockMutation.isPending;

  function runBulkLock() {
    const ids = pendingLock.filter((r) => !r.is_locked).map((r) => r.id);
    if (ids.length === 0) {
      setPendingLock([]);
      return;
    }
    lockMutation.mutate(ids);
  }
  // Compute curated valueOptions for Teacher + Form adviser facets.
  // Include "(unassigned)" when any row has a null value for that column —
  // this mirrors the canonical reference's faceted-unique-values check.
  const teacherValueOptions = useMemo<string[] | undefined>(() => {
    if (
      !teacherOptions &&
      !data.some((r) => r.teacher == null || r.teacher === '')
    ) {
      return undefined; // let shell derive from faceted unique values
    }
    const hasUnassigned = data.some(
      (r) => r.teacher == null || r.teacher === ''
    );
    const named =
      teacherOptions && teacherOptions.length > 0
        ? [...teacherOptions]
        : Array.from(
            new Set(data.map((r) => r.teacher).filter((v): v is string => !!v))
          ).sort();
    return hasUnassigned ? [...named, '(unassigned)'] : named;
  }, [data, teacherOptions]);

  const adviserValueOptions = useMemo<string[] | undefined>(() => {
    if (
      !formAdviserOptions &&
      !data.some((r) => r.form_adviser == null || r.form_adviser === '')
    ) {
      return undefined;
    }
    const hasUnassigned = data.some(
      (r) => r.form_adviser == null || r.form_adviser === ''
    );
    const named =
      formAdviserOptions && formAdviserOptions.length > 0
        ? [...formAdviserOptions]
        : Array.from(
            new Set(
              data.map((r) => r.form_adviser).filter((v): v is string => !!v)
            )
          ).sort();
    return hasUnassigned ? [...named, '(unassigned)'] : named;
  }, [data, formAdviserOptions]);

  const facets = useMemo<FacetConfig[]>(
    () => [
      { columnId: 'section', label: 'Section' },
      {
        columnId: 'school_level',
        label: 'School level',
        valueOptions: ['Primary', 'Secondary'],
      },
      { columnId: 'level', label: 'Level' },
      {
        columnId: 'is_examinable',
        label: 'Format',
        valueOptions: ['Examinable', 'Non-examinable'],
      },
      { columnId: 'subject', label: 'Subject' },
      { columnId: 'term', label: 'Term' },
      {
        columnId: 'teacher',
        label: 'Teacher',
        valueOptions: teacherValueOptions,
      },
      {
        columnId: 'form_adviser',
        label: 'Form adviser',
        valueOptions: adviserValueOptions,
      },
    ],
    [teacherValueOptions, adviserValueOptions]
  );

  const meScope = useMemo<MeScopeConfig<GradingSheetRow> | undefined>(() => {
    if (!currentUserId) return undefined;
    return {
      userId: currentUserId,
      label: 'My sheets',
      icon: UserCheck,
      predicate: (row, uid) =>
        row.subject_teacher_id === uid ||
        row.form_adviser_id === uid ||
        // A sheet this viewer is covering is one of theirs to work on, even
        // though neither name column carries their name.
        row.covering === true,
    };
  }, [currentUserId]);

  const actionsColumn = useMemo<ColumnDef<GradingSheetRow>>(
    () => ({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <RowActionsMenu>
          <DropdownMenuItem asChild>
            <Link href={`/markbook/grading/${row.original.id}`}>
              <ExternalLink className="size-3.5" />
              Open sheet
            </Link>
          </DropdownMenuItem>
          {canLock && !row.original.is_locked && (
            <LockSheetMenuItem sheetId={row.original.id} />
          )}
        </RowActionsMenu>
      ),
      enableSorting: false,
      enableHiding: false,
    }),
    [canLock]
  );

  const columns = useMemo<ColumnDef<GradingSheetRow>[]>(
    () =>
      canLock
        ? [SELECT_COLUMN, ...COLUMNS, actionsColumn]
        : [...COLUMNS, actionsColumn],
    [canLock, actionsColumn]
  );

  const selection = useMemo<
    SelectionConfig<GradingSheetRow> | undefined
  >(() => {
    if (!canLock) return undefined;
    return {
      enabled: true,
      // Only open sheets are selectable — locked ones can't be re-locked.
      enableRowSelection: (row) => !row.is_locked,
      bulkActions: [
        {
          key: 'lock',
          label: 'Lock selected',
          icon: Lock,
          onTrigger: (selectedRows) =>
            setPendingLock(selectedRows.filter((r) => !r.is_locked)),
        },
      ],
    };
  }, [canLock]);

  const lockableCount = pendingLock.filter((r) => !r.is_locked).length;

  return (
    <>
      <DataTable<GradingSheetRow>
        data={data}
        columns={columns}
        selection={selection}
        selectionResetSignal={clearSelectionToken}
        getRowId={(row) => row.id}
        searchKeys={[
          'section',
          'subject',
          'term',
          'teacher',
          'form_adviser',
          'level',
        ]}
        initialSearch={initialSearch}
        searchPlaceholder="Search section, subject, teacher…"
        facets={facets}
        statusTabs={STATUS_TABS}
        meScope={meScope}
        initialSort={[
          { id: 'level', desc: false },
          { id: 'section', desc: false },
        ]}
        initialColumnVisibility={{
          form_adviser: false,
          school_level: false,
          is_examinable: false,
        }}
        pageSize={20}
        pageSizeOptions={[10, 20, 50, 100]}
        url={{ enabled: true, namespace: 'grading' }}
        emptyState={{
          title: 'No grading sheets yet.',
          body: 'Create the first sheet for a subject × section × term.',
        }}
        emptyFilteredState={{
          title: 'No sheets match the current filters.',
          body: 'Try clearing some filters.',
        }}
      />
      <AlertDialog
        open={pendingLock.length > 0}
        onOpenChange={(open) => {
          if (!open && !isLocking) setPendingLock([]);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Lock {lockableCount} {lockableCount === 1 ? 'sheet' : 'sheets'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Locking stops teachers from editing scores on{' '}
              {lockableCount === 1 ? 'this sheet' : 'these sheets'}. After
              locking, any further change has to go through the grade
              change-request flow for approval. You can unlock a sheet later if
              needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLocking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog mounted until the request resolves.
                e.preventDefault();
                void runBulkLock();
              }}
              disabled={isLocking || lockableCount === 0}
            >
              <Lock className="mr-1 h-4 w-4" />
              {isLocking ? 'Locking…' : `Lock ${lockableCount}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
