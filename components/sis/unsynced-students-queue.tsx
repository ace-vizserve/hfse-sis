'use client';

import {
  ArrowUpRight,
  GraduationCap,
  TriangleAlert,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';

import { AssignSectionDialog } from '@/components/sis/assign-section-dialog';
import { BulkSectionPicker } from '@/components/sis/bulk-section-picker';
import { LateEnrolleePrompt } from '@/components/sis/late-enrollee-prompt';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { MidTermPayload } from '@/lib/sis/placement-completion';
import { useBulkAction } from '@/lib/hooks/use-bulk-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { ApplicationStatusBadge } from '@/components/ui/application-status-badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { type StatusTabConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import type {
  AssignableLevel,
  AssignableSection,
} from '@/lib/sis/class-assignment';
import type { ApplicationFit } from '@/lib/admissions/options';
import { compareLevelLabels } from '@/lib/sis/levels';
import { applicantMapKey, sectionMapKey } from '@/lib/sis/section-map-key';
import type {
  UnsyncedGapReason,
  UnsyncedStudentRow,
} from '@/lib/sis/unsynced-students';

// Per-level lookup result carried by `sectionsByLevel` — mirrors
// `listAssignableSections`'s return shape (Task 3.1) keyed by the raw
// `levelApplied` label exactly as it appears on the unsynced row.
export type AssignableLevelSections = {
  level: AssignableLevel | null;
  sections: AssignableSection[];
};

// ──────────────────────────────────────────────────────────────────────────
// Queue surface at /records/unsynced. Lists enrolled students whose
// admissions row hasn't crossed over into the grading schema yet — a
// per-row "what's wrong" + per-row CTA pattern, NOT a triage flow.
//
// Action per gap reason:
//   no_class_section  → "Assign section" opens <AssignSectionDialog> with
//                        the pre-fetched sections at the student's level.
//   not_synced        → Same "Assign section" entry point — re-running the
//                        per-row sync is what the dialog effectively does
//                        once the section is confirmed (the API route
//                        is idempotent for the already-assigned case).
//                        When the class filled in cannot be placed (row
//                        carries a `blocker`), the reason cell says why and
//                        the same button is how it gets fixed.
//   no_student_number → No action button (Directus must issue the number
//                        first); the registrar can still pivot via the
//                        "Open in admissions" link to see the apps row.
// ──────────────────────────────────────────────────────────────────────────

type Props = {
  rows: UnsyncedStudentRow[];
  /** Keyed by `sectionMapKey(ayCode, levelApplied)` — the queue spans more
   *  than one academic year, and a level's classes differ between them. */
  sectionsByLevel: Record<string, AssignableLevelSections>;
  /** Keyed by `applicantMapKey(ayCode, enroleeNumber)` — what each applicant
   *  asked for, so the picker can mark matching sections. */
  applicationFitByApplicant?: Record<string, ApplicationFit>;
};

const GAP_COPY: Record<UnsyncedGapReason, string> = {
  // Step 11 of the admission process hasn't happened yet — the normal state
  // between enrolling a student and Student Affairs placing them.
  no_class_section: 'Awaiting class assignment',
  no_student_number: 'No student number yet',
  not_synced: 'Not yet synced to grading',
};

const STATUS_TABS: StatusTabConfig<UnsyncedStudentRow>[] = [
  {
    value: 'all',
    label: 'All',
    predicate: () => true,
    isDefault: true,
  },
  {
    value: 'no_class_section',
    label: 'Awaiting class assignment',
    predicate: (r) => r.gapReason === 'no_class_section',
  },
  {
    value: 'no_student_number',
    label: 'No student number yet',
    predicate: (r) => r.gapReason === 'no_student_number',
  },
  {
    value: 'not_synced',
    label: 'Not yet synced to grading',
    predicate: (r) => r.gapReason === 'not_synced',
  },
];

function fullNameOf(row: UnsyncedStudentRow): string {
  if (row.enroleeFullName && row.enroleeFullName.trim().length > 0) {
    return row.enroleeFullName.trim();
  }
  const parts = [row.lastName, row.firstName, row.middleName].filter(Boolean);
  return parts.length ? parts.join(', ') : row.enroleeNumber;
}

export function UnsyncedStudentsQueue({
  rows,
  sectionsByLevel,
  applicationFitByApplicant = {},
}: Props) {
  const [dialogRow, setDialogRow] = React.useState<UnsyncedStudentRow | null>(
    null
  );

  // Bulk Assign section: the row's own POST (assign-section) once per ticked
  // student, with one class picked for all. A class belongs to one level in one
  // year, so the ticked students must share both.
  const bulk = useBulkAction();
  const [bulkRows, setBulkRows] = React.useState<UnsyncedStudentRow[] | null>(
    null
  );
  const [resetSignal, setResetSignal] = React.useState(0);
  const [late, setLate] = React.useState<Array<{
    payload: MidTermPayload;
    name: string;
  }> | null>(null);

  const bulkKeys = new Set(
    (bulkRows ?? []).map((r) => sectionMapKey(r.ayCode, r.levelApplied ?? ''))
  );
  const bulkLevel =
    bulkKeys.size === 1
      ? (sectionsByLevel[Array.from(bulkKeys)[0]] ?? null)
      : null;
  const bulkBlocked =
    bulkKeys.size > 1
      ? 'These students are at different levels or years, so no one class fits them all. Tick one level and year at a time.'
      : null;

  async function assignMany(sectionId: string) {
    const picked = bulkRows ?? [];
    const sectionName =
      bulkLevel?.sections.find((s) => s.id === sectionId)?.name ?? 'the class';
    setBulkRows(null);
    const joiningLate: Array<{ payload: MidTermPayload; name: string }> = [];
    await bulk(picked, {
      pending: `Assigning ${picked.length} ${picked.length === 1 ? 'student' : 'students'}…`,
      done: (n) => `${n} assigned to ${sectionName}`,
      failed: 'Could not assign',
      label: fullNameOf,
      one: async (r) => {
        const body = await apiFetch<{
          midTermEnrolment?: MidTermPayload | null;
        }>(
          `/api/sis/students/${encodeURIComponent(r.enroleeNumber)}/assign-section?ay=${encodeURIComponent(r.ayCode)}`,
          jsonInit('POST', { sectionId })
        );
        if (body?.midTermEnrolment?.sectionId) {
          joiningLate.push({
            payload: body.midTermEnrolment,
            name: fullNameOf(r),
          });
        }
      },
    });
    // Students joining after the year began get the same term-and-date step the
    // single dialog shows, asked once for all of them.
    if (joiningLate.length > 0) setLate(joiningLate);
    setResetSignal((s) => s + 1);
  }

  const columns = React.useMemo<ColumnDef<UnsyncedStudentRow>[]>(
    () => [
      {
        accessorKey: 'enroleeFullName',
        header: 'Student',
        cell: ({ row }) => {
          const name = fullNameOf(row.original);
          const studentNumber = row.original.studentNumber;
          return (
            <div className="space-y-0.5">
              {studentNumber ? (
                <IdentifierLink
                  href={`/records/students/${encodeURIComponent(studentNumber)}`}
                >
                  {name}
                </IdentifierLink>
              ) : (
                <span className="font-medium text-foreground">{name}</span>
              )}
              <div className="font-mono text-[10px] text-muted-foreground">
                {row.original.enroleeNumber}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'studentNumber',
        header: 'Student #',
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {row.original.studentNumber ?? '—'}
          </span>
        ),
      },
      {
        // Shows, facets and sorts on the RESOLVED level (`level`, computed by
        // the loader — "Year 10" reads as Secondary Three). The id stays
        // 'levelApplied' so a Level filter already in the URL keeps working.
        id: 'levelApplied',
        accessorFn: (r) => r.level ?? '',
        header: 'Level',
        cell: ({ row }) => {
          const raw = row.original.levelApplied?.trim();
          const level = row.original.level;
          return (
            <span
              title={raw && raw !== level ? `Applied as ${raw}` : undefined}
            >
              {level ?? '—'}
            </span>
          );
        },
        sortingFn: (a, b) =>
          compareLevelLabels(a.original.level, b.original.level),
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0))
            return true;
          return Array.isArray(value)
            ? value.includes(row.getValue(id))
            : row.getValue(id) === value;
        },
      },
      {
        // The queue spans the current AND upcoming year, so the year has to
        // be on the row — otherwise a registrar can't tell which intake
        // they're looking at, and next year's students look overdue.
        accessorKey: 'ayCode',
        header: 'Year',
        meta: { label: 'Academic year' },
        cell: ({ row }) => (
          <span className="font-mono text-xs uppercase tracking-wider tabular-nums text-muted-foreground">
            {row.original.ayCode}
          </span>
        ),
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0))
            return true;
          return Array.isArray(value)
            ? value.includes(row.getValue(id))
            : row.getValue(id) === value;
        },
      },
      {
        accessorKey: 'applicationStatus',
        header: 'Status',
        cell: ({ row }) => (
          <ApplicationStatusBadge status={row.original.applicationStatus} />
        ),
      },
      {
        accessorKey: 'gapReason',
        header: "What's missing",
        cell: ({ row }) => {
          // A class filled in outside the SIS that cannot be placed. "Not yet
          // synced" would read as "wait for tonight", and tonight fails the
          // same way — so say it is stuck, and why, in the admin's words.
          const blocker = row.original.blocker;
          if (blocker) {
            return (
              <div className="max-w-sm space-y-0.5">
                <div className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  Class can’t be placed
                </div>
                <p className="text-xs text-muted-foreground">{blocker}</p>
              </div>
            );
          }
          return (
            <span className="text-sm text-foreground">
              {GAP_COPY[row.original.gapReason]}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        enableHiding: false,
        cell: ({ row }) => {
          const canAssign =
            row.original.gapReason === 'no_class_section' ||
            row.original.gapReason === 'not_synced';
          return (
            <div className="flex items-center justify-end gap-2">
              {canAssign && (
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setDialogRow(row.original)}
                >
                  <GraduationCap className="size-3.5" />
                  Assign section
                </Button>
              )}
              <Button size="sm" variant="outline" asChild>
                <Link
                  href={`/admissions/applications/${encodeURIComponent(row.original.enroleeNumber)}?ay=${encodeURIComponent(row.original.ayCode)}`}
                >
                  Open in admissions
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          );
        },
      },
    ],
    []
  );

  const levelOptions = React.useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.level).filter((v): v is string => !!v))
      ).sort(compareLevelLabels),
    [rows]
  );

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(r) => applicantMapKey(r.ayCode, r.enroleeNumber)}
        searchKeys={[
          (r) => fullNameOf(r),
          (r) => r.enroleeNumber,
          (r) => r.studentNumber ?? '',
          // Both: the SIS level and the name the parent picked.
          (r) => r.level ?? '',
          (r) => r.levelApplied ?? '',
        ]}
        searchPlaceholder="Search by name, student number, or level…"
        statusTabs={STATUS_TABS}
        facets={[
          // School order (Youngstarters, P1…S4, then unmapped names), not A–Z.
          {
            columnId: 'levelApplied',
            label: 'Level',
            valueOptions: levelOptions,
          },
        ]}
        url={{ enabled: true, namespace: 'unsynced' }}
        selection={{
          enabled: true,
          enableRowSelection: (r) =>
            r.gapReason === 'no_class_section' || r.gapReason === 'not_synced',
          bulkActions: [
            {
              key: 'assign',
              label: 'Assign section',
              icon: GraduationCap,
              onTrigger: (picked) => setBulkRows(picked),
            },
          ],
        }}
        selectionResetSignal={resetSignal}
        initialSort={[{ id: 'enroleeFullName', desc: false }]}
        emptyState={{
          icon: UserX,
          title: 'Everyone is set up',
          body: 'No enrolled students are waiting for a class section. New gaps will appear here as admissions rows are added.',
        }}
        emptyFilteredState={{
          title: 'No matches',
          body: 'Try clearing the search.',
        }}
      />
      <BulkSectionPicker
        open={bulkRows !== null}
        onOpenChange={(o) => !o && setBulkRows(null)}
        title={`Assign ${bulkRows?.length ?? 0} ${bulkRows?.length === 1 ? 'student' : 'students'} to a class`}
        description={
          bulkLevel?.level?.label
            ? `Pick one class at ${bulkLevel.level.label}. Once assigned they join the roster, and their attendance starts.`
            : 'Pick one class. Once assigned they join the roster, and their attendance starts.'
        }
        confirmLabel="Assign section"
        options={(bulkLevel?.sections ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          isAtCapacity: s.isAtCapacity,
          note: `${s.activeCount} in class${s.chosenCount > 0 ? ` · ${s.chosenCount} waiting to enrol` : ''}`,
        }))}
        emptyText="There are no classes at this level yet. Create one under SIS Admin → Section setup, then come back."
        blocked={bulkBlocked}
        onConfirm={assignMany}
      />
      <Dialog open={late !== null} onOpenChange={(o) => !o && setLate(null)}>
        <DialogContent className="sm:max-w-md">
          {late && (
            <LateEnrolleePrompt
              payload={late[0].payload}
              others={
                late.length > 1
                  ? {
                      payloads: late.slice(1).map((l) => l.payload),
                      names: Object.fromEntries(
                        late.map((l) => [l.payload.sectionStudentId, l.name])
                      ),
                    }
                  : undefined
              }
              onDone={() => setLate(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      {dialogRow && (
        <AssignSectionDialog
          enroleeNumber={dialogRow.enroleeNumber}
          // The row's own year, not the page's — placing a student into next
          // year's intake must write to next year's tables.
          ayCode={dialogRow.ayCode}
          level={
            sectionsByLevel[
              sectionMapKey(dialogRow.ayCode, dialogRow.levelApplied ?? '')
            ]?.level ?? null
          }
          studentName={fullNameOf(dialogRow)}
          availableSections={
            sectionsByLevel[
              sectionMapKey(dialogRow.ayCode, dialogRow.levelApplied ?? '')
            ]?.sections ?? []
          }
          applicationFit={
            applicationFitByApplicant[
              applicantMapKey(dialogRow.ayCode, dialogRow.enroleeNumber)
            ] ?? null
          }
          open={true}
          onOpenChange={(open) => {
            if (!open) setDialogRow(null);
          }}
        />
      )}
    </>
  );
}
