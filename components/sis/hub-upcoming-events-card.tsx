import Link from 'next/link';
import { CalendarDays } from 'lucide-react';

import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';
import { Card } from '@/components/ui/card';
import { EVENT_CATEGORY_LEGEND_COLOR } from '@/components/attendance/calendar/calendar-cell';
import {
  EVENT_CATEGORY_LABELS,
  type EventCategory,
} from '@/lib/schemas/attendance';
import type { UpcomingCalendarEvent } from '@/lib/sis/dashboard';

/**
 * HubUpcomingEventsCard — the SIS Admin hub's "Coming up" panel (Task V1,
 * `docs/superpowers/specs/2026-07-11-sis-admin-visual-redesign.html` Screen
 * 1). Restyled into the mockup's date-box rows; the "Next 14 days" caption
 * is a claim about the loader's actual bounds (`getUpcomingCalendarEvents`
 * queries `start_date` in [today, today+14d]) — change one, change both.
 * Category tags reuse the shared `EVENT_CATEGORY_LABELS` /
 * `EVENT_CATEGORY_LEGEND_COLOR` maps that already back the school calendar's
 * legend + cells (design system §10.2 — single source of truth, no
 * hand-picked "looks similar" color).
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
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="font-serif text-[15.5px] font-semibold text-foreground">
          Coming up
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          Next 14 days
        </p>
      </div>

      {events.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-6">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <CalendarDays className="size-4" />
          </div>
          <p className="text-[13px] text-muted-foreground">
            Nothing scheduled in the next two weeks.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {events.map((event) => {
            const category = isEventCategory(event.category)
              ? event.category
              : 'other';
            return (
              <li
                key={event.id}
                className="flex items-center gap-3 px-4 py-3 text-[13px]"
              >
                <DateBox iso={event.startDate} />
                <span className="min-w-0 flex-1 truncate text-foreground">
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

      <Link
        href="/sis/calendar"
        className="block border-t border-border px-4 py-2.5 text-center text-[12px] font-semibold text-brand-indigo hover:underline"
      >
        Open school calendar →
      </Link>
    </Card>
  );
}
