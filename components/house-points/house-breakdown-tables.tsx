'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';

import { AwardTallyBadges } from '@/components/house-points/award-tally-badges';
import { EventTypePill } from '@/components/house-points/event-type-pill';
import { DataTable } from '@/components/ui/data-table';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  awardSummary,
  type HouseEventLine,
  type HouseMember,
  type HouseStudentLine,
} from '@/lib/house-points/house-breakdown';
import { matchesAny } from '@/lib/house-points/sheet-filters';
import {
  EVENT_TYPE_SHORT_LABELS,
  formatEventDate,
  formatPoints,
} from '@/lib/house-points/standings';

// The two tables on /records/house-points/houses/[code]: where one house's
// points came from, by event and by student. Rows are computed server-side
// (lib/house-points/house-breakdown.ts); these only present them.

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

export function HouseMembersTable({
  members,
  houseName,
  ayCode,
  fileStem,
}: {
  members: HouseMember[];
  houseName: string;
  ayCode: string;
  fileStem: string;
}) {
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
    <DataTable<HouseMember>
      data={members}
      columns={MEMBER_COLUMNS}
      getRowId={(row) => row.studentId}
      searchKeys={[(r) => r.name, (r) => r.studentNumber]}
      searchPlaceholder="Search members"
      facets={facets}
      url={{ enabled: true, namespace: 'house-members' }}
      initialSort={[{ id: 'class', desc: false }]}
      pageSize={25}
      csv={{ filename: `${fileStem}-members.csv` }}
      emptyState={{
        title: 'No members yet',
        body: `No student enrolled in ${ayCode} is in ${houseName}. A student's house is set on their record.`,
      }}
      emptyFilteredState={{
        title: 'No members match.',
        body: 'Clear the search or a filter to see every member.',
      }}
    />
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
