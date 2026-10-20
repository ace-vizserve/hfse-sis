'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { CalendarClock, ChevronDown, History, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { BookCoverDialog } from '@/components/relief/book-cover-dialog';
import { EndCoverButton } from '@/components/relief/end-cover-button';
import type { ReliefOption } from '@/components/sis/assignment-relief-control';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { StatusTabConfig } from '@/components/ui/data-table/types';
import type { CoverBoard, CoverClass } from '@/lib/relief/cover-board';
import type { CoverHistoryRow } from '@/lib/relief/cover-history';
import type { CoverOutcome } from '@/lib/relief/cover-history-core';
import { formatCoverDate, formatCoverWindow } from '@/lib/relief/display';
import { cn } from '@/lib/utils';

// The Cover page: one table, three tabs — Active now, Scheduled, History.
//
// ⚠ EACH ROW IS AN ABSENCE, NOT A CLASS. "Marrie is out Mon–Fri" is one
// decision covering N classes, so it is one row with the classes behind a
// count. Active and Scheduled are today's live board, whatever year is picked;
// the year switcher only scopes History, so it only appears there.

type Tab = 'active' | 'scheduled' | 'history';

type CoverRow = {
  key: string;
  tab: Tab;
  coveredTeacherId: string;
  coveredTeacherName: string;
  reliefTeacherId: string;
  reliefTeacherName: string;
  startedOn: string | null;
  endedOn: string | null;
  reason: string | null;
  classes: CoverClass[];
  /** Active: days to the last day (null = no last day). */
  endsInDays: number | null;
  /** Scheduled: days to the first day. */
  startsInDays: number | null;
  /** History only. */
  outcome: CoverOutcome | null;
};

// whitespace-nowrap: a status reads as one label, never a two-line squeeze.
const AMBER =
  'h-6 whitespace-nowrap border-brand-amber/40 bg-brand-amber/10 text-ink';
const ACCENT =
  'h-6 whitespace-nowrap border-brand-indigo-soft bg-accent text-brand-indigo-deep';
const MINT =
  'h-6 whitespace-nowrap border-brand-mint bg-brand-mint/30 text-ink';

function utcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function daysBetween(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000);
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

function daysLeftText(n: number | null): string {
  if (n === null) return 'Until it is ended';
  if (n <= 0) return 'Ends today';
  if (n === 1) return 'Ends tomorrow';
  return `${n} days left`;
}

function startsInText(n: number | null): string {
  if (n === null) return '';
  if (n <= 1) return 'Starts tomorrow';
  return `In ${n} days`;
}

function outcomeText(o: CoverOutcome | null): string {
  if (!o) return '';
  switch (o.kind) {
    case 'ran':
      return 'Ran its course';
    case 'stopped':
      return `Stopped early on ${formatCoverDate(o.on)}`;
    case 'ended':
      return `Ended on ${formatCoverDate(o.on)}`;
    case 'cancelled':
      return 'Cancelled before it started';
  }
}

/** The day a History row finished: the day it was stopped, else its last day. */
function outcomeDate(r: CoverRow): string {
  const o = r.outcome;
  return (o && 'on' in o ? o.on : r.endedOn) ?? '';
}

function whenText(r: CoverRow): string {
  if (r.tab === 'active') return daysLeftText(r.endsInDays);
  if (r.tab === 'scheduled') return startsInText(r.startsInDays);
  return outcomeText(r.outcome);
}

function WhenCell({ row }: { row: CoverRow }) {
  const text = whenText(row);
  if (row.tab === 'active') {
    // The lapse flag — the one thing this page does that no class-shaped
    // screen can. Amber only when it is close enough to act on.
    if (row.endsInDays !== null && row.endsInDays <= 7) {
      return (
        <Badge variant="outline" className={AMBER}>
          {text}
        </Badge>
      );
    }
    return <span className="text-sm text-muted-foreground">{text}</span>;
  }
  if (row.tab === 'scheduled') {
    return (
      <Badge variant="outline" className={ACCENT}>
        {text}
      </Badge>
    );
  }
  const kind = row.outcome?.kind;
  if (kind === 'ran') {
    return (
      <Badge variant="outline" className={MINT}>
        {text}
      </Badge>
    );
  }
  if (kind === 'stopped' || kind === 'ended') {
    return (
      <Badge variant="outline" className={AMBER}>
        {text}
      </Badge>
    );
  }
  return <span className="text-sm text-muted-foreground">{text}</span>;
}

// One class reads in the cell. Two or more collapse to a count that opens the
// row, so a teacher covering eight classes is still one row-height until you
// ask — the full list lands in a panel under the row (rowDetail).
function ClassesCell({
  classes,
  isOpen,
  onToggle,
}: {
  classes: CoverClass[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  if (classes.length === 1) {
    return (
      <span className="whitespace-nowrap text-sm text-foreground">
        {classes[0].label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className="-ml-2 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2 py-1 text-sm font-medium text-brand-indigo-deep transition-colors hover:border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {plural(classes.length, 'class', 'classes')}
      <ChevronDown
        className={cn(
          'size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
          isOpen && 'rotate-180'
        )}
      />
    </button>
  );
}

function ClassesPanel({ classes }: { classes: CoverClass[] }) {
  return (
    <div className="space-y-2 px-4 py-3">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {plural(classes.length, 'class', 'classes')} covered
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {classes.map((c) => (
          <li
            key={c.assignmentId}
            className="rounded-md border border-hairline bg-background px-2.5 py-1 text-sm text-foreground"
          >
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CoverTable({
  board,
  history,
  historyFailed = false,
  today,
  ayCode,
  ayOptions,
  teacherOptions,
}: {
  board: Pick<CoverBoard, 'active' | 'scheduled'>;
  history: CoverHistoryRow[];
  /** The history read failed — say so rather than "no covers". */
  historyFailed?: boolean;
  today: string;
  /** The year History lists. */
  ayCode: string;
  ayOptions: string[];
  teacherOptions: ReliefOption[];
}) {
  const rows = useMemo<CoverRow[]>(() => {
    const live = (tab: 'active' | 'scheduled') =>
      board[tab].map((g) => ({
        key: `${tab}:${g.key}`,
        tab,
        coveredTeacherId: g.coveredTeacherId,
        coveredTeacherName: g.coveredTeacherName,
        reliefTeacherId: g.reliefTeacherId,
        reliefTeacherName: g.reliefTeacherName,
        startedOn: g.startedOn,
        endedOn: g.endedOn,
        reason: g.reason?.trim() ? g.reason : null,
        classes: g.classes,
        endsInDays: g.endsInDays,
        startsInDays:
          tab === 'scheduled' && g.startedOn
            ? daysBetween(today, g.startedOn)
            : null,
        outcome: null,
      }));
    return [
      ...live('active'),
      ...live('scheduled'),
      ...history.map((h) => ({
        key: `history:${h.key}`,
        tab: 'history' as const,
        coveredTeacherId: h.coveredTeacherId,
        coveredTeacherName: h.coveredTeacherName,
        reliefTeacherId: h.reliefTeacherId,
        reliefTeacherName: h.reliefTeacherName,
        startedOn: h.startedOn,
        endedOn: h.endedOn,
        reason: h.reason,
        classes: h.classes,
        endsInDays: null,
        startsInDays: null,
        outcome: h.outcome,
      })),
    ];
  }, [board, history, today]);

  // Open on what is happening: Active, unless nothing is and something is
  // booked ahead. One tab at a time — there is no "All".
  const defaultTab: Tab =
    board.active.length === 0 && board.scheduled.length > 0
      ? 'scheduled'
      : 'active';
  const [tab, setTab] = useState<Tab>(defaultTab);

  // Rows whose class list is open (rowDetail panel under the row).
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());
  const toggleRow = (key: string) =>
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const teacherNames = useMemo(
    () =>
      [
        ...new Set(
          rows.flatMap((r) => [r.coveredTeacherName, r.reliefTeacherName])
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const statusTabs = useMemo<Array<StatusTabConfig<CoverRow>>>(
    () => [
      {
        value: 'active',
        label: 'Active now',
        predicate: (r) => r.tab === 'active',
        isDefault: defaultTab === 'active',
        emptyState: {
          icon: RefreshCw,
          title: 'Nobody is covering today',
          body: 'Every class is with the teacher who holds it.',
        },
      },
      {
        value: 'scheduled',
        label: 'Scheduled',
        predicate: (r) => r.tab === 'scheduled',
        isDefault: defaultTab === 'scheduled',
        emptyState: {
          icon: CalendarClock,
          title: 'Nothing booked ahead',
          body: "When a teacher's leave is approved, book the cover here and it starts and stops on its own.",
        },
      },
      {
        value: 'history',
        label: 'History',
        predicate: (r) => r.tab === 'history',
        emptyState: historyFailed
          ? {
              icon: History,
              title: "Cover history couldn't be loaded",
              body: 'Refresh to try again.',
            }
          : {
              icon: History,
              title: `No covers in ${ayCode}`,
              body: 'A cover shows here once its last day has passed, or once somebody ends it.',
            },
      },
    ],
    [defaultTab, ayCode, historyFailed]
  );

  const whenLabel =
    tab === 'active'
      ? 'Days left'
      : tab === 'scheduled'
        ? 'Starts in'
        : 'Outcome';

  const columns = useMemo<ColumnDef<CoverRow>[]>(() => {
    const cols: ColumnDef<CoverRow>[] = [
      {
        accessorKey: 'coveredTeacherName',
        header: ({ column }) => (
          <SortableHeader column={column}>Absent teacher</SortableHeader>
        ),
        meta: { label: 'Absent teacher' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-medium text-foreground">
            {row.original.coveredTeacherName}
          </span>
        ),
      },
      {
        accessorKey: 'reliefTeacherName',
        header: ({ column }) => (
          <SortableHeader column={column}>Substitute</SortableHeader>
        ),
        meta: { label: 'Substitute' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-foreground">
            {row.original.reliefTeacherName}
          </span>
        ),
      },
      {
        id: 'dates',
        accessorFn: (r) =>
          formatCoverWindow(r.startedOn, r.endedOn) ?? 'Open-ended',
        header: ({ column }) => (
          <SortableHeader column={column}>Dates</SortableHeader>
        ),
        meta: { label: 'Dates' },
        sortingFn: (a, b) =>
          (a.original.startedOn ?? '').localeCompare(
            b.original.startedOn ?? ''
          ),
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-sm tabular-nums text-foreground">
            {getValue<string>()}
          </span>
        ),
      },
      {
        id: 'when',
        accessorFn: whenText,
        header: ({ column }) => (
          <SortableHeader column={column}>{whenLabel}</SortableHeader>
        ),
        meta: { label: whenLabel },
        sortingFn: (a, b) => {
          const r = a.original;
          const s = b.original;
          if (r.tab === 'active')
            return (r.endsInDays ?? 9999) - (s.endsInDays ?? 9999);
          if (r.tab === 'scheduled')
            return (r.startsInDays ?? 9999) - (s.startsInDays ?? 9999);
          // History: by the day it finished, not by the words.
          return outcomeDate(r).localeCompare(outcomeDate(s));
        },
        cell: ({ row }) => <WhenCell row={row.original} />,
      },
      {
        accessorKey: 'reason',
        header: 'Reason',
        cell: ({ row }) =>
          row.original.reason ? (
            <span className="text-sm text-foreground">
              {row.original.reason}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Not given</span>
          ),
      },
      {
        id: 'classes',
        accessorFn: (r) => r.classes.map((c) => c.label).join(', '),
        header: 'Classes',
        enableSorting: false,
        cell: ({ row }) => (
          <ClassesCell
            classes={row.original.classes}
            isOpen={openRows.has(row.original.key)}
            onToggle={() => toggleRow(row.original.key)}
          />
        ),
      },
      {
        // Filter only: a teacher matches whether they were away or covering.
        id: 'teacher',
        accessorFn: (r) => `${r.coveredTeacherName} ${r.reliefTeacherName}`,
        header: 'Teacher',
        enableHiding: false,
        meta: { excludeFromExport: true },
        filterFn: (row, _id, value) => {
          if (!Array.isArray(value) || value.length === 0) return true;
          return (
            value.includes(row.original.coveredTeacherName) ||
            value.includes(row.original.reliefTeacherName)
          );
        },
      },
    ];

    // History is read-only: what ended is not edited, and covering that
    // teacher again is a new booking.
    if (tab !== 'history') {
      cols.push({
        id: 'actions',
        header: '',
        enableHiding: false,
        enableSorting: false,
        meta: { excludeFromExport: true },
        cell: ({ row }) => {
          const g = row.original;
          return (
            <div className="flex items-center justify-end gap-1.5">
              <BookCoverDialog
                teacherOptions={teacherOptions}
                editing={{
                  coveredTeacherId: g.coveredTeacherId,
                  coveredTeacherName: g.coveredTeacherName,
                  reliefTeacherId: g.reliefTeacherId,
                  startedOn: g.startedOn,
                  endedOn: g.endedOn,
                  reason: g.reason,
                  classCount: g.classes.length,
                }}
              />
              <EndCoverButton
                coveredTeacherId={g.coveredTeacherId}
                coveredTeacherName={g.coveredTeacherName}
                reliefTeacherName={g.reliefTeacherName}
                classCount={g.classes.length}
                scheduled={g.tab === 'scheduled'}
              />
            </div>
          );
        },
      });
    }
    return cols;
  }, [tab, whenLabel, teacherOptions, openRows]);

  return (
    <DataTable<CoverRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.key}
      statusTabs={statusTabs}
      onStatusTabChange={(v) => setTab((v as Tab | undefined) ?? defaultTab)}
      searchKeys={[
        'coveredTeacherName',
        'reliefTeacherName',
        (r) => r.reason ?? '',
        (r) => r.classes.map((c) => c.label).join(' '),
      ]}
      searchPlaceholder="Search teachers, reasons or classes…"
      facets={[
        { columnId: 'teacher', label: 'Teacher', valueOptions: teacherNames },
      ]}
      initialColumnVisibility={{ teacher: false }}
      rowDetail={{
        render: (r) =>
          r.classes.length > 1 && openRows.has(r.key) ? (
            <ClassesPanel classes={r.classes} />
          ) : null,
      }}
      toolbarFilters={
        tab === 'history' ? (
          <AySwitcher
            current={ayCode}
            options={ayOptions}
            className="h-8 w-[140px]"
          />
        ) : null
      }
      csv={{
        filename:
          tab === 'history'
            ? `cover-history-${ayCode}.csv`
            : `cover-${tab}.csv`,
      }}
      url={{ enabled: true, namespace: 'cover' }}
      emptyFilteredState={{
        title: 'No covers match',
        body: 'Try another teacher or clear the search.',
      }}
    />
  );
}
