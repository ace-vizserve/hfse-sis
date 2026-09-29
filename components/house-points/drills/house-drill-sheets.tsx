'use client';

import type { ColumnDef } from '@tanstack/react-table';
import * as React from 'react';

import {
  DrillDownSheet,
  type DrillDownDensity,
} from '@/components/dashboard/drill-down-sheet';
import { AwardTallyBadges } from '@/components/house-points/award-tally-badges';
import { EventTypePill } from '@/components/house-points/event-type-pill';
import { placeBadgeClass } from '@/components/house-points/place-badge';
import { Badge } from '@/components/ui/badge';
import { IdentifierLink } from '@/components/ui/identifier-link';
import {
  ALL_ENTRY_COLUMNS,
  ENTRY_COLUMN_LABELS,
  defaultEntryColumns,
  entriesCsv,
  entryRowsFor,
  eventsCsv,
  houseEventsCsv,
  studentsCsv,
  type EntryColumnKey,
  type HouseEntryDrill,
  type HouseStandingEventRow,
} from '@/lib/house-points/drill';
import {
  awardSummary,
  type HouseEntryLine,
  type HouseEventLine,
  type HouseStudentLine,
} from '@/lib/house-points/house-breakdown';
import { ordinal } from '@/lib/house-points/defaults';
import { formatEventDate, formatPoints } from '@/lib/house-points/standings';

// The drill sheets on a house's page (/records/house-points/houses/[code]).
// Each renders the shared DrillDownSheet (components/dashboard/drill-down-sheet.tsx)
// inside the <Sheet> its trigger owns — a MetricCard's `drillSheet` slot or a
// chart card in ./chart-drill-cards.tsx — exactly as the Admissions and
// Attendance drills do. The rows are the page's own breakdown (no route), so
// the CSV is built in the browser from the rows and the columns left visible.

const MONO_SUB =
  'font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground';

/** An object URL for the sheet's Download CSV link, released when it changes. */
function useCsvHref(csv: string): string {
  const [href, setHref] = React.useState('');
  React.useEffect(() => {
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    );
    setHref(url);
    return () => URL.revokeObjectURL(url);
  }, [csv]);
  return href;
}

function eventHref(eventId: string): string {
  return `/records/house-points/${encodeURIComponent(eventId)}`;
}

function studentHref(studentNumber: string): string {
  return `/records/students/${encodeURIComponent(studentNumber)}`;
}

function dateLabel(heldOn: string | null): string {
  return heldOn ? formatEventDate(heldOn) : 'No date';
}

/** Undated events sort last. */
function dateSortValue(heldOn: string | null): string {
  return heldOn ?? '9999-12-31';
}

function PointsCell({ points }: { points: number }) {
  return (
    <span className="font-semibold tabular-nums text-foreground">
      {formatPoints(points)}
    </span>
  );
}

// ── Award entries ───────────────────────────────────────────────────────────

function EntrantCell({
  entry,
  houseName,
}: {
  entry: HouseEntryLine;
  houseName: string;
}) {
  if (entry.kind === 'house') {
    return (
      <div className="space-y-0.5">
        <span className="font-medium text-foreground">{houseName}</span>
        <div className={MONO_SUB}>Whole house</div>
      </div>
    );
  }
  if (entry.kind === 'team') {
    const own = entry.members.filter((m) => m.inHouse);
    const others = entry.members.length - own.length;
    return (
      <div className="space-y-1">
        <div className="space-y-0.5">
          <span className="font-medium text-foreground">
            {entry.entrant ?? 'Team'}
          </span>
          <div className={MONO_SUB}>
            Team · {entry.members.length}{' '}
            {entry.members.length === 1 ? 'member' : 'members'}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
          {own.map((m) => (
            <IdentifierLink
              key={m.studentId}
              href={studentHref(m.studentNumber)}
              className="font-normal"
            >
              {m.name}
            </IdentifierLink>
          ))}
          {others > 0 && (
            <span className="text-muted-foreground">
              + {others} from other {others === 1 ? 'house' : 'houses'}
            </span>
          )}
        </div>
      </div>
    );
  }
  return entry.studentNumber ? (
    <div className="space-y-0.5">
      <IdentifierLink href={studentHref(entry.studentNumber)}>
        {entry.entrant ?? 'Unknown student'}
      </IdentifierLink>
      <div className={MONO_SUB}>{entry.studentNumber}</div>
    </div>
  ) : (
    <span className="text-foreground">
      {entry.entrant ?? 'Unknown student'}
    </span>
  );
}

function entryColumn(
  key: EntryColumnKey,
  houseName: string
): ColumnDef<HouseEntryLine, unknown> {
  const header = ENTRY_COLUMN_LABELS[key];
  switch (key) {
    case 'event':
      return {
        id: 'event',
        accessorFn: (r) => r.eventName,
        header,
        cell: ({ row }) => (
          <IdentifierLink href={eventHref(row.original.eventId)}>
            {row.original.eventName}
          </IdentifierLink>
        ),
        enableSorting: true,
      };
    case 'date':
      return {
        id: 'date',
        accessorFn: (r) => dateSortValue(r.heldOn),
        header,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {dateLabel(row.original.heldOn)}
          </span>
        ),
        enableSorting: true,
        enableGlobalFilter: false,
      };
    case 'type':
      return {
        id: 'type',
        accessorFn: (r) => r.eventType,
        header,
        cell: ({ row }) => <EventTypePill type={row.original.eventType} />,
        enableSorting: true,
      };
    case 'entrant':
      return {
        id: 'entrant',
        accessorFn: (r) =>
          [
            r.kind === 'house' ? houseName : r.entrant,
            ...r.members.map((m) => m.name),
          ]
            .filter(Boolean)
            .join(' '),
        header,
        cell: ({ row }) => (
          <EntrantCell entry={row.original} houseName={houseName} />
        ),
        enableSorting: true,
      };
    case 'class':
      return {
        id: 'class',
        accessorFn: (r) => r.sectionName ?? '',
        header,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.sectionName ?? '—'}
          </span>
        ),
        enableSorting: true,
      };
    case 'award':
      return {
        id: 'award',
        accessorFn: (r) => r.award,
        header,
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className={placeBadgeClass({ rank: row.original.awardRank })}
          >
            {row.original.award}
          </Badge>
        ),
        enableSorting: true,
      };
    case 'points':
      return {
        id: 'points',
        accessorFn: (r) => r.points,
        header,
        cell: ({ row }) => <PointsCell points={row.original.points} />,
        enableSorting: true,
        enableGlobalFilter: false,
      };
  }
}

const ENTRY_COLUMN_OPTIONS = ALL_ENTRY_COLUMNS.map((k) => ({
  key: k,
  label: ENTRY_COLUMN_LABELS[k],
}));

export function HouseEntriesDrillSheet({
  drill,
  entries,
  houseName,
  eyebrow,
  title,
  description,
  csvFilename,
}: {
  drill: HouseEntryDrill;
  entries: HouseEntryLine[];
  houseName: string;
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  csvFilename: string;
}) {
  const [density, setDensity] = React.useState<DrillDownDensity>('comfortable');
  const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<
    EntryColumnKey[]
  >(() => defaultEntryColumns(drill));

  const rows = React.useMemo(
    () => entryRowsFor(entries, drill),
    [entries, drill]
  );
  const columns = React.useMemo(
    () => ALL_ENTRY_COLUMNS.map((k) => entryColumn(k, houseName)),
    [houseName]
  );
  const csvHref = useCsvHref(
    React.useMemo(
      () => entriesCsv(rows, visibleColumnKeys, houseName),
      [rows, visibleColumnKeys, houseName]
    )
  );

  // Say how a team is counted wherever one appears. On a student's drill the
  // point is the other way round: the student is credited the team's award
  // in full, while the house is credited it once.
  const hasTeam = rows.some((r) => r.kind === 'team');
  const teamNote = !hasTeam
    ? null
    : drill.target === 'student'
      ? `A team award counts in full for each member; ${houseName} is credited it once.`
      : `A team award is credited to ${houseName} once, however many of its members are in the house.`;

  return (
    <DrillDownSheet<HouseEntryLine>
      eyebrow={eyebrow}
      title={title}
      description={
        description || teamNote ? (
          <>
            {description}
            {description && teamNote ? ' ' : null}
            {teamNote}
          </>
        ) : undefined
      }
      count={rows.length}
      csvHref={csvHref}
      csvFilename={csvFilename}
      columns={columns}
      rows={rows}
      emptyMessage="No awards to show."
      density={density}
      onDensityChange={setDensity}
      columnOptions={ENTRY_COLUMN_OPTIONS}
      visibleColumnKeys={visibleColumnKeys}
      onColumnsChange={(next) => setVisibleColumnKeys(next as EntryColumnKey[])}
    />
  );
}

// ── Events scored in ────────────────────────────────────────────────────────

const EVENT_COLUMNS: ColumnDef<HouseEventLine, unknown>[] = [
  {
    id: 'event',
    accessorFn: (r) => r.name,
    header: 'Event',
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <IdentifierLink href={eventHref(row.original.id)}>
          {row.original.name}
        </IdentifierLink>
        <div className={MONO_SUB}>{dateLabel(row.original.heldOn)}</div>
      </div>
    ),
    enableSorting: true,
  },
  {
    id: 'type',
    accessorFn: (r) => r.eventType,
    header: 'Type',
    cell: ({ row }) => <EventTypePill type={row.original.eventType} />,
    enableSorting: true,
  },
  {
    id: 'awards',
    accessorFn: (r) => awardSummary(r.awards),
    header: 'Awards won',
    cell: ({ row }) => <AwardTallyBadges awards={row.original.awards} />,
    enableSorting: false,
  },
  {
    id: 'points',
    accessorFn: (r) => r.points,
    header: 'Points',
    cell: ({ row }) => <PointsCell points={row.original.points} />,
    enableSorting: true,
    enableGlobalFilter: false,
  },
];

export function HouseEventsDrillSheet({
  events,
  eyebrow,
  title,
  description,
  csvFilename,
}: {
  events: HouseEventLine[];
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  csvFilename: string;
}) {
  const [density, setDensity] = React.useState<DrillDownDensity>('comfortable');
  const csvHref = useCsvHref(React.useMemo(() => eventsCsv(events), [events]));
  return (
    <DrillDownSheet<HouseEventLine>
      eyebrow={eyebrow}
      title={title}
      description={description}
      count={events.length}
      csvHref={csvHref}
      csvFilename={csvFilename}
      columns={EVENT_COLUMNS}
      rows={events}
      emptyMessage="No events to show."
      density={density}
      onDensityChange={setDensity}
    />
  );
}

// ── Students who earned points ──────────────────────────────────────────────

const STUDENT_COLUMNS: ColumnDef<HouseStudentLine, unknown>[] = [
  {
    id: 'student',
    accessorFn: (r) => `${r.name} ${r.studentNumber}`,
    header: 'Student',
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <IdentifierLink href={studentHref(row.original.studentNumber)}>
          {row.original.name}
        </IdentifierLink>
        <div className={MONO_SUB}>{row.original.studentNumber}</div>
      </div>
    ),
    enableSorting: true,
  },
  {
    id: 'class',
    accessorFn: (r) => r.sectionName,
    header: 'Class',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.sectionName}
      </span>
    ),
    enableSorting: true,
  },
  {
    id: 'events',
    accessorFn: (r) => r.eventCount,
    header: 'Events',
    cell: ({ row }) => (
      <span className="text-sm tabular-nums text-foreground">
        {row.original.eventCount.toLocaleString('en-SG')}
      </span>
    ),
    enableSorting: true,
    enableGlobalFilter: false,
  },
  {
    id: 'awards',
    accessorFn: (r) => awardSummary(r.awards),
    header: 'Awards won',
    cell: ({ row }) => <AwardTallyBadges awards={row.original.awards} />,
    enableSorting: false,
  },
  {
    id: 'points',
    accessorFn: (r) => r.points,
    header: 'Points',
    cell: ({ row }) => <PointsCell points={row.original.points} />,
    enableSorting: true,
    enableGlobalFilter: false,
  },
];

export function HouseStudentsDrillSheet({
  students,
  eyebrow,
  title,
  description,
  csvFilename,
}: {
  students: HouseStudentLine[];
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  csvFilename: string;
}) {
  const [density, setDensity] = React.useState<DrillDownDensity>('comfortable');
  const csvHref = useCsvHref(
    React.useMemo(() => studentsCsv(students), [students])
  );
  return (
    <DrillDownSheet<HouseStudentLine>
      eyebrow={eyebrow}
      title={title}
      description={description}
      count={students.length}
      csvHref={csvHref}
      csvFilename={csvFilename}
      columns={STUDENT_COLUMNS}
      rows={students}
      emptyMessage="No students to show."
      density={density}
      onDensityChange={setDensity}
    />
  );
}

// ── One house's events (a house-share slice) ────────────────────────────────

const STANDING_COLUMNS: ColumnDef<HouseStandingEventRow, unknown>[] = [
  {
    id: 'event',
    accessorFn: (r) => r.name,
    header: 'Event',
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <IdentifierLink href={eventHref(row.original.eventId)}>
          {row.original.name}
        </IdentifierLink>
        <div className={MONO_SUB}>{dateLabel(row.original.heldOn)}</div>
      </div>
    ),
    enableSorting: true,
  },
  {
    id: 'place',
    accessorFn: (r) => r.place ?? Number.POSITIVE_INFINITY,
    header: 'Place',
    cell: ({ row }) =>
      row.original.place === null ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <span className="text-sm tabular-nums text-foreground">
          {ordinal(row.original.place)} of {row.original.houseCount}
        </span>
      ),
    enableSorting: true,
    enableGlobalFilter: false,
  },
  {
    id: 'points',
    accessorFn: (r) => r.points,
    header: 'Points',
    cell: ({ row }) => <PointsCell points={row.original.points} />,
    enableSorting: true,
    enableGlobalFilter: false,
  },
];

export function HouseStandingDrillSheet({
  rows,
  eyebrow,
  title,
  description,
  csvFilename,
}: {
  rows: HouseStandingEventRow[];
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  csvFilename: string;
}) {
  const [density, setDensity] = React.useState<DrillDownDensity>('comfortable');
  const csvHref = useCsvHref(React.useMemo(() => houseEventsCsv(rows), [rows]));
  return (
    <DrillDownSheet<HouseStandingEventRow>
      eyebrow={eyebrow}
      title={title}
      description={description}
      count={rows.length}
      csvHref={csvHref}
      csvFilename={csvFilename}
      columns={STANDING_COLUMNS}
      rows={rows}
      emptyMessage="No events to show."
      density={density}
      onDensityChange={setDensity}
    />
  );
}
