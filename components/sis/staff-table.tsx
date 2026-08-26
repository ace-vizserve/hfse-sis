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
  assignmentSummaryText,
  RoleChip,
  StaffAvatar,
} from '@/components/sis/staff-visuals';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { StatusTabConfig } from '@/components/ui/data-table/types';
import { Switch } from '@/components/ui/switch';
import {
  ASSIGNMENT_ROLE_LABELS,
  ASSIGNMENT_ROLE_VALUES,
} from '@/lib/schemas/teacher-assignment';
import { LEVEL_CODES } from '@/lib/sis/levels';
import type { StaffRow } from '@/lib/sis/staff';

// A teacher is not one level, one subject or one role — they are a set of each.
// Every facet below therefore matches with `some`, never equality: the shared
// shell's default faceted matching assumes one value per row, which would find
// a P4 adviser under "P4" and lose them the moment they also teach a Sec 3
// subject.

/** Every level this teacher appears in, from both role families. */
function levelsOf(r: StaffRow): string[] {
  return [
    ...new Set([
      ...r.adviserSections.map((a) => a.levelCode),
      ...r.subjectAssignments.map((s) => s.levelCode),
    ]),
  ].filter(Boolean);
}

/** Every subject they teach, by code. Advisory carries no subject. */
function subjectsOf(r: StaffRow): string[] {
  return [...new Set(r.subjectAssignments.map((s) => s.subjectCode))].filter(
    Boolean
  );
}

/**
 * Every role they hold, in words.
 *
 * Worth filtering on now that a class can be shared: "who are my co-teachers"
 * had no answer anywhere in the app, and it is exactly the list somebody needs
 * when a shared subject's marks look wrong.
 */
function rolesOf(r: StaffRow): string[] {
  return [
    ...new Set([
      ...r.adviserSections.map((a) => ASSIGNMENT_ROLE_LABELS[a.role]),
      ...r.subjectAssignments.map((s) => ASSIGNMENT_ROLE_LABELS[s.role]),
    ]),
  ];
}

const COVER_COVERED = 'Away, covered by someone';
const COVER_COVERING = 'Standing in for someone';

/**
 * Cover, from both ends.
 *
 * `loadStaffAssignments` has always counted these two and nothing has ever
 * rendered them. They answer "who is short-handed" and "who is carrying extra",
 * which is the question a staffing page gets asked in the week somebody is ill.
 *
 * ⚠ Cover is a fact about TODAY. A closed year's rows are whatever cover
 * happened to be left set when it ended, so the facet is offered only when some
 * row actually has one — in most years that means it never appears.
 */
function coverOf(r: StaffRow): string[] {
  const tags: string[] = [];
  if (r.coveredCount > 0) tags.push(COVER_COVERED);
  if (r.coveringCount > 0) tags.push(COVER_COVERING);
  return tags;
}

/** One filter shape for all four — see the note above on `some` vs equality. */
function someOf(pick: (r: StaffRow) => string[]) {
  return (row: { original: StaffRow }, _id: string, value: string[]) => {
    if (!value || value.length === 0) return true;
    const mine = pick(row.original);
    return value.some((v) => mine.includes(v));
  };
}

export function StaffTable({
  rows,
  ayCode,
  viewOnly = false,
}: {
  rows: StaffRow[];
  /**
   * A finished year is a record, not a worksheet.
   *
   * Hides the controls rather than disabling them: a disabled Edit button in a
   * historical view invites the reader to work out why, and the answer is not
   * something a tooltip should have to carry. The "View only" badge in the page
   * header is what says it once, in words.
   */
  viewOnly?: boolean;
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

  // Carry the year through to the teacher's own page, or clicking a row while
  // looking at AY2025 lands you in the current year with no sign it moved.
  //
  // Always, not just when `viewOnly` — a FUTURE year is editable and therefore
  // not view-only, but it is still not the current year, so keying this off
  // viewOnly would drop the year on exactly the surface used to staff it.
  // The teacher page validates the code and falls back to the current year.
  const teacherQuery = `?ay=${ayCode}`;

  // Every option list is drawn from the rows on screen, so a filter never
  // offers a value that would return nothing. An empty list drops its facet
  // entirely rather than rendering a dropdown with nothing in it.
  //
  // Level keeps SCHOOL order rather than alphabetical — S1 sorting above P6
  // reads as a bug to anyone scanning it. The rest are alphabetical except
  // roles, which keep their declared order so "Form class adviser" leads and
  // its co role sits directly beneath it.
  const levelOptions = LEVEL_CODES.filter((code) =>
    rows.some((r) => levelsOf(r).includes(code))
  );
  const subjectOptions = [...new Set(rows.flatMap(subjectsOf))].sort((a, b) =>
    a.localeCompare(b)
  );
  const roleOptions = ASSIGNMENT_ROLE_VALUES.map(
    (r) => ASSIGNMENT_ROLE_LABELS[r]
  ).filter((label) => rows.some((r) => rolesOf(r).includes(label)));
  const coverOptions = [COVER_COVERED, COVER_COVERING].filter((tag) =>
    rows.some((r) => coverOf(r).includes(tag))
  );

  const facets = [
    { columnId: 'levels', label: 'Level', valueOptions: levelOptions },
    { columnId: 'subjects', label: 'Subject', valueOptions: subjectOptions },
    { columnId: 'roles', label: 'Role', valueOptions: roleOptions },
    { columnId: 'cover', label: 'Cover', valueOptions: coverOptions },
  ].filter((f) => f.valueOptions.length > 0);

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
      // Merged adviser-sections + subject-assignments into one chip-set column
      // (Task V3 — the mockup's single "assign" area). Both source fields
      // stay on StaffRow unchanged; statusTabs predicates below still read
      // row.original.adviserSections / .subjectAssignments directly,
      // unaffected by this column's presentation.
      id: 'assignments',
      // An accessorFn as well as a cell: without it this column exports blank
      // (the cell is a React node and `resolveColumnValue` has nothing to
      // read), which is the one column anybody exporting this table wants.
      accessorFn: (r) =>
        assignmentSummaryText(r.adviserSections, r.subjectAssignments),
      header: 'Assignments',
      meta: { label: 'Assignments' },
      enableSorting: false,
      cell: ({ row }) => (
        <AssignmentChips
          adviserSections={row.original.adviserSections}
          subjectAssignments={row.original.subjectAssignments}
          align="start"
        />
      ),
    },
    // Four hidden columns whose only job is to give a facet something to filter
    // through. Hidden rather than absent so each can still be switched on from
    // the Columns menu and carried into an export.
    {
      id: 'levels',
      accessorFn: (r) => levelsOf(r).join(', '),
      header: 'Levels',
      meta: { label: 'Levels' },
      enableSorting: false,
      filterFn: someOf(levelsOf),
    },
    {
      id: 'subjects',
      accessorFn: (r) => subjectsOf(r).join(', '),
      header: 'Subjects',
      meta: { label: 'Subjects' },
      enableSorting: false,
      filterFn: someOf(subjectsOf),
    },
    {
      id: 'roles',
      accessorFn: (r) => rolesOf(r).join(', '),
      header: 'Roles',
      meta: { label: 'Roles' },
      enableSorting: false,
      filterFn: someOf(rolesOf),
    },
    {
      id: 'cover',
      accessorFn: (r) => coverOf(r).join(', '),
      header: 'Cover',
      meta: { label: 'Cover' },
      enableSorting: false,
      filterFn: someOf(coverOf),
    },
    {
      id: 'load',
      // accessorFn lets TanStack sort numerically by total assignment count.
      accessorFn: (r) => r.adviserSections.length + r.subjectAssignments.length,
      header: ({ column }) => (
        <SortableHeader column={column}>Load</SortableHeader>
      ),
      meta: { label: 'Load' },
      cell: ({ row }) => {
        // Counts both role families. A teacher may advise more than one class
        // (the unique index is one adviser per SECTION, not one section per
        // person), so this is a count rather than a yes/no.
        const f = row.original.adviserSections.length;
        const fca = f > 0 ? `${f} form class${f === 1 ? '' : 'es'}` : null;
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
          {/* Gone, not greyed, in a closed year — the "View only" badge in the
              page header says why once, and a disabled button beside it would
              just make the reader hunt for the reason a second time. */}
          {!viewOnly && (
            <Button
              variant="ghost"
              size="sm"
              disabled={row.original.disabled}
              onClick={() => openSheet(row.original)}
              aria-label={`Edit assignments for ${row.original.name}`}
            >
              Edit
            </Button>
          )}
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
              <Link
                href={`/sis/admin/staff/${row.original.userId}${teacherQuery}`}
              >
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
      // "Advisers", not "Form Adviser" — a co-adviser advises a form class too,
      // and filing them under "Unassigned" (which is where the old
      // adviser-or-nothing predicate would have put them) would be plainly
      // wrong. Which of the two prints on the report card is a different
      // question, answered by the chip's CO marker.
      label: 'Advisers',
      predicate: (r) => r.adviserSections.length > 0,
      countOverride: (r) =>
        r.filter((row) => !row.disabled && row.adviserSections.length > 0)
          .length,
    },
    {
      value: 'subject-only',
      label: 'Subject Only',
      predicate: (r) =>
        r.adviserSections.length === 0 && r.subjectAssignments.length > 0,
      countOverride: (r) =>
        r.filter(
          (row) =>
            !row.disabled &&
            row.adviserSections.length === 0 &&
            row.subjectAssignments.length > 0
        ).length,
    },
    {
      value: 'unassigned',
      label: 'Unassigned',
      predicate: (r) =>
        r.adviserSections.length === 0 && r.subjectAssignments.length === 0,
      countOverride: (r) =>
        r.filter(
          (row) =>
            !row.disabled &&
            row.adviserSections.length === 0 &&
            row.subjectAssignments.length === 0
        ).length,
    },
  ];

  // A real switch, not a pill that renames itself.
  //
  // The label stays "Show disabled" in both states: a BUTTON is named for what
  // pressing it does, so "Hide disabled" was right for one; a SWITCH is named
  // for what it controls, and the knob carries on/off. Renaming it would make
  // the on state read "Hide disabled — on", which says the opposite of what is
  // happening. `Switch` is also the design system's answer for a binary that
  // takes effect immediately (09-design-system.md §4.1).
  const showDisabledToggle = (
    <label className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
      <Switch
        checked={showDisabled}
        onCheckedChange={setShowDisabled}
        aria-label="Show disabled accounts"
      />
      Show disabled
    </label>
  );

  return (
    <>
      <DataTable<StaffRow>
        csv={{ filename: `teaching-assignments-${ayCode}` }}
        facets={facets}
        initialColumnVisibility={{
          levels: false,
          subjects: false,
          roles: false,
          cover: false,
        }}
        data={data}
        columns={columns}
        getRowId={(r) => r.userId}
        searchKeys={['name', 'email']}
        searchPlaceholder="Search by name or email…"
        statusTabs={statusTabs}
        toolbarFilters={showDisabledToggle}
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
