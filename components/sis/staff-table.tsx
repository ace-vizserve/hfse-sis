'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

import {
  StaffAssignmentSheet,
  type StaffSheetTeacher,
} from '@/components/sis/staff-assignment-sheet';
import { Badge } from '@/components/ui/badge';
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
      cell: ({ row }) => (
        <div>
          <p
            className={
              row.original.disabled
                ? 'text-sm text-muted-foreground line-through'
                : 'text-sm font-medium text-foreground'
            }
          >
            {row.original.name}
          </p>
          <p className="text-xs text-muted-foreground">{row.original.email}</p>
        </div>
      ),
    },
    {
      id: 'fcaSection',
      header: 'FCA Section',
      cell: ({ row }) => {
        const fca = row.original.fcaSection;
        if (!fca)
          return <span className="text-sm text-muted-foreground">—</span>;
        return <Badge variant="secondary">{fca.name}</Badge>;
      },
    },
    {
      id: 'subjectAssignments',
      header: 'Subjects Taught',
      cell: ({ row }) => {
        const subs = row.original.subjectAssignments;
        if (subs.length === 0)
          return <span className="text-sm text-muted-foreground">—</span>;
        const visible = subs.slice(0, 3);
        const extra = subs.length - 3;
        return (
          <div className="flex flex-wrap gap-1">
            {visible.map((a) => (
              <span
                key={a.assignmentId}
                className="inline-flex items-center rounded-md border border-hairline bg-muted px-2 py-0.5 font-mono text-[11px]"
              >
                {a.subjectCode}&thinsp;·&thinsp;{a.sectionName}
              </span>
            ))}
            {extra > 0 && (
              <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                +{extra} more
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'load',
      // accessorFn lets TanStack sort numerically by total assignment count.
      accessorFn: (r) => (r.fcaSection ? 1 : 0) + r.subjectAssignments.length,
      header: ({ column }) => (
        <SortableHeader column={column}>Load</SortableHeader>
      ),
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
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={row.original.disabled}
          onClick={() => openSheet(row.original)}
          aria-label={`Edit assignments for ${row.original.name}`}
        >
          <ChevronRight className="size-4" />
        </Button>
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
          body: 'Add staff accounts via Users.',
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
