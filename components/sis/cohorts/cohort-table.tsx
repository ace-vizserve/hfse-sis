'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell, Mail } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

import { PreCourseDateCell } from '@/components/sis/cohorts/pre-course-date-cell';
import { ApplicationStatusBadge } from '@/components/ui/application-status-badge';
import { Badge } from '@/components/ui/badge';
import { DataTable, RowActionsMenu } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { IdentifierLink } from '@/components/ui/identifier-link';
import {
  ChartLegendChip,
  type ChartLegendChipColor,
} from '@/components/dashboard/chart-legend-chip';
import {
  BulkNotifyDialog,
  type BulkNotifyItem,
} from '@/components/p-files/bulk-notify-dialog';
import type {
  CohortStudentRow,
  CohortScope,
  PromisedSlot,
  ParentPassExpiry,
} from '@/lib/sis/cohorts';
import type { StatusTabConfig } from '@/components/ui/data-table/types';

// ─── Re-export the STP row type for consumer convenience ────────────────────

export type { CohortStudentRow as StpCohortRow };

// ─── Public API ─────────────────────────────────────────────────────────────

export type CohortKind =
  | 'stp'
  | 'promised'
  | 'pass-expiry'
  | 'medical'
  | 'pre-course';
export type { CohortScope };

// All kinds use CohortStudentRow — the shared loader shape.
type CohortRowMap = {
  stp: CohortStudentRow;
  promised: CohortStudentRow;
  'pass-expiry': CohortStudentRow;
  medical: CohortStudentRow;
  'pre-course': CohortStudentRow;
};

export type CohortTableProps<K extends CohortKind> = {
  kind: K;
  scope: CohortScope;
  ayCode: string;
  rows: Array<CohortRowMap[K]>;
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── STP detail href resolver ─────────────────────────────────────────────────

function stpDetailHref(
  row: CohortStudentRow,
  scope: CohortScope,
  ayCode: string
): string {
  if (scope === 'enrolled' && row.studentNumber) {
    return `/records/students/${encodeURIComponent(row.studentNumber)}`;
  }
  // Land directly on the Documents tab — STP cohort is a doc-validation
  // adjacent view, the registrar typically clicks through to act on a
  // specific slot. Saves a tab click vs the previous `tab=lifecycle`
  // default.
  const params = new URLSearchParams({ ay: ayCode, tab: 'documents' });
  return `/admissions/applications/${encodeURIComponent(row.enroleeNumber)}?${params.toString()}`;
}

// ─── STP column builder ───────────────────────────────────────────────────────

function buildStpColumns(
  scope: CohortScope,
  ayCode: string
): ColumnDef<CohortStudentRow>[] {
  return [
    {
      id: 'student',
      accessorFn: (r) => r.enroleeFullName ?? r.enroleeNumber,
      header: ({ column }) => (
        <SortableHeader column={column}>Student</SortableHeader>
      ),
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <IdentifierLink href={stpDetailHref(row.original, scope, ayCode)}>
            {row.original.enroleeFullName ?? '—'}
          </IdentifierLink>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {row.original.enroleeNumber}
            {row.original.studentNumber
              ? ` · ${row.original.studentNumber}`
              : ''}
          </div>
        </div>
      ),
      enableSorting: true,
    },
    {
      id: 'levelApplied',
      accessorKey: 'levelApplied',
      header: 'Level',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.levelApplied ?? '—'}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'stpType',
      accessorKey: 'stpApplicationType',
      header: 'STP type',
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {row.original.stpApplicationType ?? '—'}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'stpStatus',
      accessorKey: 'stpApplicationStatus',
      header: 'ICA status',
      cell: ({ row }) => {
        const v = row.original.stpApplicationStatus ?? null;
        if (!v) return <Badge variant="outline">Not set</Badge>;
        const variant: 'warning' | 'default' | 'success' | 'blocked' =
          v === 'Approved'
            ? 'success'
            : v === 'Rejected'
              ? 'blocked'
              : v === 'Submitted'
                ? 'default'
                : 'warning';
        return <Badge variant={variant}>{v}</Badge>;
      },
      enableSorting: true,
    },
    {
      id: 'residence',
      accessorFn: (r) => (r.residenceHistoryFilled ? 1 : 0),
      header: 'Residence',
      cell: ({ row }) =>
        row.original.residenceHistoryFilled ? (
          <Badge variant="success">Filled</Badge>
        ) : (
          <Badge variant="warning">Missing</Badge>
        ),
      enableSorting: true,
    },
    {
      id: 'stpComplete',
      accessorFn: (r) => (r.stpComplete ? 1 : 0),
      header: 'STP complete',
      cell: ({ row }) =>
        row.original.stpComplete ? (
          <Badge variant="success">Yes</Badge>
        ) : (
          <Badge variant="blocked">No</Badge>
        ),
      enableSorting: true,
    },
    {
      id: 'applicationStatus',
      accessorKey: 'applicationStatus',
      header: 'App status',
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.applicationStatus ?? '—'}</Badge>
      ),
      enableSorting: true,
    },
    buildCrossModuleActionsColumn(scope, ayCode),
  ];
}

// ─── STP status-tab + facet config ───────────────────────────────────────────

const STP_STATUS_TABS: StatusTabConfig<CohortStudentRow>[] = [
  {
    value: 'incomplete',
    label: 'Incomplete',
    predicate: (r) => r.stpComplete !== true,
    isDefault: true,
  },
  {
    value: 'complete',
    label: 'Complete',
    predicate: (r) => r.stpComplete === true,
  },
  {
    value: 'all',
    label: 'All',
    predicate: () => true,
  },
];

const STP_FACETS = [
  { columnId: 'levelApplied', label: 'Level' },
  { columnId: 'stpType', label: 'STP type' },
  { columnId: 'stpStatus', label: 'ICA status' },
  { columnId: 'applicationStatus', label: 'App status' },
];

const STP_EMPTY_STATE = {
  title: 'No STP applicants yet.',
  body: 'Students whose application requires a Student Pass will appear here.',
};

// ─── Promised detail href ─────────────────────────────────────────────────────

function promisedDetailHref(enroleeNumber: string, ayCode: string): string {
  const params = new URLSearchParams({ ay: ayCode, tab: 'documents' });
  return `/admissions/applications/${encodeURIComponent(enroleeNumber)}?${params.toString()}`;
}

// ─── Promised helpers ─────────────────────────────────────────────────────────

function chipColorForSlot(slot: PromisedSlot): ChartLegendChipColor {
  if (slot.promisedUntil === null) return 'neutral';
  if (slot.pastDue) return 'very-stale';
  if (slot.daysUntil !== null && slot.daysUntil <= 7) return 'stale';
  if (slot.daysUntil !== null && slot.daysUntil <= 30) return 'primary';
  return 'fresh';
}

function PromisedSlotChips({ slots }: { slots: PromisedSlot[] | undefined }) {
  if (!slots || slots.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {slots.map((s) => {
        const dateLabel =
          s.promisedUntil === null
            ? 'date not captured'
            : formatDate(s.promisedUntil);
        return (
          <ChartLegendChip
            key={s.key}
            color={chipColorForSlot(s)}
            label={`${s.label} · ${dateLabel}`}
          />
        );
      })}
    </div>
  );
}

function PromisedDaysPill({ days }: { days: number | null | undefined }) {
  if (days === null || days === undefined)
    return <Badge variant="muted">—</Badge>;
  if (days < 0)
    return <Badge variant="blocked">{Math.abs(days)}d past-due</Badge>;
  if (days === 0) return <Badge variant="blocked">Due today</Badge>;
  if (days <= 7) return <Badge variant="warning">{days}d</Badge>;
  if (days <= 30) return <Badge variant="default">{days}d</Badge>;
  return <Badge variant="success">{days}d</Badge>;
}

// ─── Promised column builder ──────────────────────────────────────────────────

function buildPromisedColumns(
  ayCode: string,
  openBulkNotify: (rows: CohortStudentRow[]) => void
): ColumnDef<CohortStudentRow>[] {
  return [
    {
      id: 'student',
      accessorFn: (r) => r.enroleeFullName ?? r.enroleeNumber,
      header: ({ column }) => (
        <SortableHeader column={column}>Student</SortableHeader>
      ),
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <IdentifierLink
            href={promisedDetailHref(row.original.enroleeNumber, ayCode)}
          >
            {row.original.enroleeFullName ?? '—'}
          </IdentifierLink>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {row.original.enroleeNumber}
            {row.original.studentNumber
              ? ` · ${row.original.studentNumber}`
              : ''}
          </div>
        </div>
      ),
      enableSorting: true,
    },
    {
      id: 'levelApplied',
      accessorKey: 'levelApplied',
      header: 'Level',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.levelApplied ?? '—'}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'applicationStatus',
      accessorKey: 'applicationStatus',
      header: 'App status',
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.applicationStatus ?? '—'}</Badge>
      ),
      enableSorting: true,
    },
    {
      id: 'toFollowCount',
      accessorFn: (r) => r.toFollowCount ?? 0,
      header: ({ column }) => (
        <SortableHeader column={column} className="justify-end">
          To follow
        </SortableHeader>
      ),
      cell: ({ row }) => (
        <Badge variant="muted" className="font-mono tabular-nums">
          {row.original.toFollowCount ?? 0}
        </Badge>
      ),
      enableSorting: true,
      sortingFn: (a, b) =>
        (a.getValue<number>('toFollowCount') ?? 0) -
        (b.getValue<number>('toFollowCount') ?? 0),
    },
    {
      id: 'promisedSlots',
      accessorFn: (r) => r.toFollowSlots?.length ?? 0,
      header: 'Promised slots',
      cell: ({ row }) => (
        <PromisedSlotChips slots={row.original.toFollowSlots} />
      ),
      enableSorting: false,
    },
    {
      id: 'earliestDate',
      accessorFn: (r) => r.earliestPromisedUntil ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Earliest promised</SortableHeader>
      ),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-foreground">
          {formatDate(row.original.earliestPromisedUntil)}
        </span>
      ),
      enableSorting: true,
      // ISO date strings sort correctly as strings; empty string (null) sorts last.
      sortingFn: (a, b, dir) => {
        const va = a.getValue<string>('earliestDate');
        const vb = b.getValue<string>('earliestDate');
        if (!va && !vb) return 0;
        if (!va) return dir === 'asc' ? 1 : -1;
        if (!vb) return dir === 'asc' ? -1 : 1;
        return va < vb ? -1 : va > vb ? 1 : 0;
      },
    },
    {
      id: 'daysUntil',
      accessorFn: (r) =>
        r.daysUntilEarliestPromise === null ||
        r.daysUntilEarliestPromise === undefined
          ? Number.POSITIVE_INFINITY
          : r.daysUntilEarliestPromise,
      header: ({ column }) => (
        <SortableHeader column={column} className="justify-end">
          Days until
        </SortableHeader>
      ),
      cell: ({ row }) => (
        <PromisedDaysPill days={row.original.daysUntilEarliestPromise} />
      ),
      enableSorting: true,
      // accessorFn already maps null → +Infinity so nulls naturally sort last.
      sortingFn: 'basic',
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <RowActionsMenu>
          <DropdownMenuItem onSelect={() => openBulkNotify([row.original])}>
            <Bell className="size-3.5" />
            Send reminder
          </DropdownMenuItem>
        </RowActionsMenu>
      ),
      enableSorting: false,
    },
  ];
}

// ─── Promised status-tab config ───────────────────────────────────────────────

const PROMISED_STATUS_TABS: StatusTabConfig<CohortStudentRow>[] = [
  {
    value: 'past-due',
    label: 'Past-due',
    predicate: (r) =>
      (r.daysUntilEarliestPromise ?? null) !== null &&
      (r.daysUntilEarliestPromise as number) < 0,
  },
  {
    value: 'today',
    label: 'Due today',
    predicate: (r) => r.daysUntilEarliestPromise === 0,
  },
  {
    value: 'd7',
    label: 'Within 7 days',
    predicate: (r) =>
      r.daysUntilEarliestPromise !== null &&
      r.daysUntilEarliestPromise !== undefined &&
      r.daysUntilEarliestPromise <= 7,
    isDefault: true,
  },
  {
    value: 'd14',
    label: 'Within 14 days',
    predicate: (r) =>
      r.daysUntilEarliestPromise !== null &&
      r.daysUntilEarliestPromise !== undefined &&
      r.daysUntilEarliestPromise <= 14,
  },
  {
    value: 'd30',
    label: 'Within 30 days',
    predicate: (r) =>
      r.daysUntilEarliestPromise !== null &&
      r.daysUntilEarliestPromise !== undefined &&
      r.daysUntilEarliestPromise <= 30,
  },
  {
    value: 'all',
    label: 'All',
    predicate: () => true,
  },
];

const PROMISED_FACETS = [
  { columnId: 'levelApplied', label: 'Level' },
  { columnId: 'applicationStatus', label: 'App status' },
];

const PROMISED_EMPTY_STATE = {
  title: 'No applicants with promised documents.',
  body: 'Applicants where a parent has committed to submitting a document by a date will appear here.',
};

// ─── Pass-expiry detail href ──────────────────────────────────────────────────

function passExpiryDetailHref(
  row: CohortStudentRow,
  scope: CohortScope,
  ayCode: string
): string {
  if (scope === 'enrolled' && row.studentNumber) {
    return `/records/students/${encodeURIComponent(row.studentNumber)}`;
  }
  const params = new URLSearchParams({ ay: ayCode, tab: 'lifecycle' });
  return `/admissions/applications/${encodeURIComponent(row.enroleeNumber)}?${params.toString()}`;
}

// ─── Pass-expiry helpers ──────────────────────────────────────────────────────

function PassExpiryDaysPill({ days }: { days: number | null | undefined }) {
  if (days === null || days === undefined)
    return <Badge variant="outline">—</Badge>;
  if (days < 0)
    return <Badge variant="blocked">{Math.abs(days)}d expired</Badge>;
  if (days <= 7) return <Badge variant="blocked">{days}d</Badge>;
  if (days <= 30) return <Badge variant="warning">{days}d</Badge>;
  if (days <= 90) return <Badge variant="success">{days}d</Badge>;
  return <Badge variant="muted">{days}d</Badge>;
}

function ParentExpiryChips({ list }: { list: ParentPassExpiry[] | undefined }) {
  if (!list || list.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((p) => (
        <ChartLegendChip
          key={`${p.kind}-${p.date}`}
          color="neutral"
          label={`${p.kind} · ${formatDate(p.date)}`}
        />
      ))}
    </div>
  );
}

function StudentKindChip({
  kind,
}: {
  kind: 'passport' | 'pass' | null | undefined;
}) {
  if (!kind) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <ChartLegendChip
      color="primary"
      label={kind === 'passport' ? 'Student passport' : 'Student pass'}
    />
  );
}

// ─── Pass-expiry column builder ───────────────────────────────────────────────

function buildPassExpiryColumns(
  scope: CohortScope,
  ayCode: string
): ColumnDef<CohortStudentRow>[] {
  return [
    {
      id: 'student',
      accessorFn: (r) => r.enroleeFullName ?? r.enroleeNumber,
      header: ({ column }) => (
        <SortableHeader column={column}>Student</SortableHeader>
      ),
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <IdentifierLink
            href={passExpiryDetailHref(row.original, scope, ayCode)}
          >
            {row.original.enroleeFullName ?? '—'}
          </IdentifierLink>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {row.original.enroleeNumber}
            {row.original.studentNumber
              ? ` · ${row.original.studentNumber}`
              : ''}
          </div>
        </div>
      ),
      enableSorting: true,
    },
    {
      id: 'levelApplied',
      accessorKey: 'levelApplied',
      header: 'Level',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.levelApplied ?? '—'}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'earliestKind',
      accessorFn: (r) => r.studentPassExpiryKind ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Earliest kind</SortableHeader>
      ),
      cell: ({ row }) => (
        <StudentKindChip kind={row.original.studentPassExpiryKind} />
      ),
      enableSorting: true,
    },
    {
      id: 'earliestDate',
      accessorFn: (r) => r.earliestExpiry ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Earliest expiry</SortableHeader>
      ),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-foreground">
          {formatDate(row.original.earliestExpiry)}
        </span>
      ),
      enableSorting: true,
      // ISO date strings sort correctly as strings; empty string (null) sorts last.
      sortingFn: (a, b, dir) => {
        const va = a.getValue<string>('earliestDate');
        const vb = b.getValue<string>('earliestDate');
        if (!va && !vb) return 0;
        if (!va) return dir === 'asc' ? 1 : -1;
        if (!vb) return dir === 'asc' ? -1 : 1;
        return va < vb ? -1 : va > vb ? 1 : 0;
      },
    },
    {
      id: 'daysUntil',
      accessorFn: (r) => r.daysUntilEarliestExpiry ?? Number.POSITIVE_INFINITY,
      header: ({ column }) => (
        <SortableHeader column={column} className="justify-end">
          Days until
        </SortableHeader>
      ),
      cell: ({ row }) => (
        <PassExpiryDaysPill days={row.original.daysUntilEarliestExpiry} />
      ),
      enableSorting: true,
      // accessorFn already maps null → +Infinity so nulls naturally sort last.
      sortingFn: 'basic',
    },
    {
      id: 'parentExpiries',
      accessorFn: (r) => r.parentPassExpiries?.length ?? 0,
      header: 'Parent expiries',
      cell: ({ row }) => (
        <ParentExpiryChips list={row.original.parentPassExpiries} />
      ),
      enableSorting: true,
    },
    {
      id: 'applicationStatus',
      accessorKey: 'applicationStatus',
      header: 'App status',
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.applicationStatus ?? '—'}</Badge>
      ),
      enableSorting: true,
    },
    // Pass-expiry rows carry no document `toFollowSlots`, so the BulkNotify
    // pipeline can't build reminder items for them — surface cross-module nav
    // instead (renewal chasing lives in the P-Files expiring queue).
    buildCrossModuleActionsColumn(scope, ayCode),
  ];
}

// ─── Pass-expiry status-tab config ───────────────────────────────────────────

const PASS_EXPIRY_STATUS_TABS: StatusTabConfig<CohortStudentRow>[] = [
  {
    value: 'expired',
    label: 'Already expired',
    predicate: (r) =>
      (r.daysUntilEarliestExpiry ?? null) !== null &&
      (r.daysUntilEarliestExpiry as number) < 0,
  },
  {
    value: 'd30',
    label: 'Within 30 days',
    predicate: (r) =>
      r.daysUntilEarliestExpiry !== null &&
      r.daysUntilEarliestExpiry !== undefined &&
      r.daysUntilEarliestExpiry <= 30,
    isDefault: true,
  },
  {
    value: 'd60',
    label: 'Within 60 days',
    predicate: (r) =>
      r.daysUntilEarliestExpiry !== null &&
      r.daysUntilEarliestExpiry !== undefined &&
      r.daysUntilEarliestExpiry <= 60,
  },
  {
    value: 'd90',
    label: 'Within 90 days',
    predicate: (r) =>
      r.daysUntilEarliestExpiry !== null &&
      r.daysUntilEarliestExpiry !== undefined &&
      r.daysUntilEarliestExpiry <= 90,
  },
  {
    value: 'all',
    label: 'All future',
    predicate: () => true,
  },
];

const PASS_EXPIRY_FACETS = [
  { columnId: 'levelApplied', label: 'Level' },
  { columnId: 'applicationStatus', label: 'App status' },
];

const PASS_EXPIRY_EMPTY_STATE = {
  title: 'No passports or passes expiring soon.',
  body: 'Students with expiring or expired travel documents will appear here.',
};

// ─── Medical detail href ──────────────────────────────────────────────────────

function medicalDetailHref(
  row: CohortStudentRow,
  scope: CohortScope,
  ayCode: string
): string {
  if (scope === 'enrolled' && row.studentNumber) {
    return `/records/students/${encodeURIComponent(row.studentNumber)}`;
  }
  const params = new URLSearchParams({ ay: ayCode, tab: 'profile' });
  return `/admissions/applications/${encodeURIComponent(row.enroleeNumber)}?${params.toString()}`;
}

// ─── Medical helpers ──────────────────────────────────────────────────────────

const FLAG_LABEL: Record<string, string> = {
  allergies: 'Allergies',
  asthma: 'Asthma',
  foodAllergies: 'Food allergies',
  heartConditions: 'Heart',
  epilepsy: 'Epilepsy',
  diabetes: 'Diabetes',
  eczema: 'Eczema',
  otherMedicalConditions: 'Other',
  dietaryRestrictions: 'Dietary',
};

function FlagChips({ flags }: { flags: string[] | undefined }) {
  if (!flags || flags.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <ChartLegendChip
          key={f}
          color="very-stale"
          label={FLAG_LABEL[f] ?? f}
        />
      ))}
    </div>
  );
}

function TruncatedText({
  value,
  max = 80,
}: {
  value: string | null | undefined;
  max?: number;
}) {
  const s = (value ?? '').trim();
  if (!s) return <span className="text-xs text-muted-foreground">—</span>;
  const truncated = s.length > max ? `${s.slice(0, max)}…` : s;
  return (
    <span className="text-sm text-foreground" title={s}>
      {truncated}
    </span>
  );
}

// ─── Medical column builder ───────────────────────────────────────────────────

function buildMedicalColumns(
  scope: CohortScope,
  ayCode: string
): ColumnDef<CohortStudentRow>[] {
  return [
    {
      id: 'student',
      accessorFn: (r) => r.enroleeFullName ?? r.enroleeNumber,
      header: ({ column }) => (
        <SortableHeader column={column}>Student</SortableHeader>
      ),
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <IdentifierLink href={medicalDetailHref(row.original, scope, ayCode)}>
            {row.original.enroleeFullName ?? '—'}
          </IdentifierLink>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {row.original.enroleeNumber}
            {row.original.studentNumber
              ? ` · ${row.original.studentNumber}`
              : ''}
          </div>
        </div>
      ),
      enableSorting: true,
    },
    {
      id: 'levelApplied',
      accessorKey: 'levelApplied',
      header: 'Level',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.levelApplied ?? '—'}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'medicalFlags',
      accessorFn: (r) => r.medicalFlags?.length ?? 0,
      header: ({ column }) => (
        <SortableHeader column={column} className="justify-end">
          Flags
        </SortableHeader>
      ),
      cell: ({ row }) => <FlagChips flags={row.original.medicalFlags} />,
      enableSorting: true,
      sortingFn: (a, b) =>
        (a.getValue<number>('medicalFlags') ?? 0) -
        (b.getValue<number>('medicalFlags') ?? 0),
    },
    {
      id: 'allergyDetails',
      accessorKey: 'allergyDetails',
      header: 'Allergies',
      cell: ({ row }) => <TruncatedText value={row.original.allergyDetails} />,
      enableSorting: false,
    },
    {
      id: 'foodAllergyDetails',
      accessorKey: 'foodAllergyDetails',
      header: 'Food allergies',
      cell: ({ row }) => (
        <TruncatedText value={row.original.foodAllergyDetails} />
      ),
      enableSorting: false,
    },
    {
      id: 'otherMedicalConditions',
      accessorKey: 'otherMedicalConditions',
      header: 'Other conditions',
      cell: ({ row }) => (
        <TruncatedText value={row.original.otherMedicalConditions} />
      ),
      enableSorting: false,
    },
    {
      id: 'dietaryRestrictions',
      accessorKey: 'dietaryRestrictions',
      header: 'Dietary',
      cell: ({ row }) => (
        <TruncatedText value={row.original.dietaryRestrictions} />
      ),
      enableSorting: false,
    },
    {
      id: 'paracetamolConsent',
      accessorFn: (r) =>
        r.paracetamolConsent === true
          ? 2
          : r.paracetamolConsent === false
            ? 0
            : 1,
      header: 'Paracetamol',
      cell: ({ row }) => {
        if (row.original.paracetamolConsent === true)
          return <Badge variant="success">Yes</Badge>;
        if (row.original.paracetamolConsent === false)
          return <Badge variant="blocked">No</Badge>;
        return <Badge variant="outline">—</Badge>;
      },
      enableSorting: true,
    },
    {
      id: 'applicationStatus',
      accessorKey: 'applicationStatus',
      header: 'App status',
      cell: ({ row }) => (
        <ApplicationStatusBadge
          status={row.original.applicationStatus ?? null}
        />
      ),
      enableSorting: true,
    },
    buildCrossModuleActionsColumn(scope, ayCode),
  ];
}

// ─── Medical status-tab config ────────────────────────────────────────────────

const MEDICAL_STATUS_TABS: StatusTabConfig<CohortStudentRow>[] = [
  {
    value: 'any',
    label: 'Any flag',
    predicate: () => true,
    isDefault: true,
  },
  {
    value: 'allergies',
    label: 'Allergies',
    predicate: (r) =>
      (r.medicalFlags ?? []).includes('allergies') ||
      (r.medicalFlags ?? []).includes('foodAllergies'),
  },
  {
    value: 'asthma',
    label: 'Asthma',
    predicate: (r) => (r.medicalFlags ?? []).includes('asthma'),
  },
  {
    value: 'multi',
    label: 'Multiple flags',
    predicate: (r) => (r.medicalFlags ?? []).length >= 2,
  },
  {
    value: 'paracetamolYes',
    label: 'Paracetamol: Yes',
    predicate: (r) => r.paracetamolConsent === true,
  },
  {
    value: 'paracetamolNo',
    label: 'Paracetamol: No',
    predicate: (r) => r.paracetamolConsent === false,
  },
];

const MEDICAL_FACETS = [
  { columnId: 'levelApplied', label: 'Level' },
  { columnId: 'applicationStatus', label: 'App status' },
];

const MEDICAL_EMPTY_STATE = {
  title: 'No medical flags on record.',
  body: 'Students with allergies, asthma, or other flagged conditions will appear here.',
};

// ─── Pre-course detail href ───────────────────────────────────────────────────

function preCourseDetailHref(enroleeNumber: string, ayCode: string): string {
  const params = new URLSearchParams({ ay: ayCode, tab: 'profile' });
  return `/admissions/applications/${encodeURIComponent(enroleeNumber)}?${params.toString()}`;
}

// ─── Pre-course status badge ──────────────────────────────────────────────────

function PreCourseStatusBadge({
  status,
}: {
  status: 'complete' | 'not-yet' | undefined;
}) {
  if (status === 'complete') return <Badge variant="success">Counselled</Badge>;
  // Anything not counselled (explicit "No" or no answer yet) is the actionable
  // bucket — every applicant must be counselled before submitting.
  return <Badge variant="blocked">Not yet counselled</Badge>;
}

function PreCourseAnswerBadge({
  answer,
}: {
  answer: 'Yes' | 'No' | null | undefined;
}) {
  if (answer === 'Yes') return <Badge variant="success">Yes — completed</Badge>;
  if (answer === 'No') return <Badge variant="warning">No — not yet</Badge>;
  return <span className="text-xs text-muted-foreground">—</span>;
}

// ─── Pre-course column builder ────────────────────────────────────────────────

function buildPreCourseColumns(
  ayCode: string,
  scope: CohortScope
): ColumnDef<CohortStudentRow>[] {
  return [
    {
      id: 'student',
      accessorFn: (r) => r.enroleeFullName ?? r.enroleeNumber,
      header: ({ column }) => (
        <SortableHeader column={column}>Student</SortableHeader>
      ),
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <IdentifierLink
            href={preCourseDetailHref(row.original.enroleeNumber, ayCode)}
          >
            {row.original.enroleeFullName ?? '—'}
          </IdentifierLink>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {row.original.enroleeNumber}
            {row.original.studentNumber
              ? ` · ${row.original.studentNumber}`
              : ''}
          </div>
        </div>
      ),
      enableSorting: true,
    },
    {
      id: 'levelApplied',
      accessorKey: 'levelApplied',
      header: 'Level',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.levelApplied ?? '—'}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'applicationStatus',
      accessorKey: 'applicationStatus',
      header: 'App status',
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.applicationStatus ?? '—'}</Badge>
      ),
      enableSorting: true,
    },
    {
      id: 'preCourseStatus',
      accessorFn: (r) => (r.preCourseStatus === 'complete' ? 1 : 0),
      header: 'Status',
      cell: ({ row }) => (
        <PreCourseStatusBadge status={row.original.preCourseStatus} />
      ),
      enableSorting: true,
    },
    {
      id: 'preCourseDate',
      accessorFn: (r) => r.preCourseDate ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Session date</SortableHeader>
      ),
      cell: ({ row }) => (
        <PreCourseDateCell
          enroleeNumber={row.original.enroleeNumber}
          ayCode={ayCode}
          value={row.original.preCourseDate ?? null}
        />
      ),
      enableSorting: true,
      // ISO date strings sort correctly as strings; empty string (null) sorts last.
      sortingFn: (a, b, dir) => {
        const va = a.getValue<string>('preCourseDate');
        const vb = b.getValue<string>('preCourseDate');
        if (!va && !vb) return 0;
        if (!va) return dir === 'asc' ? 1 : -1;
        if (!vb) return dir === 'asc' ? -1 : 1;
        return va < vb ? -1 : va > vb ? 1 : 0;
      },
    },
    {
      id: 'preCourseAnswer',
      accessorFn: (r) => r.preCourseAnswer ?? '',
      header: "Parent's answer",
      cell: ({ row }) => (
        <PreCourseAnswerBadge answer={row.original.preCourseAnswer} />
      ),
      enableSorting: true,
    },
    {
      id: 'preCourseAcknowledgedAt',
      accessorFn: (r) => r.preCourseAcknowledgedAt ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Acknowledged</SortableHeader>
      ),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-foreground">
          {formatDate(row.original.preCourseAcknowledgedAt)}
        </span>
      ),
      enableSorting: true,
      // ISO date strings (or ISO timestamps) sort correctly as strings; empty string sorts last.
      sortingFn: (a, b, dir) => {
        const va = a.getValue<string>('preCourseAcknowledgedAt');
        const vb = b.getValue<string>('preCourseAcknowledgedAt');
        if (!va && !vb) return 0;
        if (!va) return dir === 'asc' ? 1 : -1;
        if (!vb) return dir === 'asc' ? -1 : 1;
        return va < vb ? -1 : va > vb ? 1 : 0;
      },
    },
    buildCrossModuleActionsColumn(scope, ayCode),
  ];
}

// ─── Pre-course status-tab config ─────────────────────────────────────────────

const PRE_COURSE_STATUS_TABS: StatusTabConfig<CohortStudentRow>[] = [
  {
    value: 'not-yet',
    label: 'Not yet counselled',
    predicate: (r) => r.preCourseStatus !== 'complete',
    isDefault: true,
  },
  {
    value: 'complete',
    label: 'Counselled',
    predicate: (r) => r.preCourseStatus === 'complete',
  },
  {
    value: 'all',
    label: 'All',
    predicate: () => true,
  },
];

const PRE_COURSE_FACETS = [
  { columnId: 'levelApplied', label: 'Level' },
  { columnId: 'applicationStatus', label: 'App status' },
  { columnId: 'preCourseStatus', label: 'PCC status' },
];

const PRE_COURSE_EMPTY_STATE = {
  title: 'No applicants in this view.',
  body: 'Pre-Course Counselling acknowledgement status will appear here once parents complete the counselling session.',
};

// ─── Shared cross-module nav actions column ───────────────────────────────────
//
// Used by stp / medical / pre-course — kinds that have no bulk action today
// but should let the registrar jump to the relevant module surface.
// Gate: "Open in Records" only when enrolled (scope==='enrolled') AND
// studentNumber is present; "Open in Admissions" always (enroleeNumber exists).

function buildCrossModuleActionsColumn(
  scope: CohortScope,
  ayCode: string
): ColumnDef<CohortStudentRow> {
  return {
    id: 'actions',
    header: '',
    cell: ({ row }) => {
      const r = row.original;
      const showRecords = scope === 'enrolled' && !!r.studentNumber;
      const admissionsHref = `/admissions/applications/${encodeURIComponent(r.enroleeNumber)}?ay=${ayCode}`;
      const recordsHref = showRecords
        ? `/records/students/${encodeURIComponent(r.studentNumber!)}`
        : null;

      // Render nothing if there are genuinely no items.
      if (!showRecords && !r.enroleeNumber) return null;

      return (
        <RowActionsMenu>
          {recordsHref && (
            <DropdownMenuItem asChild>
              <Link href={recordsHref}>Open in Records</Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href={admissionsHref}>Open in Admissions</Link>
          </DropdownMenuItem>
        </RowActionsMenu>
      );
    },
    enableSorting: false,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CohortTable<K extends CohortKind>(props: CohortTableProps<K>) {
  const { kind, scope, ayCode, rows } = props;

  // Bulk-notify dialog state — shared across promised + pass-expiry kinds.
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkItems, setBulkItems] = React.useState<BulkNotifyItem[]>([]);

  function openBulkNotify(selectedRows: CohortStudentRow[]) {
    const items: BulkNotifyItem[] = [];
    for (const r of selectedRows) {
      for (const slot of r.toFollowSlots ?? []) {
        items.push({
          enroleeNumber: r.enroleeNumber,
          studentName: r.enroleeFullName ?? r.enroleeNumber,
          slotKey: slot.key,
          slotLabel: slot.label,
        });
      }
    }
    setBulkItems(items);
    setBulkOpen(true);
  }

  if (kind === 'stp') {
    const stpRows = rows as CohortStudentRow[];
    return (
      <DataTable<CohortStudentRow>
        data={stpRows}
        columns={buildStpColumns(scope, ayCode)}
        getRowId={(r) => r.enroleeNumber}
        searchKeys={['enroleeFullName', 'enroleeNumber', 'studentNumber']}
        searchPlaceholder="Search students…"
        facets={STP_FACETS}
        statusTabs={STP_STATUS_TABS}
        pageSize={25}
        csv={{ filename: `stp-cohort-${ayCode}.csv` }}
        url={{ enabled: true, namespace: 'cohort' }}
        emptyState={STP_EMPTY_STATE}
        emptyFilteredState={{ title: 'No matches for current filters.' }}
      />
    );
  }

  if (kind === 'promised') {
    const promisedRows = rows as CohortStudentRow[];
    return (
      <>
        <DataTable<CohortStudentRow>
          data={promisedRows}
          columns={buildPromisedColumns(ayCode, openBulkNotify)}
          getRowId={(r) => r.enroleeNumber}
          searchKeys={['enroleeFullName', 'enroleeNumber', 'studentNumber']}
          searchPlaceholder="Search students…"
          facets={PROMISED_FACETS}
          statusTabs={PROMISED_STATUS_TABS}
          pageSize={25}
          csv={{ filename: `promised-cohort-${ayCode}.csv` }}
          url={{ enabled: true, namespace: 'cohort' }}
          initialSort={[{ id: 'daysUntil', desc: false }]}
          emptyState={PROMISED_EMPTY_STATE}
          emptyFilteredState={{ title: 'No matches for current filters.' }}
          selection={{
            enabled: true,
            bulkActions: [
              {
                key: 'notify',
                label: 'Send reminders',
                icon: Mail,
                onTrigger: (selectedRows) => openBulkNotify(selectedRows),
              },
            ],
          }}
        />
        <BulkNotifyDialog
          items={bulkItems}
          module="admissions"
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          onSuccess={() => setBulkItems([])}
        />
      </>
    );
  }

  if (kind === 'pass-expiry') {
    const passRows = rows as CohortStudentRow[];
    return (
      <DataTable<CohortStudentRow>
        data={passRows}
        columns={buildPassExpiryColumns(scope, ayCode)}
        getRowId={(r) => r.enroleeNumber}
        searchKeys={['enroleeFullName', 'enroleeNumber', 'studentNumber']}
        searchPlaceholder="Search students…"
        facets={PASS_EXPIRY_FACETS}
        statusTabs={PASS_EXPIRY_STATUS_TABS}
        pageSize={25}
        csv={{ filename: `pass-expiry-cohort-${ayCode}.csv` }}
        url={{ enabled: true, namespace: 'cohort' }}
        initialSort={[{ id: 'daysUntil', desc: false }]}
        emptyState={PASS_EXPIRY_EMPTY_STATE}
        emptyFilteredState={{ title: 'No matches for current filters.' }}
      />
    );
  }

  if (kind === 'pre-course') {
    const preCourseRows = rows as CohortStudentRow[];
    return (
      <DataTable<CohortStudentRow>
        data={preCourseRows}
        columns={buildPreCourseColumns(ayCode, scope)}
        getRowId={(r) => r.enroleeNumber}
        searchKeys={['enroleeFullName', 'enroleeNumber', 'studentNumber']}
        searchPlaceholder="Search students…"
        facets={PRE_COURSE_FACETS}
        statusTabs={PRE_COURSE_STATUS_TABS}
        pageSize={25}
        csv={{ filename: `pre-course-cohort-${ayCode}.csv` }}
        url={{ enabled: true, namespace: 'cohort' }}
        emptyState={PRE_COURSE_EMPTY_STATE}
        emptyFilteredState={{ title: 'No matches for current filters.' }}
      />
    );
  }

  // kind === 'medical' — no bulk actions
  const medicalRows = rows as CohortStudentRow[];
  return (
    <DataTable<CohortStudentRow>
      data={medicalRows}
      columns={buildMedicalColumns(scope, ayCode)}
      getRowId={(r) => r.enroleeNumber}
      searchKeys={['enroleeFullName', 'enroleeNumber', 'studentNumber']}
      searchPlaceholder="Search students…"
      facets={MEDICAL_FACETS}
      statusTabs={MEDICAL_STATUS_TABS}
      pageSize={25}
      csv={{ filename: `medical-cohort-${ayCode}.csv` }}
      url={{ enabled: true, namespace: 'cohort' }}
      emptyState={MEDICAL_EMPTY_STATE}
      emptyFilteredState={{ title: 'No matches for current filters.' }}
    />
  );
}
