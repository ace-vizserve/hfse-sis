import Link from 'next/link';
import { ArrowRightIcon, CalendarDays } from 'lucide-react';

import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { EVENT_CATEGORY_LEGEND_COLOR } from '@/components/attendance/calendar/calendar-cell';
import {
  EVENT_CATEGORY_LABELS,
  type EventCategory,
} from '@/lib/schemas/attendance';
import type { UpcomingCalendarEvent } from '@/lib/sis/dashboard';

/**
 * HubUpcomingEventsCard — the SIS Admin hub's "Coming up" panel (Task V1,
 * `docs/superpowers/specs/2026-07-11-sis-admin-visual-redesign.html` Screen
 * 1). Rebuilt onto the real Card/CardHeader/CardAction shape (matching
 * `components/dashboard/action-list.tsx`'s actual list-card recipe) after
 * a review found the prior flat header + bare `<ul>` had no icon tile at
 * all. Date-box rows unchanged; the "Next 14 days" caption is a claim
 * about the loader's actual bounds (`getUpcomingCalendarEvents` queries
 * `start_date` in [today, today+14d]) — change one, change both. Category
 * tags reuse the shared `EVENT_CATEGORY_LABELS` / `EVENT_CATEGORY_LEGEND_COLOR`
 * maps that already back the school calendar's legend + cells (design
 * system §10.2 — single source of truth, no hand-picked "looks similar"
 * color).
 */

function isEventCategory(value: string): value is EventCategory {
  return value in EVENT_CATEGORY_LABELS;
}

// `start_date`/`end_date` are date-only SGT calendar strings (KD #32) —
// parsed as UTC components so the displayed day/month never shift with the
// rendering machine's local timezone.
//
// Exported so other calendar surfaces (e.g. the school-calendar List view)
// reuse the exact same date-box anatomy instead of hand-rolling a lookalike —
// one visual source for "serif day / mono month" across the module.
export function DateBox({ iso }: { iso: string }) {
  const [, m, d] = iso.split('-').map(Number);
  const day = d;
  const month = new Date(Date.UTC(2000, (m ?? 1) - 1, 1))
    .toLocaleDateString('en-SG', { month: 'short', timeZone: 'UTC' })
    .toUpperCase();
  return (
    <div className="flex w-10 shrink-0 flex-col items-center rounded-lg border border-border bg-muted/40 py-1">
      <span className="font-serif text-[15px] font-semibold leading-none tabular-nums text-foreground">
        {day}
      </span>
      <span className="mt-1 font-mono text-[8.5px] uppercase tracking-wider text-muted-foreground">
        {month}
      </span>
    </div>
  );
}

export function HubUpcomingEventsCard({
  events,
}: {
  events: UpcomingCalendarEvent[];
}) {
  return (
    <Card className="@container/card h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Next 14 days
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Coming up
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <CalendarDays className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent
        className={cn('space-y-0 p-0', events.length === 0 && 'flex-1')}
      >
        {events.length === 0 ? (
          // Richer than a one-line empty state (same icon-tile + serif
          // heading + description recipe as the Grade Levels catalog's
          // "No grade levels yet" state), and `flex-1` on CardContent above
          // so it actually grows to fill whatever height the grid gives
          // this card (it sits `h-full` next to "Needs attention", whose
          // height varies with row count) instead of leaving dead space
          // below a fixed-height box.
          <div className="flex h-full flex-col items-center justify-center gap-3 px-5 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <CalendarDays className="size-5" />
            </div>
            <div className="font-serif text-lg font-semibold text-foreground">
              Nothing scheduled
            </div>
            <p className="max-w-xs text-sm text-muted-foreground">
              No events in the next two weeks. Term dates, exams, and closures
              you add to the school calendar will show up here as they approach.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {events.map((event) => {
              const category = isEventCategory(event.category)
                ? event.category
                : 'other';
              return (
                <li
                  key={event.id}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <DateBox iso={event.startDate} />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {event.label}
                    {event.tentative && (
                      <span className="ml-1.5 font-mono text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">
                        tentative
                      </span>
                    )}
                  </span>
                  <ChartLegendChip
                    color={EVENT_CATEGORY_LEGEND_COLOR[category]}
                    label={EVENT_CATEGORY_LABELS[category]}
                    className="hidden px-1.5 text-[9px] sm:inline-flex"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-end border-t border-border px-6 py-3 text-xs">
        <Link
          href="/sis/calendar"
          className="inline-flex items-center gap-1 font-medium text-foreground hover:text-brand-indigo-deep"
        >
          Open school calendar
          <ArrowRightIcon className="size-3" />
        </Link>
      </CardFooter>
    </Card>
  );
}
