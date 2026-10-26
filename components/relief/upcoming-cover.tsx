import { BookOpen, CalendarClock } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCoverDate, formatCoverWindow } from '@/lib/relief/display';
import type { LiveLessonCover, UpcomingCover } from '@/lib/relief/upcoming';

// "You're covering" — what this teacher is booked to stand in on, before it
// starts. Appears on home, the Classroom index and the Markbook and Attendance
// section lists (Mr Ace, 2026-08-24: all of them).
//
// The one exception is `liveCovers`, cover running TODAY: those rows link to
// "See today's lesson" (scheme of work, spec §5.2). Everything below about
// links and the word "covering" is about the BOOKED rows, and still holds.
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
  liveCovers = [],
  className = '',
}: {
  covers: UpcomingCover[];
  /**
   * Subject cover running TODAY (scheme of work, spec §5.2). The one place
   * the panel links: each row opens "See today's lesson", a page the reader
   * can open because the cover is live — the page re-checks it all the same.
   */
  liveCovers?: LiveLessonCover[];
  className?: string;
}) {
  // Renders nothing at all when there is nothing booked. An empty state here
  // would be a permanent box on four pages explaining an absence of news.
  if (covers.length === 0 && liveCovers.length === 0) return null;

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
          {covers.length + liveCovers.length}
        </Badge>
      </div>

      {liveCovers.length > 0 && (
        <ul className="flex flex-col gap-2 pt-3">
          {liveCovers.map((c) => (
            <li
              key={c.assignmentId}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-brand-indigo-soft bg-accent px-3 py-2 text-brand-indigo-deep"
            >
              <span className="text-sm">
                <b className="font-semibold">
                  {c.sectionName} · {c.subjectName}
                </b>{' '}
                today
                {c.coveredTeacherName ? ` for ${c.coveredTeacherName}` : ''}
              </span>
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/classroom/sow/covering/${c.sectionId}/${c.subjectId}`}
                >
                  <BookOpen aria-hidden />
                  See today&rsquo;s lesson
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {covers.length > 0 && (
        <p className="pt-1.5 text-sm text-muted-foreground">
          These classes open on the first day. Until then you can see them here
          but not mark them.
        </p>
      )}

      <ul className="flex flex-col gap-2 pt-3 empty:hidden">
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
