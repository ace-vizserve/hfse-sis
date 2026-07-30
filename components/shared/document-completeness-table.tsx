'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Mail, Search } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { IdentifierLink } from '@/components/ui/identifier-link';
import {
  DocumentCompletenessStrip,
  DocumentStatusLegend,
} from '@/components/shared/document-completeness-strip';
import {
  STATUS_CHIP,
  chipClassForStatus,
  isOutstanding,
} from '@/components/shared/document-status-visuals';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  BulkNotifyDialog,
  type BulkNotifyItem,
} from '@/components/p-files/bulk-notify-dialog';
import type { AdmissionsCompleteness } from '@/lib/admissions/dashboard';
import type { StudentCompleteness } from '@/lib/p-files/queries';
import {
  DOCUMENT_SLOTS,
  type DocumentStatus,
} from '@/lib/p-files/document-config';
import { TABLE_COPY } from '@/lib/copy/data-table';

// ─── Module discriminator ─────────────────────────────────────────────────────

type Module = 'p-files' | 'admissions';

// ─── Status filter types ──────────────────────────────────────────────────────

/** Admissions chase: 4 actionable statuses + 'all'. */
export type AdmissionsStatusFilter =
  | 'all'
  | 'to-follow'
  | 'rejected'
  | 'uploaded'
  | 'expired';
/** P-Files renewal: only 'expired' + 'all'. */
export type PFilesStatusFilter = 'all' | 'expired';

// ─── Outstanding-document chips ───────────────────────────────────────────────
// The exceptions, named in words. This is the column the officer actually
// works from: on a chase surface the outstanding documents ARE the job, so
// they get the widest column and plain names rather than a colour to decode.
//
// Three fit comfortably on one line; the rest collapse into a count, with the
// full list one click away in the strip's popover (and in the row title).

const MAX_VISIBLE_CHIPS = 3;

function OutstandingChips({ slots }: { slots: CommonRow['slots'] }) {
  const open = slots.filter((s) => isOutstanding(s.status));

  if (open.length === 0) {
    return (
      <Badge
        variant="outline"
        className="h-5.5 gap-1 border-brand-mint/60 bg-brand-mint/15 px-2 text-[11px] font-medium text-ink"
      >
        <Check className="size-3" />
        All on file
      </Badge>
    );
  }

  const shown = open.slice(0, MAX_VISIBLE_CHIPS);
  const rest = open.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((slot) => {
        const { label, icon: Icon } = STATUS_CHIP[slot.status];
        return (
          <Badge
            key={slot.key}
            variant="outline"
            // Icon + tint, never tint alone — `expired` and `rejected` share
            // a colour on purpose (identical next action) and are told apart
            // by the icon and the tooltip.
            title={`${slot.label} — ${label}`}
            className={`h-5.5 gap-1 px-2 text-[11px] font-medium ${chipClassForStatus(
              slot.status
            )}`}
          >
            <Icon className="size-3 shrink-0" />
            {slot.label}
          </Badge>
        );
      })}
      {rest > 0 && (
        <Badge
          variant="outline"
          className="h-5.5 border-hairline-strong px-2 font-mono text-[10px] text-muted-foreground"
          title={open
            .slice(MAX_VISIBLE_CHIPS)
            .map((s) => `${s.label} — ${STATUS_CHIP[s.status].label}`)
            .join('\n')}
        >
          +{rest}
        </Badge>
      )}
    </div>
  );
}

// ─── Completeness helpers ─────────────────────────────────────────────────────

function pct(total: number, complete: number): number {
  return total > 0 ? Math.round((complete / total) * 100) : 0;
}

function outstandingSummary(slots: CommonRow['slots']): string {
  const open = slots.filter((s) => isOutstanding(s.status));
  if (open.length === 0) return 'All on file';
  return open
    .map((s) => `${s.label} (${STATUS_CHIP[s.status].label.toLowerCase()})`)
    .join('; ');
}

// ─── BulkNotifyItem builders (module-specific) ────────────────────────────────

function admissionsBulkTargets(
  student: AdmissionsCompleteness
): BulkNotifyItem[] {
  const slotMeta = new Map(DOCUMENT_SLOTS.map((s) => [s.key, s]));
  const out: BulkNotifyItem[] = [];
  for (const slot of student.slots) {
    if (
      slot.status === 'to-follow' ||
      slot.status === 'rejected' ||
      slot.status === 'uploaded' ||
      slot.status === 'expired'
    ) {
      out.push({
        enroleeNumber: student.enroleeNumber,
        studentName: student.fullName,
        slotKey: slot.key,
        slotLabel: slotMeta.get(slot.key)?.label ?? slot.label,
      });
    }
  }
  return out;
}

function pfilesBulkTargets(
  student: StudentCompleteness,
  windowDays: number | null
): BulkNotifyItem[] {
  const slotMeta = new Map(DOCUMENT_SLOTS.map((s) => [s.key, s]));
  const todayMs = Date.now();
  const horizonMs = windowDays ? todayMs + windowDays * 86_400_000 : null;
  const out: BulkNotifyItem[] = [];
  for (const slot of student.slots) {
    if (slot.status === 'expired') {
      out.push({
        enroleeNumber: student.enroleeNumber,
        studentName: student.fullName,
        slotKey: slot.key,
        slotLabel: slotMeta.get(slot.key)?.label ?? slot.label,
      });
      continue;
    }
    if (horizonMs !== null && slot.status === 'valid' && slot.expiryDate) {
      const t = new Date(slot.expiryDate).getTime();
      if (t >= todayMs && t <= horizonMs) {
        out.push({
          enroleeNumber: student.enroleeNumber,
          studentName: student.fullName,
          slotKey: slot.key,
          slotLabel: slotMeta.get(slot.key)?.label ?? slot.label,
        });
      }
    }
  }
  return out;
}

// ─── Common row base (fields shared by both row types) ───────────────────────

type CommonRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  level: string | null;
  total: number;
  complete: number;
  expired: number;
  toFollow?: number;
  rejected?: number;
  uploaded?: number;
  slots: {
    key: string;
    label: string;
    status: DocumentStatus;
    expiryDate: string | null;
  }[];
};

// ─── Module-discriminated overloads ──────────────────────────────────────────

type AdmissionsProps = {
  module: 'admissions';
  students: AdmissionsCompleteness[];
  ayCode?: string;
  initialStatusFilter?: AdmissionsStatusFilter;
  bulkRemindEnabled?: boolean;
  bulkRemindWindowDays?: never;
};

type PFilesProps = {
  module: 'p-files';
  students: StudentCompleteness[];
  ayCode?: string;
  initialStatusFilter?: PFilesStatusFilter;
  bulkRemindEnabled?: boolean;
  bulkRemindWindowDays?: number;
};

type Props = AdmissionsProps | PFilesProps;

// ─── facetFilterFn (verbatim copy from SisSectionsDataTable / EvaluationSectionsList /
//     markbook/sections-data-table.tsx — exact-membership match for multi-select
//     facets. Without this, TanStack's default 'auto' filterFn falls back to
//     includesString, which stringifies the selected-values array and does a
//     substring match — single-select works by coincidence, multi-select silently
//     returns zero rows.) ─────────────────────────────────────────────────────────

function facetFilterFn(
  row: { getValue: (id: string) => unknown },
  id: string,
  value: unknown
) {
  if (!value || (Array.isArray(value) && value.length === 0)) return true;
  return Array.isArray(value)
    ? value.includes(row.getValue(id))
    : row.getValue(id) === value;
}

// ─── Row-selection checkbox column ────────────────────────────────────────────
// Prepended to buildColumns()'s output only when bulk-remind is enabled for
// this table (mirrors the pre-migration hand-rolled checkbox column + the
// grading-data-table.tsx SELECT_COLUMN reference pattern, KD #131). Select-all
// operates on the current page only.

const SELECT_COLUMN: ColumnDef<CommonRow> = {
  id: 'select',
  header: ({ table }) => {
    const pageRows = table.getRowModel().rows;
    const selectedCount = pageRows.filter((r) => r.getIsSelected()).length;
    const allSelected =
      pageRows.length > 0 && selectedCount === pageRows.length;
    const someSelected = selectedCount > 0 && !allSelected;
    return (
      <Checkbox
        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
        onCheckedChange={(value) => {
          for (const r of pageRows) r.toggleSelected(!!value);
        }}
        disabled={pageRows.length === 0}
        aria-label="Select all on this page"
      />
    );
  },
  cell: ({ row }) => (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={(value) => row.toggleSelected(!!value)}
      aria-label={`Select ${row.original.fullName}`}
    />
  ),
  enableSorting: false,
  enableHiding: false,
};

// ─── Column definitions (module-discriminated) ────────────────────────────────

function buildColumns(
  module: Module,
  actionHref: (enroleeNumber: string) => string,
  bulkRemindEnabled: boolean,
  onRemindOne: (items: BulkNotifyItem[]) => void,
  bulkRemindWindowDays: number | null
): ColumnDef<CommonRow>[] {
  const identifierLabel = module === 'admissions' ? 'Applicant' : 'Student';

  const columns: ColumnDef<CommonRow>[] = [
    {
      id: 'name',
      accessorFn: (row) => row.fullName,
      header: ({ column }) => (
        <SortableHeader column={column}>{identifierLabel}</SortableHeader>
      ),
      meta: { label: identifierLabel },
      cell: ({ row }) => (
        // Fixed two-line cell, nothing wraps — the 13 slot columns used to
        // take the width first, leaving names to wrap onto three lines and
        // giving every row a different height.
        <div className="min-w-[13rem] max-w-[17rem]">
          <IdentifierLink
            href={actionHref(row.original.enroleeNumber)}
            className="block truncate text-sm"
          >
            {row.original.fullName}
          </IdentifierLink>
          <div className="font-mono text-[10px] text-muted-foreground">
            {row.original.studentNumber ?? row.original.enroleeNumber}
          </div>
        </div>
      ),
      enableHiding: false,
    },
    {
      id: 'level',
      accessorFn: (row) => row.level ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Level</SortableHeader>
      ),
      meta: { label: 'Level' },
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {row.original.level ?? '—'}
        </span>
      ),
      filterFn: facetFilterFn,
    },
    {
      id: 'status4',
      accessorFn: (row) =>
        module === 'admissions'
          ? ((row as AdmissionsCompleteness).applicationStatus ?? '')
          : ((row as StudentCompleteness).section ?? ''),
      header: ({ column }) => (
        <SortableHeader column={column}>
          {module === 'admissions' ? 'Status' : 'Section'}
        </SortableHeader>
      ),
      meta: { label: module === 'admissions' ? 'Status' : 'Section' },
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {module === 'admissions'
            ? ((row.original as AdmissionsCompleteness).applicationStatus ??
              '—')
            : ((row.original as StudentCompleteness).section ?? '—')}
        </span>
      ),
      filterFn: facetFilterFn,
    },
  ];

  // One strip in place of the 13 per-slot columns. Sorts on completeness, so
  // "worst first" is a single click on the header.
  columns.push({
    id: 'documents',
    accessorFn: (row) => pct(row.total, row.complete),
    header: ({ column }) => (
      <SortableHeader column={column}>Documents</SortableHeader>
    ),
    // The raw accessor is a bare number with no unit — the humanized
    // equivalents ship as `csv.extraColumns` instead.
    meta: { label: 'Documents', excludeFromExport: true },
    cell: ({ row }) => (
      <DocumentCompletenessStrip
        slots={row.original.slots}
        studentName={row.original.fullName}
      />
    ),
  });

  columns.push({
    id: 'outstanding',
    // Sort by how much is outstanding — the officer's natural worklist order.
    accessorFn: (row) =>
      row.slots.filter((s) => isOutstanding(s.status)).length,
    header: ({ column }) => (
      <SortableHeader column={column}>Outstanding</SortableHeader>
    ),
    meta: { label: 'Outstanding', excludeFromExport: true },
    cell: ({ row }) => <OutstandingChips slots={row.original.slots} />,
  });

  columns.push({
    id: 'actions',
    header: '',
    cell: ({ row }) => {
      const href = actionHref(row.original.enroleeNumber);
      const items = bulkRemindEnabled
        ? module === 'admissions'
          ? admissionsBulkTargets(row.original as AdmissionsCompleteness)
          : pfilesBulkTargets(
              row.original as StudentCompleteness,
              bulkRemindWindowDays
            )
        : [];
      return (
        <div className="inline-flex items-center justify-end gap-2">
          {bulkRemindEnabled && items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              aria-label={`Send reminder to ${row.original.fullName}`}
              onClick={() => onRemindOne(items)}
            >
              <Mail className="size-3" />
              Remind
            </Button>
          )}
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            View
            <ArrowUpRight className="size-3" />
          </Link>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  });

  return bulkRemindEnabled ? [SELECT_COLUMN, ...columns] : columns;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DocumentCompletenessTable(props: Props) {
  const { module, students, ayCode, bulkRemindEnabled = false } = props;
  const bulkRemindWindowDays =
    'bulkRemindWindowDays' in props
      ? (props.bulkRemindWindowDays ?? null)
      : null;

  const [bulkOpen, setBulkOpen] = React.useState(false);
  // Per-row "Send reminder" — opens BulkNotifyDialog seeded for a single row.
  const [perRowOpen, setPerRowOpen] = React.useState(false);
  const [perRowItems, setPerRowItems] = React.useState<BulkNotifyItem[]>([]);
  const [bulkItems, setBulkItems] = React.useState<BulkNotifyItem[]>([]);
  // Bumped after a successful bulk send to clear the shell's row selection
  // (and drop the bulk-action footer) — see DataTableProps.selectionResetSignal.
  const [selectionResetSignal, setSelectionResetSignal] = React.useState(0);

  const handleRemindOne = React.useCallback((items: BulkNotifyItem[]) => {
    setPerRowItems(items);
    setPerRowOpen(true);
  }, []);

  function handleSendReminders(selectedRows: CommonRow[]) {
    const out: BulkNotifyItem[] = [];
    for (const s of selectedRows) {
      if (module === 'admissions') {
        out.push(...admissionsBulkTargets(s as AdmissionsCompleteness));
      } else {
        out.push(
          ...pfilesBulkTargets(s as StudentCompleteness, bulkRemindWindowDays)
        );
      }
    }
    setBulkItems(out);
    setBulkOpen(true);
  }

  const querySuffix = ayCode ? `?ay=${encodeURIComponent(ayCode)}` : '';

  const levels = React.useMemo(
    () =>
      [
        ...new Set(
          students.map((s) => s.level).filter((l): l is string => !!l)
        ),
      ].sort(),
    [students]
  );

  // Section list is only relevant for P-Files
  const sections = React.useMemo(() => {
    if (module !== 'p-files') return [];
    return [
      ...new Set(
        (students as StudentCompleteness[])
          .map((s) => s.section)
          .filter((s): s is string => !!s)
      ),
    ].sort();
  }, [module, students]);

  const slotHeaders = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of students) {
      for (const slot of s.slots) {
        if (!seen.has(slot.key)) seen.set(slot.key, slot.label);
      }
    }
    return Array.from(seen.entries()).map(([key, label]) => ({ key, label }));
  }, [students]);

  // Module-specific strings
  const emptyLabel =
    module === 'admissions'
      ? 'No applicants match the current filters.'
      : 'No students match the current filters.';
  const countLabel = module === 'admissions' ? 'applicant' : 'student';
  const cardTitle =
    module === 'admissions'
      ? 'Applicant Document Completeness'
      : 'Document Completeness';
  const cardDescription =
    module === 'admissions'
      ? 'Pre-enrolment scope — Submitted / Ongoing Verification / Processing. Click a row to view the application.'
      : 'Per-student breakdown. Click a row to view details.';

  const actionHref = React.useCallback(
    (enroleeNumber: string): string =>
      module === 'admissions'
        ? `/admissions/applications/${enroleeNumber}${querySuffix}`
        : `/p-files/${enroleeNumber}${querySuffix}`,
    [module, querySuffix]
  );

  const columns = React.useMemo(
    () =>
      buildColumns(
        module,
        actionHref,
        bulkRemindEnabled,
        handleRemindOne,
        bulkRemindWindowDays
      ),
    [
      module,
      actionHref,
      bulkRemindEnabled,
      handleRemindOne,
      bulkRemindWindowDays,
    ]
  );

  // The per-slot detail leaves the SCREEN, not the export. Each slot ships as
  // an always-exported CSV field carrying the humanized status word (the old
  // slot columns exported the raw `DocumentStatus` enum), so a spreadsheet
  // keeps every column it had and reads better. `defaultChecked: true` means
  // "always exported" per KD #162.
  const csvExtraColumns = React.useMemo(
    () => [
      {
        id: 'documents-on-file',
        header: 'Documents on file',
        accessor: (row: CommonRow) => `${row.complete} of ${row.total}`,
        defaultChecked: true,
      },
      {
        id: 'documents-complete-pct',
        header: 'Documents complete %',
        accessor: (row: CommonRow) => pct(row.total, row.complete),
        defaultChecked: true,
      },
      {
        id: 'outstanding-documents',
        header: 'Outstanding documents',
        accessor: (row: CommonRow) => outstandingSummary(row.slots),
        defaultChecked: true,
      },
      ...slotHeaders.map((h) => ({
        id: `slot:${h.key}`,
        header: h.label,
        accessor: (row: CommonRow) => {
          const slot = row.slots.find((sl) => sl.key === h.key);
          return slot ? STATUS_CHIP[slot.status].label : '';
        },
        defaultChecked: true,
      })),
    ],
    [slotHeaders]
  );

  const statusOptions: { value: string; label: string }[] =
    module === 'admissions'
      ? [
          { value: 'to-follow', label: TABLE_COPY.awaitingParentReply },
          { value: 'rejected', label: TABLE_COPY.sentBackToParent },
          { value: 'uploaded', label: TABLE_COPY.awaitingValidation },
          { value: 'expired', label: TABLE_COPY.lapsedReupload },
        ]
      : [{ value: 'expired', label: TABLE_COPY.lapsedReupload }];

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle>{cardTitle}</CardTitle>
        <CardDescription>{cardDescription}</CardDescription>
      </CardHeader>
      {/* Always-visible key. The dot matrix this replaced had no legend
          anywhere on either page — colour was the only signal, explained
          solely by a hover tooltip. */}
      <DocumentStatusLegend />
      <CardContent className="px-0">
        <DataTable<CommonRow>
          data={students}
          columns={columns}
          getRowId={(row) => row.enroleeNumber}
          searchKeys={['fullName', 'studentNumber', 'enroleeNumber']}
          searchPlaceholder="Search by name or number…"
          facets={[
            { columnId: 'level', label: 'Level', valueOptions: levels },
            ...(module === 'p-files' && sections.length > 0
              ? [
                  {
                    columnId: 'status4',
                    label: 'Section',
                    valueOptions: sections,
                  },
                ]
              : []),
          ]}
          statusTabs={[
            {
              value: 'all',
              label: 'All',
              predicate: () => true,
              isDefault:
                props.initialStatusFilter === undefined ||
                props.initialStatusFilter === 'all',
            },
            ...statusOptions.map((opt) => ({
              value: opt.value,
              label: opt.label,
              predicate: (row: CommonRow) => {
                if (opt.value === 'expired') return row.expired > 0;
                if (module === 'admissions') {
                  const a = row as AdmissionsCompleteness;
                  if (opt.value === 'to-follow') return a.toFollow > 0;
                  if (opt.value === 'rejected') return a.rejected > 0;
                  if (opt.value === 'uploaded') return a.uploaded > 0;
                }
                return false;
              },
              isDefault: props.initialStatusFilter === opt.value,
            })),
          ]}
          csv={{
            filename: `${countLabel}-completeness.csv`,
            extraColumns: csvExtraColumns,
          }}
          url={{ enabled: true, namespace: 'completeness' }}
          initialSort={[{ id: 'name', desc: false }]}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyState={{ icon: Search, title: emptyLabel }}
          emptyFilteredState={{ title: emptyLabel }}
          selection={
            bulkRemindEnabled
              ? {
                  enabled: true,
                  bulkActions: [
                    {
                      key: 'send-reminders',
                      label: 'Send reminders',
                      icon: Mail,
                      onTrigger: handleSendReminders,
                    },
                  ],
                }
              : undefined
          }
          selectionResetSignal={selectionResetSignal}
        />
      </CardContent>
      {bulkRemindEnabled && (
        <>
          <BulkNotifyDialog
            items={bulkItems}
            module={module}
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            onSuccess={() => setSelectionResetSignal((n) => n + 1)}
          />
          <BulkNotifyDialog
            items={perRowItems}
            module={module}
            open={perRowOpen}
            onOpenChange={(open) => {
              setPerRowOpen(open);
              if (!open) setPerRowItems([]);
            }}
          />
        </>
      )}
    </Card>
  );
}
