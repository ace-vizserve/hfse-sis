'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { UserMinus } from 'lucide-react';

import { AddHouseMembersSheet } from '@/components/house-points/add-house-members-sheet';
import { AwardTallyBadges } from '@/components/house-points/award-tally-badges';
import { EventTypePill } from '@/components/house-points/event-type-pill';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  awardSummary,
  type HouseEventLine,
  type HouseMember,
  type HouseStudentLine,
} from '@/lib/house-points/house-breakdown';
import type { RosterStudent } from '@/lib/house-points/queries';
import { matchesAny } from '@/lib/house-points/sheet-filters';
import {
  EVENT_TYPE_SHORT_LABELS,
  formatEventDate,
  formatPoints,
} from '@/lib/house-points/standings';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import type { HouseRow } from '@/lib/sis/houses';

// The three tables on /records/house-points/houses/[code] — where one house's
// points came from, by event and by student, and who is in it — shown one at
// a time in a single tabbed card (`HouseBreakdownTabs`, bottom of the file).
// Rows are computed server-side (lib/house-points/house-breakdown.ts); these
// only present them.

const NO_AWARD = 'No award';

function pointsColumn<T extends { points: number }>(): ColumnDef<T, unknown> {
  return {
    id: 'points',
    accessorFn: (r) => r.points,
    header: ({ column }) => (
      <div className="flex justify-end">
        <SortableHeader column={column} align="right">
          Points
        </SortableHeader>
      </div>
    ),
    meta: { label: 'Points' },
    cell: ({ row }) => (
      <div className="text-right font-semibold tabular-nums text-foreground">
        {formatPoints(row.original.points)}
      </div>
    ),
    enableSorting: true,
  };
}

// ── By event ────────────────────────────────────────────────────────────────

const EVENT_COLUMNS: ColumnDef<HouseEventLine, unknown>[] = [
  {
    id: 'event',
    accessorFn: (r) => r.name,
    header: ({ column }) => (
      <SortableHeader column={column}>Event</SortableHeader>
    ),
    meta: { label: 'Event' },
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <IdentifierLink
          href={`/records/house-points/${encodeURIComponent(row.original.id)}`}
        >
          {row.original.name}
        </IdentifierLink>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {row.original.heldOn
            ? formatEventDate(row.original.heldOn)
            : 'No date'}
        </div>
      </div>
    ),
    enableSorting: true,
    enableHiding: false,
  },
  {
    id: 'type',
    accessorFn: (r) => EVENT_TYPE_SHORT_LABELS[r.eventType],
    header: ({ column }) => (
      <SortableHeader column={column}>Type</SortableHeader>
    ),
    meta: { label: 'Type' },
    cell: ({ row }) => <EventTypePill type={row.original.eventType} />,
    enableSorting: true,
  },
  {
    id: 'awards',
    accessorFn: (r) => awardSummary(r.awards),
    header: 'Awards won',
    meta: { label: 'Awards won' },
    cell: ({ row }) => <AwardTallyBadges awards={row.original.awards} />,
    enableSorting: false,
  },
  pointsColumn<HouseEventLine>(),
];

export function HouseEventsTable({
  events,
  houseName,
  fileStem,
}: {
  events: HouseEventLine[];
  houseName: string;
  fileStem: string;
}) {
  return (
    <DataTable<HouseEventLine>
      data={events}
      columns={EVENT_COLUMNS}
      getRowId={(row) => row.id}
      searchKeys={[(r) => r.name]}
      searchPlaceholder="Search events"
      url={{ enabled: true, namespace: 'house-events' }}
      initialSort={[{ id: 'points', desc: true }]}
      pageSize={25}
      csv={{ filename: `${fileStem}-events.csv` }}
      emptyState={{
        title: 'No events yet',
        body: `${houseName} has not been entered in any event this year.`,
      }}
      emptyFilteredState={{
        title: 'No events match.',
        body: 'Clear the search to see every event.',
      }}
    />
  );
}

// ── Members ─────────────────────────────────────────────────────────────────

function studentCell(r: { name: string; studentNumber: string }) {
  return (
    <div className="space-y-0.5">
      <IdentifierLink
        href={`/records/students/${encodeURIComponent(r.studentNumber)}`}
      >
        {r.name}
      </IdentifierLink>
    </div>
  );
}

const MEMBER_COLUMNS: ColumnDef<HouseMember, unknown>[] = [
  {
    id: 'student',
    accessorFn: (r) => r.name,
    header: ({ column }) => (
      <SortableHeader column={column}>Student</SortableHeader>
    ),
    meta: { label: 'Student' },
    cell: ({ row }) => studentCell(row.original),
    enableSorting: true,
    enableHiding: false,
  },
  {
    id: 'class',
    accessorFn: (r) => r.sectionName,
    header: ({ column }) => (
      <SortableHeader column={column}>Class</SortableHeader>
    ),
    meta: { label: 'Class' },
    cell: ({ row }) => (
      <span className="text-sm text-foreground">
        {row.original.sectionName}
      </span>
    ),
    enableSorting: true,
    filterFn: (row, _id, value) =>
      matchesAny(value, [row.original.sectionName]),
  },
  {
    id: 'studentNumber',
    accessorFn: (r) => r.studentNumber,
    header: ({ column }) => (
      <SortableHeader column={column}>Student number</SortableHeader>
    ),
    meta: { label: 'Student number' },
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {row.original.studentNumber}
      </span>
    ),
    enableSorting: true,
  },
];

/** What the Members tab needs to add and remove members — writers only. */
export type HouseMembersManage = {
  houseCode: string;
  /** The year's ENROLLED roster, for the add picker. */
  roster: RosterStudent[];
  houses: HouseRow[];
};

export function HouseMembersTable({
  members,
  houseName,
  ayCode,
  fileStem,
  manage = null,
}: {
  members: HouseMember[];
  houseName: string;
  ayCode: string;
  fileStem: string;
  /** Present for ENROLMENT_PLACEMENT_WRITERS; null shows the table read-only. */
  manage?: HouseMembersManage | null;
}) {
  const [removing, setRemoving] = React.useState<HouseMember | null>(null);
  const [removeBusy, setRemoveBusy] = React.useState(false);
  const run = useWriteAction();

  const columns = React.useMemo<ColumnDef<HouseMember, unknown>[]>(() => {
    if (!manage) return MEMBER_COLUMNS;
    return [
      ...MEMBER_COLUMNS,
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { label: 'Actions', excludeFromExport: true },
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${row.original.name} from ${houseName}`}
              title="Remove from house"
              onClick={() => setRemoving(row.original)}
            >
              <UserMinus className="size-4" />
            </Button>
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
      },
    ];
  }, [manage, houseName]);

  const memberStudentIds = React.useMemo(
    () => members.map((m) => m.studentId),
    [members]
  );

  async function confirmRemove() {
    if (!removing || !manage) return;
    const who = removing.name;
    setRemoveBusy(true);
    await run(
      () =>
        apiFetch<{ ok: true }>(
          `/api/sis/houses/${encodeURIComponent(manage.houseCode)}/members`,
          jsonInit('DELETE', {
            ayCode,
            sectionStudentId: removing.sectionStudentId,
          })
        ),
      {
        pending: 'Removing…',
        success: `Removed ${who} from ${houseName}`,
        onResolved: () => setRemoving(null),
      }
    );
    setRemoveBusy(false);
  }

  const facets = React.useMemo(() => {
    const collator = new Intl.Collator('en', { numeric: true });
    return [
      {
        columnId: 'class',
        label: 'Class',
        valueOptions: Array.from(
          new Set(members.map((m) => m.sectionName))
        ).sort(collator.compare),
      },
    ];
  }, [members]);

  return (
    <>
      <DataTable<HouseMember>
        data={members}
        columns={columns}
        getRowId={(row) => row.studentId}
        searchKeys={[(r) => r.name, (r) => r.studentNumber]}
        searchPlaceholder="Search members"
        facets={facets}
        url={{ enabled: true, namespace: 'house-members' }}
        initialSort={[{ id: 'class', desc: false }]}
        pageSize={25}
        csv={{ filename: `${fileStem}-members.csv` }}
        toolbarTrailing={
          manage ? (
            <AddHouseMembersSheet
              houseCode={manage.houseCode}
              houseName={houseName}
              ayCode={ayCode}
              roster={manage.roster}
              houses={manage.houses}
              memberStudentIds={memberStudentIds}
            />
          ) : undefined
        }
        emptyState={{
          title: 'No members yet',
          body: manage
            ? `No student enrolled in ${ayCode} is in ${houseName}. Choose Add students to ${houseName} to put some in.`
            : `No student enrolled in ${ayCode} is in ${houseName}. A student's house is set on their record.`,
        }}
        emptyFilteredState={{
          title: 'No members match.',
          body: 'Clear the search or a filter to see every member.',
        }}
      />

      {/* On the page canvas, not inside a drawer, so the confirm is not
          nested in anything. */}
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !removeBusy) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removing?.name ?? 'this student'} from {houseName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will have no house until someone puts them in one, and the
              house points they have earned leave {houseName} with them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={removeBusy}
              onClick={() => setRemoving(null)}
            >
              Keep them
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={removeBusy}
              loadingText="Removing…"
              onClick={confirmRemove}
            >
              Remove from house
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── By student ──────────────────────────────────────────────────────────────

function awardKeys(r: HouseStudentLine): string[] {
  return r.awards.length > 0 ? r.awards.map((a) => a.label) : [NO_AWARD];
}

const STUDENT_COLUMNS: ColumnDef<HouseStudentLine, unknown>[] = [
  {
    id: 'student',
    accessorFn: (r) => r.name,
    header: ({ column }) => (
      <SortableHeader column={column}>Student</SortableHeader>
    ),
    meta: { label: 'Student' },
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <IdentifierLink
          href={`/records/students/${encodeURIComponent(row.original.studentNumber)}`}
        >
          {row.original.name}
        </IdentifierLink>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {row.original.studentNumber}
        </div>
      </div>
    ),
    enableSorting: true,
    enableHiding: false,
  },
  {
    id: 'class',
    accessorFn: (r) => r.sectionName,
    header: ({ column }) => (
      <SortableHeader column={column}>Class</SortableHeader>
    ),
    meta: { label: 'Class' },
    cell: ({ row }) => (
      <span className="text-sm text-foreground">
        {row.original.sectionName}
      </span>
    ),
    enableSorting: true,
    filterFn: (row, _id, value) =>
      matchesAny(value, [row.original.sectionName]),
  },
  {
    id: 'events',
    accessorFn: (r) => r.eventCount,
    header: ({ column }) => (
      <div className="flex justify-end">
        <SortableHeader column={column} align="right">
          Events
        </SortableHeader>
      </div>
    ),
    meta: { label: 'Events' },
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-foreground">
        {row.original.eventCount.toLocaleString('en-SG')}
      </div>
    ),
    enableSorting: true,
  },
  {
    id: 'awards',
    accessorFn: (r) => awardSummary(r.awards),
    header: 'Awards',
    meta: { label: 'Awards' },
    cell: ({ row }) => <AwardTallyBadges awards={row.original.awards} />,
    enableSorting: false,
    filterFn: (row, _id, value) => matchesAny(value, awardKeys(row.original)),
  },
  pointsColumn<HouseStudentLine>(),
];

export function HouseStudentsTable({
  students,
  houseName,
  fileStem,
}: {
  students: HouseStudentLine[];
  houseName: string;
  fileStem: string;
}) {
  const facets = React.useMemo(() => {
    const collator = new Intl.Collator('en', { numeric: true });
    const classes = Array.from(
      new Set(students.map((s) => s.sectionName))
    ).sort(collator.compare);
    const awards = Array.from(new Set(students.flatMap(awardKeys))).sort(
      (a, b) =>
        a === NO_AWARD ? 1 : b === NO_AWARD ? -1 : collator.compare(a, b)
    );
    return [
      { columnId: 'class', label: 'Class', valueOptions: classes },
      { columnId: 'awards', label: 'Award', valueOptions: awards },
    ];
  }, [students]);

  return (
    <DataTable<HouseStudentLine>
      data={students}
      columns={STUDENT_COLUMNS}
      getRowId={(row) => row.studentId}
      searchKeys={[(r) => r.name, (r) => r.studentNumber]}
      searchPlaceholder="Search students"
      facets={facets}
      url={{ enabled: true, namespace: 'house-students' }}
      initialSort={[{ id: 'points', desc: true }]}
      pageSize={25}
      csv={{ filename: `${fileStem}-students.csv` }}
      emptyState={{
        title: 'No students yet',
        body: `Students appear here once one from ${houseName} is entered in an event.`,
      }}
      emptyFilteredState={{
        title: 'No students match.',
        body: 'Clear the search or a filter to see more students.',
      }}
    />
  );
}

// ── The tabbed card ─────────────────────────────────────────────────────────

type BreakdownTab = 'events' | 'students' | 'members';

function TabCount({ value }: { value: number }) {
  // Same count chip as DataTable's own status tabs.
  return (
    <span className="rounded-sm bg-muted px-1 font-mono text-[10px] tabular-nums text-muted-foreground">
      {value.toLocaleString('en-SG')}
    </span>
  );
}

/**
 * By event / By student / Members in ONE card, one table at a time (Mr Ace,
 * 2026-09-29: "those 3 tables can be shown via tabs"). Each table keeps its
 * own search, filters and CSV; By event is open first.
 */
export function HouseBreakdownTabs({
  events,
  students,
  members,
  houseName,
  ayCode,
  fileStem,
  totalLabel,
  manage = null,
}: {
  events: HouseEventLine[];
  students: HouseStudentLine[];
  members: HouseMember[];
  houseName: string;
  ayCode: string;
  fileStem: string;
  /** The house total as printed, for the team-result note under By student. */
  totalLabel: string;
  /** Member add/remove — passed only for ENROLMENT_PLACEMENT_WRITERS. */
  manage?: HouseMembersManage | null;
}) {
  const [tab, setTab] = React.useState<BreakdownTab>('events');

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          The detail
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {houseName}, row by row
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as BreakdownTab)}
          className="gap-4"
        >
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="events" className="gap-1.5">
              By event
              <TabCount value={events.length} />
            </TabsTrigger>
            <TabsTrigger value="students" className="gap-1.5">
              By student
              <TabCount value={students.length} />
            </TabsTrigger>
            <TabsTrigger value="members" className="gap-1.5">
              Members
              <TabCount value={members.length} />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              What {houseName} won at each event, and the points it brought.
            </p>
            <HouseEventsTable
              events={events}
              houseName={houseName}
              fileStem={fileStem}
            />
          </TabsContent>

          <TabsContent value="students" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Every {houseName} student entered in an event this year. A team
              result shows under each of its members, but the house total counts
              it once, so these points can add up to more than {totalLabel}.
            </p>
            <HouseStudentsTable
              students={students}
              houseName={houseName}
              fileStem={fileStem}
            />
          </TabsContent>

          <TabsContent value="members" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Every student enrolled in {ayCode} whose house is {houseName}.
            </p>
            <HouseMembersTable
              members={members}
              houseName={houseName}
              ayCode={ayCode}
              fileStem={fileStem}
              manage={manage}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
