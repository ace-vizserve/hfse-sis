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
    <Card className="flex-1 overflow-hidden p-0">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
        Coming up
      </div>
      {events.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          Nothing scheduled in the next 14 days.
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
