'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { FileText } from 'lucide-react';
import * as React from 'react';

import { DisciplineTypeChip } from '@/components/discipline/record-type-chip';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { formatRecordDate, formatRecordWhen } from '@/lib/discipline/display';
import type { DisciplineRecordRow } from '@/lib/discipline/queries';
import { toPlainText } from '@/lib/rich-text';
import { DISCIPLINE_RECORD_TYPE_LABELS } from '@/lib/schemas/discipline';

// The school-wide disciplinary register (#7). Every incident and letter filed
// in one academic year, newest first.
//
// WHY "SLIP BACK" IS A COLUMN AND A FILTER. The school's warning letter ends
// with a tear-off receipt due back in two days, so a letter is not finished
// when it is sent. Storing `acknowledged_on` answered that per record; this
// makes "which letters are still outstanding" two clicks instead of a scan,
// which is the only reason a register beats reading the audit log.
//
// The system still decides nothing. There is no chasing, no reminder and no
// escalation here — it lists what staff filed, and lets them sort it.

/** Returned / Not yet / — . A derived column so it can be filtered on. */
const SLIP_RETURNED = 'Returned';
const SLIP_WAITING = 'Not yet';
const SLIP_NA = 'Not applicable';

function slipStatus(row: DisciplineRecordRow): string {
  if (row.recordType !== 'letter') return SLIP_NA;
  return row.acknowledgedOn ? SLIP_RETURNED : SLIP_WAITING;
}

/**
 * Array-aware, because the facet dropdown hands back a list of checked values.
 * Every faceted column needs its own — the shell does not supply one.
 */
function facetFilter(
  row: { getValue: (id: string) => unknown },
  id: string,
  value: unknown
): boolean {
  if (!value || (Array.isArray(value) && value.length === 0)) return true;
  return Array.isArray(value)
    ? value.includes(row.getValue(id))
    : row.getValue(id) === value;
}

export function DisciplineTable({
  records,
  ayCode,
}: {
  records: DisciplineRecordRow[];
  ayCode: string;
}) {
  // ⚠ FLATTENED ONCE, HERE. Three things read `nature` — the cell, the
  // accessor (which is what sorts and what the CSV writes) and the search key
  // — and every one of them runs per row per render. Stripping in the data
  // instead of in any of the three keeps them agreeing with each other for
  // free: a search that matched `<strong>` and a CSV full of tags were the
  // same defect wearing different clothes.
  //
  // Nothing on this page writes a record back, so flattening in place is safe
  // here. `student-discipline-panel` and `student-discipline-tab` share this
  // row type and DO render the markup — they get the untouched rows.
  const rows = React.useMemo(
    () => records.map((r) => ({ ...r, nature: toPlainText(r.nature) })),
    [records]
  );

  const columns = React.useMemo<ColumnDef<DisciplineRecordRow, unknown>[]>(
    () => [
      {
        id: 'date',
        accessorFn: (r) => r.occurredOn,
        header: ({ column }) => (
          <SortableHeader column={column}>Date</SortableHeader>
        ),
        meta: { label: 'Date' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
            {formatRecordWhen(
              row.original.occurredOn,
              row.original.occurredAtTime
            )}
          </span>
        ),
        enableHiding: false,
      },
      {
        id: 'student',
        accessorFn: (r) => r.studentName ?? '',
        header: ({ column }) => (
          <SortableHeader column={column}>Student</SortableHeader>
        ),
        meta: { label: 'Student' },
        // Straight to their record, already on the right tab — the detail view
        // for one filing is the student's own page, not a second screen.
        cell: ({ row }) =>
          row.original.studentNumber ? (
            <IdentifierLink
              href={`/records/students/${encodeURIComponent(row.original.studentNumber)}?tab=discipline`}
            >
              {row.original.studentName ?? row.original.studentNumber}
            </IdentifierLink>
          ) : (
            <span className="text-muted-foreground">
              {row.original.studentName ?? '—'}
            </span>
          ),
        enableHiding: false,
      },
      {
        id: 'class',
        accessorFn: (r) => r.className ?? '',
        header: 'Class',
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {row.original.className ?? '—'}
          </span>
        ),
        filterFn: facetFilter,
      },
      {
        id: 'type',
        // The LABEL, not the enum — this value is what the facet lists and what
        // the CSV prints, and "letter" would read as neither.
        accessorFn: (r) => DISCIPLINE_RECORD_TYPE_LABELS[r.recordType],
        header: 'Type',
        cell: ({ row }) => (
          <DisciplineTypeChip type={row.original.recordType} />
        ),
        filterFn: facetFilter,
      },
      {
        id: 'nature',
        // STRIPPED, AND THE ROW ARRIVES ALREADY STRIPPED (see `rows` below).
        // `nature` is written in the formatting editor, so the column holds
        // HTML. This is the school-wide register — one row per incident, 25
        // to a page — and it is scanned, not read: the full record with its
        // formatting intact is one click away on the student's panel. A `<ul>`
        // in this cell would set the height of the whole row.
        accessorFn: (r) => r.nature,
        header: 'What kind',
        cell: ({ row }) => row.original.nature,
      },
      {
        id: 'slip',
        accessorFn: (r) => slipStatus(r),
        header: 'Slip back',
        cell: ({ row }) => {
          const status = slipStatus(row.original);
          if (status === SLIP_NA) {
            return <span className="text-ink-5">—</span>;
          }
          if (status === SLIP_RETURNED) {
            return (
              <span className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                {formatRecordDate(row.original.acknowledgedOn)}
              </span>
            );
          }
          // Informational, not destructive. Nobody has asked to chase these,
          // and red would sound an alarm the school never rang.
          return (
            <span className="whitespace-nowrap font-mono text-xs font-semibold text-brand-indigo-deep">
              {SLIP_WAITING}
            </span>
          );
        },
        filterFn: facetFilter,
      },
      {
        id: 'filedBy',
        accessorFn: (r) => r.filedByName,
        header: 'Filed by',
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{row.original.filedByName}</span>
        ),
      },
    ],
    []
  );

  return (
    <DataTable<DisciplineRecordRow>
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      searchKeys={[
        (r) => r.studentName ?? '',
        (r) => r.studentNumber ?? '',
        (r) => r.nature,
        (r) => r.filedByName,
      ]}
      searchPlaceholder="Search by student, kind, or who filed it"
      facets={[
        { columnId: 'type', label: 'Type' },
        { columnId: 'slip', label: 'Slip back' },
        { columnId: 'class', label: 'Class' },
      ]}
      url={{ enabled: true, namespace: 'discipline' }}
      initialSort={[{ id: 'date', desc: true }]}
      pageSize={25}
      csv={{ filename: `discipline-${ayCode}.csv` }}
      emptyState={{
        icon: FileText,
        title: 'Nothing filed this year.',
        body: 'Incidents and letters appear here as staff file them, from the student panel on a class list.',
      }}
      emptyFilteredState={{
        title: 'No records match.',
        body: 'Try a different type, clear the search, or check another year.',
      }}
    />
  );
}
