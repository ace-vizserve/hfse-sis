'use client';

import { useState } from 'react';
import {
  CalendarRange,
  FilePlus2,
  RefreshCw,
  Trash2,
  UserCheck,
} from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { AyAcceptingApplicationsToggle } from '@/components/sis/ay-accepting-applications-toggle';
import { AyDeleteDialog } from '@/components/sis/ay-delete-dialog';
import { AySwitchActiveDialog } from '@/components/sis/ay-switch-active-dialog';
import { GenerateSheetsDialog } from '@/components/sis/generate-sheets-dialog';
import { CopyTeacherAssignmentsDialog } from '@/components/sis/copy-teacher-assignments-dialog';
import { TermDatesEditor } from '@/components/sis/term-dates-editor';
import { Button } from '@/components/ui/button';
import { DataTable, RowActionsMenu } from '@/components/ui/data-table';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { StatusBadge } from '@/components/ui/status-badge';
import { TABLE_COPY } from '@/lib/copy/data-table';
import type { AcademicYearListItem, TermRow } from '@/lib/sis/ay-setup/queries';

// ─── Row type (enriched with extra context for cell rendering) ────────────────

export type AyTableRow = AcademicYearListItem & {
  termsData: TermRow[];
  blockers: string[];
  activeAyCode: string | null;
  otherAys: Array<{ ayCode: string; label: string }>;
  role: 'school_admin' | 'superadmin';
};

// ─── Derive "status" string for facet filtering ───────────────────────────────

function ayStatus(row: AyTableRow): string {
  if (row.is_current) return 'Active';
  if (row.accepting_applications && !row.is_current) return 'Early-bird open';
  return 'Inactive';
}

// ─── Column definitions ───────────────────────────────────────────────────────

const columns: ColumnDef<AyTableRow>[] = [
  {
    id: 'ay_code',
    accessorKey: 'ay_code',
    header: 'AY code',
    cell: ({ row }) => (
      <span className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
        {row.original.ay_code}
      </span>
    ),
    enableHiding: false,
  },
  {
    id: 'label',
    accessorKey: 'label',
    header: 'Label',
    cell: ({ row }) => <span className="text-sm">{row.original.label}</span>,
  },
  {
    id: 'status',
    accessorFn: (row) => ayStatus(row),
    header: 'Status',
    cell: ({ row }) => {
      const ay = row.original;
      return (
        <div className="flex flex-col gap-1">
          {ay.is_current ? (
            <StatusBadge tone="healthy">Active</StatusBadge>
          ) : (
            <StatusBadge tone="muted">Inactive</StatusBadge>
          )}
          {ay.accepting_applications && !ay.is_current && (
            <StatusBadge tone="info">Early-bird open</StatusBadge>
          )}
        </div>
      );
    },
    filterFn: (row, _id, value: string[]) => {
      if (!value || value.length === 0) return true;
      return value.includes(ayStatus(row.original));
    },
  },
  {
    id: 'terms',
    accessorFn: (row) => row.counts.terms,
    header: 'Terms',
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums text-right block">
        {row.original.counts.terms}
      </span>
    ),
  },
  {
    id: 'sections',
    accessorFn: (row) => row.counts.sections,
    header: 'Sections',
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums text-right block">
        {row.original.counts.sections}
      </span>
    ),
  },
  {
    id: 'subject_configs',
    accessorFn: (row) => row.counts.subject_configs,
    header: 'Subject configs',
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums text-right block">
        {row.original.counts.subject_configs}
      </span>
    ),
  },
  {
    id: 'section_students',
    accessorFn: (row) => row.counts.section_students,
    header: 'Students rostered',
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums text-right block">
        {row.original.counts.section_students}
      </span>
    ),
  },
  {
    id: 'created_at',
    accessorKey: 'created_at',
    header: 'Created',
    cell: ({ row }) => (
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {new Date(row.original.created_at).toLocaleDateString('en-SG', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })}
      </span>
    ),
    enableSorting: true,
  },
  {
    id: 'actions',
    header: 'Actions',
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => <AyRowActions row={row.original} />,
  },
];

// ─── Per-row actions (client, dialog-heavy) ───────────────────────────────────

function AyRowActions({ row }: { row: AyTableRow }) {
  const terms = row.termsData;
  const termsWithDates = terms.filter((t) => t.start_date && t.end_date).length;
  const termsTotal = terms.length;
  const datesStatus =
    termsTotal === 0 ? 'No terms' : `${termsWithDates}/${termsTotal} set`;
  const datesIncomplete = termsTotal > 0 && termsWithDates < termsTotal;

  // Pain-point: a fully-populated row used to show up to 6 controls.
  // Now: keep high-signal items inline (Dates chip carries status,
  // Switch is a state toggle), collapse the rare/configurational
  // actions into a single ⋯ More dropdown. Dialogs are rendered
  // separately and orchestrated via controlled `open` state so the
  // dropdown can close cleanly without unmounting the open dialog.
  const [openDialog, setOpenDialog] = useState<
    null | 'copy' | 'generate' | 'switch' | 'delete'
  >(null);

  const canCopy = row.otherAys.length > 0;
  const canGenerate = row.counts.subject_configs > 0 && row.counts.sections > 0;
  const canSwitch = !row.is_current;
  const canDelete = row.role === 'superadmin';
  const hasMoreActions = canCopy || canGenerate || canSwitch || canDelete;

  return (
    <div className="flex items-center justify-end gap-2">
      {/* Inline: Dates editor with at-a-glance status */}
      <TermDatesEditor ayCode={row.ay_code} ayLabel={row.label} terms={terms}>
        <Button
          size="sm"
          variant={datesIncomplete ? 'warning' : 'outline'}
          title={
            datesIncomplete
              ? `Term dates: ${datesStatus}`
              : `Term dates (${datesStatus})`
          }
        >
          <CalendarRange />
          Dates
          <span className="ml-1 font-mono text-[10px] tabular-nums opacity-80">
            {datesStatus}
          </span>
        </Button>
      </TermDatesEditor>

      {/* Inline: current-AY application toggle only. Early-bird selection for
          upcoming AYs now lives in Admissions (/admissions/upcoming/applications). */}
      {row.is_current && (
        <AyAcceptingApplicationsToggle
          ayCode={row.ay_code}
          current={row.accepting_applications}
          isCurrentAy={row.is_current}
        />
      )}

      {/* Dropdown: rare / scope-changing / destructive actions */}
      {hasMoreActions && (
        <RowActionsMenu>
          {canCopy && (
            <DropdownMenuItem onSelect={() => setOpenDialog('copy')}>
              <UserCheck className="size-4" />
              {TABLE_COPY.copyTeacherAssignments}
            </DropdownMenuItem>
          )}
          {canGenerate && (
            <DropdownMenuItem onSelect={() => setOpenDialog('generate')}>
              <FilePlus2 className="size-4" />
              {TABLE_COPY.createGradingSheets}
            </DropdownMenuItem>
          )}
          {canSwitch && (
            <>
              {(canCopy || canGenerate) && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => setOpenDialog('switch')}>
                <RefreshCw className="size-4" />
                {TABLE_COPY.setAsCurrentAy}
              </DropdownMenuItem>
            </>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setOpenDialog('delete')}
                className="text-destructive focus:text-destructive"
                title={
                  row.blockers.length > 0
                    ? `Cannot delete: ${row.blockers.join(', ')}`
                    : undefined
                }
              >
                <Trash2 className="size-4" />
                Delete AY
              </DropdownMenuItem>
            </>
          )}
        </RowActionsMenu>
      )}

      {/* Controlled dialogs — rendered outside the dropdown so they survive
          the menu's close-on-select. Each dialog is mounted only when its
          slot is active, which avoids needless React subtree churn. */}
      {canCopy && (
        <CopyTeacherAssignmentsDialog
          targetAyCode={row.ay_code}
          sourceOptions={row.otherAys}
          open={openDialog === 'copy'}
          onOpenChange={(o) => setOpenDialog(o ? 'copy' : null)}
        />
      )}
      {canGenerate && (
        <GenerateSheetsDialog
          scope={{ kind: 'ay', ayId: row.id, ayCode: row.ay_code }}
          open={openDialog === 'generate'}
          onOpenChange={(o) => setOpenDialog(o ? 'generate' : null)}
        />
      )}
      {canSwitch && (
        <AySwitchActiveDialog
          targetAyCode={row.ay_code}
          currentAyCode={row.activeAyCode}
          open={openDialog === 'switch'}
          onOpenChange={(o) => setOpenDialog(o ? 'switch' : null)}
        />
      )}
      {canDelete && (
        <AyDeleteDialog
          ayCode={row.ay_code}
          blockers={row.blockers}
          open={openDialog === 'delete'}
          onOpenChange={(o) => setOpenDialog(o ? 'delete' : null)}
        />
      )}
    </div>
  );
}

// ─── Main exported client component ──────────────────────────────────────────

type AySetupDataTableProps = {
  rows: AyTableRow[];
  onNewAy?: () => void;
};

export function AySetupDataTable({ rows, onNewAy }: AySetupDataTableProps) {
  return (
    <DataTable<AyTableRow>
      data={rows}
      columns={columns}
      getRowId={(row) => row.ay_code}
      facets={[
        {
          columnId: 'status',
          label: 'Status',
          valueOptions: ['Active', 'Inactive', 'Early-bird open'],
        },
      ]}
      initialSort={[{ id: 'ay_code', desc: true }]}
      initialColumnVisibility={{ created_at: false }}
      hidePagination
      emptyState={{
        title: 'No academic years yet.',
        body: 'Create the first AY to get started.',
        cta: onNewAy ? { label: 'New AY', onClick: onNewAy } : undefined,
      }}
      emptyFilteredState={{
        title: 'No AYs match.',
        body: 'Try clearing filters.',
      }}
    />
  );
}
