import { CalendarClock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { formatCoverDate, formatCoverWindow } from '@/lib/relief/display';
import type { UpcomingCover } from '@/lib/relief/upcoming';

// "You're covering" — what this teacher is booked to stand in on, before it
// starts. Appears on home, the Classroom index and the Markbook and Attendance
// section lists (Mr Ace, 2026-08-24: all of them).
//
// ⚠ NOTHING HERE IS A LINK, AND THAT IS THE DESIGN. Every class listed is one
// the reader cannot open yet — the register, the mark sheet and the roster all
// refuse them until the first day (migration 123). A link would 403, which is
// worse than no link because it reads as broken rather than as not-yet.
//
// ⚠ AND IT NEVER SAYS "COVERING". It says "covers from 3 Sep". The word
// covering is a claim about today, and a teacher who reads it as today's truth
// will go to a class that is not theirs and find they cannot mark it. Wording
// comes from lib/relief/display.ts so four screens cannot drift apart.
//
// Hollow amber, matching the badge on every other surface: same hue as live
// cover so a reader groups them as the same kind of thing, no fill because
// nothing has been granted (§9.3, and see lib/relief/display.ts).

export function UpcomingCoverPanel({
  covers,
  className = '',
}: {
  covers: UpcomingCover[];
  className?: string;
}) {
  // Renders nothing at all when there is nothing booked. An empty state here
  // would be a permanent box on four pages explaining an absence of news.
  if (covers.length === 0) return null;

  return (
    <section
      className={`rounded-xl border border-brand-amber/40 bg-card p-4 ${className}`}
      aria-labelledby="upcoming-cover-heading"
    >
      <div className="flex items-center gap-2.5">
        <CalendarClock className="size-4 shrink-0 text-brand-amber" />
        <h2
          id="upcoming-cover-heading"
          className="font-serif text-base font-semibold text-foreground"
        >
          You&rsquo;re covering
        </h2>
        <Badge variant="secondary" className="h-5 tabular-nums">
          {covers.length}
        </Badge>
      </div>

      <p className="pt-1.5 text-sm text-muted-foreground">
        These classes open on the first day. Until then you can see them here
        but not mark them.
      </p>

      <ul className="flex flex-col gap-2 pt-3">
        {covers.map((c) => (
          <li
            key={c.assignmentId}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-hairline bg-muted/30 px-3 py-2"
          >
            <span className="text-sm text-foreground">
              {c.role === 'form_adviser'
                ? `${c.sectionName} · Form class`
                : `${c.sectionName} · ${c.subjectName ?? 'Subject'}`}
            </span>
            <span className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="h-6 border-brand-amber/40 bg-transparent text-muted-foreground"
              >
                covers from {formatCoverDate(c.startedOn)}
              </Badge>
              {c.endedOn && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatCoverWindow(c.startedOn, c.endedOn)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
