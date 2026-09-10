import { CalendarCheck, CalendarDays } from 'lucide-react';

import { Card } from '@/components/ui/card';
import type { UpcomingCalendarEvent } from '@/lib/sis/dashboard';

function formatDate(iso: string): { day: string; month: string } {
  const d = new Date(`${iso}T00:00:00+08:00`);
  return {
    day: String(d.getDate()),
    month: d.toLocaleString('en-SG', { month: 'short' }),
  };
}

export function ComingUpPanel({ events }: { events: UpcomingCalendarEvent[] }) {
  return (
    // See the note in `todo-panel.tsx` — the home grid owns the column split.
    <Card className="overflow-hidden p-0">
      {/* Header treatment matched to `todo-panel.tsx` — see the note there. */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <CalendarDays className="size-[17px]" aria-hidden />
        </div>
        <span className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Coming up
        </span>
      </div>
      {events.length === 0 ? (
        // §7.6 — "empty states are never blank". This was a one-line
        // `text-xs` note while the to-do panel beside it rendered the full
        // pattern, so the same page answered the same shape of question two
        // different ways. Matched to `todo-panel.tsx` deliberately: they sit
        // side by side and any difference between them reads as a bug.
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <CalendarCheck className="size-[18px]" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-serif text-[15px] font-semibold text-foreground">
              Nothing in the next two weeks
            </p>
            <p className="text-xs text-muted-foreground">
              Term dates, holidays and school events appear here as they are
              added to the calendar.
            </p>
          </div>
        </div>
      ) : (
        events.map((event) => {
          const { day, month } = formatDate(event.startDate);
          return (
            <div
              key={event.id}
              className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <div className="flex size-9 flex-col items-center justify-center rounded-lg border border-border bg-muted">
                <span className="font-serif text-sm font-bold leading-none text-foreground">
                  {day}
                </span>
                <span className="font-mono text-[9px] uppercase text-muted-foreground">
                  {month}
                </span>
              </div>
              <span className="text-sm text-foreground">{event.label}</span>
            </div>
          );
        })
      )}
    </Card>
  );
}
