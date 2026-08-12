'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import {
  StaffAssignmentSheet,
  type StaffSheetTeacher,
} from '@/components/sis/staff-assignment-sheet';
import {
  AssignmentChips,
  RoleChip,
  StaffAvatar,
} from '@/components/sis/staff-visuals';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { StatusTabConfig } from '@/components/ui/data-table/types';
import type { StaffRow } from '@/lib/sis/staff';

export function StaffTable({
  rows,
  ayCode,
}: {
  rows: StaffRow[];
  ayCode: string;
}) {
  const [showDisabled, setShowDisabled] = useState(false);
  const [selectedTeacher, setSelectedTeacher] =
    useState<StaffSheetTeacher | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function openSheet(row: StaffRow) {
    if (row.disabled) return;
    setSelectedTeacher({
      userId: row.userId,
      name: row.name,
      email: row.email,
    });
    setSheetOpen(true);
  }

  // Pre-filter data by the show-disabled toggle; status-tab counts always
  // re-apply !disabled over the (possibly disabled-inclusive) visible set so
  // they stay consistent with the old chipCounts behaviour.
  const data = showDisabled ? rows : rows.filter((r) => !r.disabled);

  const columns: ColumnDef<StaffRow>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <SortableHeader column={column}>Teacher</SortableHeader>
      ),
      meta: { label: 'Teacher' },
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <StaffAvatar name={row.original.name} className="opacity-90" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p
                className={
                  row.original.disabled
                    ? 'truncate text-sm text-muted-foreground line-through'
                    : 'truncate text-sm font-medium text-foreground'
                }
              >
                {row.original.name}
              </p>
              {/* Every row in this cut is role='teacher' by construction —
                  loadStaffAssignments only ever pulls from getTeacherList()
                  (lib/sis/staff.ts), which filters role === 'teacher'. */}
              <RoleChip role="teacher" />
            </div>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {row.original.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      // Merged FCA-section + subject-assignments into one chip-set column
      // (Task V3 — the mockup's single "assign" area). Both source fields
      // stay on StaffRow unchanged; statusTabs predicates below still read
      // row.original.fcaSection / .subjectAssignments directly, unaffected
      // by this column's presentation.
      id: 'assignments',
      header: 'Assignments',
      cell: ({ row }) => (
        <AssignmentChips
          fcaSection={row.original.fcaSection}
          subjectAssignments={row.original.subjectAssignments}
          align="start"
        />
      ),
    },
    {
      id: 'load',
      // accessorFn lets TanStack sort numerically by total assignment count.
      accessorFn: (r) => (r.fcaSection ? 1 : 0) + r.subjectAssignments.length,
      header: ({ column }) => (
        <SortableHeader column={column}>Load</SortableHeader>
      ),
      meta: { label: 'Load' },
      cell: ({ row }) => {
        const fca = row.original.fcaSection ? '1 FCA' : null;
        const n = row.original.subjectAssignments.length;
        const subs = n > 0 ? `${n} subject${n === 1 ? '' : 's'}` : null;
        const parts = [fca, subs].filter(Boolean).join(' + ');
        return (
          <span className="font-mono text-xs text-muted-foreground">
            {parts || 'No assignments'}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      enableHiding: false,
      // Two ways in, doing different jobs. "Edit" opens the drawer for a quick
      // change without losing your place in the table; the chevron opens the
      // teacher's own page, which has an address you can send to someone and
      // is where cover lives. Disabled accounts get neither — their row is
      // read-only until somebody re-enables them.
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={row.original.disabled}
            onClick={() => openSheet(row.original)}
            aria-label={`Edit assignments for ${row.original.name}`}
          >
            Edit
          </Button>
          <Button
            asChild={!row.original.disabled}
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={row.original.disabled}
            aria-label={`Open ${row.original.name}'s page`}
          >
            {row.original.disabled ? (
              <ChevronRight className="size-4" />
            ) : (
              <Link href={`/sis/admin/staff/${row.original.userId}`}>
                <ChevronRight className="size-4" />
              </Link>
            )}
          </Button>
        </div>
      ),
    },
  ];

  // countOverride always gates on !disabled regardless of whether showDisabled
  // is on — so the counts on the tabs reflect active-only, matching the old
  // chipCounts behaviour.
  const statusTabs: StatusTabConfig<StaffRow>[] = [
    {
      value: 'all',
      label: 'All',
      isDefault: true,
      predicate: () => true,
      countOverride: (r) => r.filter((row) => !row.disabled).length,
    },
    {
      value: 'adviser',
      label: 'Form Adviser',
      predicate: (r) => r.fcaSection !== null,
      countOverride: (r) =>
        r.filter((row) => !row.disabled && row.fcaSection !== null).length,
    },
    {
      value: 'subject-only',
      label: 'Subject Only',
      predicate: (r) =>
        r.fcaSection === null && r.subjectAssignments.length > 0,
      countOverride: (r) =>
        r.filter(
          (row) =>
            !row.disabled &&
            row.fcaSection === null &&
            row.subjectAssignments.length > 0
        ).length,
    },
    {
      value: 'unassigned',
      label: 'Unassigned',
      predicate: (r) =>
        r.fcaSection === null && r.subjectAssignments.length === 0,
      countOverride: (r) =>
        r.filter(
          (row) =>
            !row.disabled &&
            row.fcaSection === null &&
            row.subjectAssignments.length === 0
        ).length,
    },
  ];

  const showDisabledToggle = (
    <button
      type="button"
      onClick={() => setShowDisabled((v) => !v)}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-semibold transition-colors ${
        showDisabled
          ? 'border-brand-indigo/40 bg-gradient-to-b from-brand-indigo/15 to-brand-indigo/5 text-brand-indigo'
          : 'border-border bg-card text-muted-foreground hover:border-brand-indigo/40 hover:text-foreground'
      }`}
    >
      {showDisabled ? 'Hide disabled' : 'Show disabled'}
    </button>
  );

  return (
    <>
      <DataTable<StaffRow>
        data={data}
        columns={columns}
        getRowId={(r) => r.userId}
        searchKeys={['name', 'email']}
        searchPlaceholder="Search by name or email…"
        statusTabs={statusTabs}
        toolbarTrailing={showDisabledToggle}
        url={{ enabled: true, namespace: 'staff' }}
        hidePagination={rows.length <= 20}
        emptyState={{
          title: 'No teachers found',
          body: 'Add staff accounts from the Accounts tab.',
        }}
        emptyFilteredState={{
          title: 'No teachers match.',
          body: 'Try a different tab or clear the search.',
        }}
      />

      <StaffAssignmentSheet
        teacher={selectedTeacher}
        ayCode={ayCode}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  );
}
