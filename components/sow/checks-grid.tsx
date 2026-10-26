'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { ClipboardCheck, Eye } from 'lucide-react';
import { useMemo, useState } from 'react';

import { SignWeekSheet } from '@/components/sow/sign-week-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import type { CellMark } from '@/lib/sow/check-options';
import type { GridCell, GridRow, NeedsALookItem } from '@/lib/sow/oversight';
import { cn } from '@/lib/utils';

// The weekly-checks grid (board 10): one row per class × subject with an
// approved plan, one column per week. Each cell is a mark — ✓ as planned,
// ! a note, ○ over and unchecked, · not yet — underlined once the subject
// head has signed it. A started week opens "Review and sign a week".
//
// Built on DataTable for its toolbar (search, Level / Subject facets, the
// "Only needs a look" toggle); the week columns are generated from the term.

/**
 * The one map the cells AND the legend read (09a §10.2), so the key can
 * never drift from what it documents. §9.3 tones: mint healthy, amber a
 * note, destructive overdue, muted not yet.
 */
export const MARK_LOOK: Record<
  CellMark,
  { glyph: string; label: string; className: string }
> = {
  ok: {
    glyph: '✓',
    label: 'As planned',
    className: 'border-brand-mint bg-brand-mint/30 text-ink',
  },
  note: {
    glyph: '!',
    label: 'Adjusted, delayed or extra (has a note)',
    className: 'border-brand-amber/40 bg-brand-amber/10 text-brand-amber',
  },
  missed: {
    glyph: '○',
    label: 'Not checked, week is over',
    className: 'border-destructive/40 bg-destructive/10 text-destructive',
  },
  todo: {
    glyph: '·',
    label: 'Not yet',
    className: 'border-transparent text-ink-5',
  },
};

function MarkChip({
  mark,
  signed = false,
  className,
}: {
  mark: CellMark;
  signed?: boolean;
  className?: string;
}) {
  const look = MARK_LOOK[mark];
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md border text-[13px] font-bold leading-none',
        look.className,
        signed && 'underline decoration-2 underline-offset-[3px]',
        className
      )}
    >
      {look.glyph}
    </span>
  );
}

type Row = GridRow & { needsALook: boolean };

export function ChecksGrid({
  rows,
  weekCount,
  currentWeek,
  needsALook,
}: {
  rows: GridRow[];
  weekCount: number;
  currentWeek: number | null;
  needsALook: NeedsALookItem[];
}) {
  const [open, setOpen] = useState<{ rowId: string; week: number } | null>(
    null
  );
  const flagged = useMemo(
    () => new Set(needsALook.map((i) => i.rowId)),
    [needsALook]
  );
  const data = useMemo<Row[]>(
    () => rows.map((r) => ({ ...r, needsALook: flagged.has(r.id) })),
    [rows, flagged]
  );

  // Read from the latest rows, so the drawer shows what the server says after
  // a sign or an ask.
  const target = useMemo(() => {
    if (!open) return null;
    const row = rows.find((r) => r.id === open.rowId);
    const cell = row?.cells.find((c) => c.weekNumber === open.week);
    return row && cell ? { row, cell } : null;
  }, [open, rows]);

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const weekColumns: ColumnDef<Row>[] = Array.from(
      { length: weekCount },
      (_, i) => {
        const n = i + 1;
        const isNow = n === currentWeek;
        return {
          id: `wk${n}`,
          accessorFn: (r) =>
            r.cells.find((c) => c.weekNumber === n)?.mark ?? '',
          header: () => (
            <span
              className={cn(
                'inline-flex h-7 min-w-11 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums',
                isNow ? 'bg-accent text-primary' : 'text-muted-foreground'
              )}
              aria-current={isNow ? 'date' : undefined}
            >
              Wk {n}
            </span>
          ),
          meta: { label: `Week ${n}`, excludeFromExport: true },
          enableSorting: false,
          enableHiding: false,
          cell: ({ row }) => {
            const r = row.original;
            const cell = r.cells.find((c) => c.weekNumber === n);
            if (!cell) return <span className="sr-only">No week</span>;
            return (
              <div className="flex justify-center">
                <CellButton
                  row={r}
                  cell={cell}
                  onOpen={() => setOpen({ rowId: r.id, week: n })}
                />
              </div>
            );
          },
        };
      }
    );

    return [
      {
        id: 'class',
        accessorFn: (r) => `${r.className} ${r.subjectName}`,
        header: 'Class · subject',
        meta: { label: 'Class and subject' },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            <span className="font-medium text-foreground">
              {row.original.className}
            </span>{' '}
            <span className="text-muted-foreground">
              · {row.original.subjectName}
            </span>
          </span>
        ),
      },
      // Facet-only columns, hidden: the toolbar's Level and Subject filters.
      {
        id: 'level',
        accessorFn: (r) => r.levelLabel,
        header: 'Level',
        meta: { label: 'Level' },
        enableSorting: false,
      },
      {
        id: 'subject',
        accessorFn: (r) => r.subjectName,
        header: 'Subject',
        meta: { label: 'Subject' },
        enableSorting: false,
      },
      ...weekColumns,
    ];
  }, [weekCount, currentWeek]);

  return (
    <div className="space-y-6">
      <div className="space-y-0">
        <DataTable<Row>
          data={data}
          columns={columns}
          getRowId={(r) => r.id}
          searchKeys={[(r) => `${r.className} ${r.subjectName}`]}
          searchPlaceholder="Search classes or subjects"
          facets={[
            { columnId: 'level', label: 'Level' },
            { columnId: 'subject', label: 'Subject' },
          ]}
          meScope={{
            enabled: true,
            userId: null,
            label: 'Only needs a look',
            icon: Eye,
            predicate: (r) => r.needsALook,
          }}
          initialColumnVisibility={{ level: false, subject: false }}
          hidePagination
          emptyState={{
            icon: ClipboardCheck,
            title: 'No approved schemes of work yet.',
            body: 'Once a scheme of work is approved, its classes appear here week by week as their teachers check them.',
          }}
        />
        <Legend />
      </div>

      <NeedsALookCard
        items={needsALook}
        onOpen={(i) => setOpen({ rowId: i.rowId, week: i.weekNumber })}
      />

      <SignWeekSheet
        target={target}
        onOpenChange={(o) => {
          if (!o) setOpen(null);
        }}
      />
    </div>
  );
}

function CellButton({
  row,
  cell,
  onOpen,
}: {
  row: GridRow;
  cell: GridCell;
  onOpen: () => void;
}) {
  const label = `${row.className} · ${row.subjectName}, Week ${cell.weekNumber}: ${MARK_LOOK[cell.mark].label}${cell.signed ? ', signed' : ''}`;
  // A week that has not started has nothing to review.
  if (!cell.started) {
    return (
      <span title={label}>
        <MarkChip mark={cell.mark} />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title={label}
      aria-label={`${label}. Review and sign`}
      className="rounded-md transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      <MarkChip mark={cell.mark} signed={cell.signed} />
    </button>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 pt-3 text-xs text-ink-3">
      {(['ok', 'note', 'missed', 'todo'] as const).map((m) => (
        <span key={m} className="inline-flex items-center gap-2">
          <MarkChip mark={m} className="size-6 text-xs" />
          {MARK_LOOK[m].label}
        </span>
      ))}
      <span className="inline-flex items-center gap-2">
        <MarkChip mark="ok" signed className="size-6 text-xs" />
        Underline = supervisor has signed
      </span>
    </div>
  );
}

function NeedsALookCard({
  items,
  onOpen,
}: {
  items: NeedsALookItem[];
  onOpen: (item: NeedsALookItem) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Needs a look
        </h2>
        <span className="text-[13px] tabular-nums text-muted-foreground">
          {items.length === 0
            ? 'Nothing right now'
            : `${items.length} ${items.length === 1 ? 'week' : 'weeks'}`}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          Every week so far went as planned or has been signed. Weeks with a
          note, weeks left unchecked, and classes off plan two weeks running
          show here.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((i) => (
            <li
              key={i.id}
              className="grid gap-x-4 gap-y-1.5 px-5 py-3 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto] sm:items-center"
            >
              <span className="flex items-center gap-2.5 text-[13px] font-medium text-foreground">
                <MarkChip
                  mark={i.kind === 'missed' ? 'missed' : 'note'}
                  className="size-6 shrink-0 text-xs"
                />
                {i.who}
              </span>
              <span className="text-[13px] text-ink-2">{i.note}</span>
              <Button
                variant="outline"
                size="sm"
                className="justify-self-start sm:justify-self-end"
                onClick={() => onOpen(i)}
              >
                Review and sign
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
