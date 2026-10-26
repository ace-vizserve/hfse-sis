'use client';

import { CalendarDays, Pencil, Trash2 } from 'lucide-react';

import { formatRange } from '@/components/sow/format';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toPlainText } from '@/lib/rich-text';
import type { SowView } from '@/lib/sow/read';
import { cn } from '@/lib/utils';

// The weeks of a scheme of work, in term order, with the break weeks between
// them (a week with no school day has no number — lib/sow/weeks.ts).
//
// A custom row list rather than a Table: each week is a multi-line block
// (topic, activity summary, school events, flags), which 09 §2.4 gives to a
// list, and the edit action sits at the row's end.

type Week = SowView['weeks'][number];
type Break = SowView['breaks'][number];

type Item =
  | { kind: 'week'; at: string; week: Week }
  | { kind: 'break'; at: string; brk: Break };

const ROW =
  'grid grid-cols-[56px_minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 py-4 sm:grid-cols-[64px_120px_minmax(0,1fr)_auto]';

export function WeekList({
  weeks,
  breaks,
  canEdit,
  returnWeekNumber,
  onEdit,
  onDelete,
  deleting,
}: {
  weeks: Week[];
  breaks: Break[];
  canEdit: boolean;
  /** The week a return note points at, flagged on its row. */
  returnWeekNumber: number | null;
  onEdit: (weekNumber: number) => void;
  onDelete: (weekNumber: number) => void;
  deleting: number | null;
}) {
  // Term weeks and breaks interleave by date. Surplus weeks (the term no
  // longer reaches them) keep their stored dates, which can fall anywhere, so
  // they go last, after the term.
  const termItems: Item[] = [
    ...weeks
      .filter((w) => !w.isSurplus)
      .map((w) => ({ kind: 'week' as const, at: w.startsOn, week: w })),
    ...breaks.map((b) => ({ kind: 'break' as const, at: b.startsOn, brk: b })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const surplus = weeks.filter((w) => w.isSurplus);

  if (weeks.length === 0) {
    return (
      <Card className="items-center gap-2 px-6 py-12 text-center">
        <CalendarDays className="size-6 text-muted-foreground" />
        <p className="font-serif text-lg font-semibold text-foreground">
          No weeks yet.
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          The weeks come from this term&rsquo;s dates on the school calendar.
          Once the term&rsquo;s dates are set, they appear here.
        </p>
      </Card>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <ul className="divide-y divide-border">
        {termItems.map((item) =>
          item.kind === 'break' ? (
            <li
              key={`break-${item.brk.startsOn}`}
              className={cn(ROW, 'bg-muted/50 py-3')}
            >
              <span className="font-mono text-[12px] font-semibold text-ink-5">
                —
              </span>
              <span className="hidden text-[13px] text-muted-foreground sm:block">
                {formatRange(item.brk.startsOn, item.brk.endsOn)}
              </span>
              <span className="text-[13px] text-muted-foreground">
                <span className="sm:hidden">
                  {formatRange(item.brk.startsOn, item.brk.endsOn)} ·{' '}
                </span>
                {item.brk.label ?? 'No school this week'}
              </span>
              <span />
            </li>
          ) : (
            <WeekRow
              key={item.week.weekNumber}
              week={item.week}
              canEdit={canEdit}
              flagged={item.week.weekNumber === returnWeekNumber}
              onEdit={onEdit}
            />
          )
        )}
        {surplus.map((w) => (
          <WeekRow
            key={w.weekNumber}
            week={w}
            canEdit={canEdit}
            flagged={w.weekNumber === returnWeekNumber}
            onEdit={onEdit}
            onDelete={onDelete}
            deleting={deleting === w.weekNumber}
          />
        ))}
      </ul>
    </Card>
  );
}

function WeekRow({
  week,
  canEdit,
  flagged,
  onEdit,
  onDelete,
  deleting = false,
}: {
  week: Week;
  canEdit: boolean;
  flagged: boolean;
  onEdit: (weekNumber: number) => void;
  onDelete?: (weekNumber: number) => void;
  deleting?: boolean;
}) {
  const activity = toPlainText(week.activities);
  const dates = formatRange(week.startsOn, week.endsOn);
  return (
    <li
      className={cn(
        ROW,
        flagged && 'border-l-[3px] border-l-destructive bg-destructive/5',
        week.isSurplus && 'bg-brand-amber/5'
      )}
    >
      <span className="pt-0.5 font-mono text-[12px] font-semibold text-ink-3">
        WK {week.weekNumber}
      </span>
      <span className="hidden pt-0.5 text-[13px] tabular-nums text-ink-3 sm:block">
        {dates}
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-[13px] tabular-nums text-ink-3 sm:hidden">{dates}</p>
        {week.topic ? (
          <p className="text-sm font-medium text-foreground">{week.topic}</p>
        ) : (
          <p className="text-sm text-ink-5">No topic yet</p>
        )}
        {activity && (
          <p className="line-clamp-2 text-[13px] text-ink-3">{activity}</p>
        )}
        {week.events.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-brand-amber">
            <CalendarDays className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{week.events.join(' · ')}</span>
          </p>
        )}
        {flagged && (
          <p className="text-xs font-semibold text-destructive">
            The return note is about this week
          </p>
        )}
        {week.isSurplus && (
          <p className="text-xs font-semibold text-brand-amber">
            Extra week from last year — merge it into another week or delete it
          </p>
        )}
      </div>
      <div className="flex items-start justify-end gap-2">
        {canEdit && week.isSurplus && onDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                loading={deleting}
                loadingText="Deleting…"
              >
                {!deleting && <Trash2 className="size-4" />}
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete Week {week.weekNumber}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Its topic, outcomes and activities are removed from this
                  scheme of work. Move anything you want to keep into another
                  week first.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => onDelete(week.weekNumber)}
                >
                  Delete Week {week.weekNumber}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {canEdit && (
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            aria-label={`Edit week ${week.weekNumber}`}
            onClick={() => onEdit(week.weekNumber)}
          >
            <Pencil className="size-4" />
          </Button>
        )}
      </div>
    </li>
  );
}
