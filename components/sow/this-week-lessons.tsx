import Link from 'next/link';

import { cn } from '@/lib/utils';
import type { LessonRow, LessonTone } from '@/lib/sow/home';

// "This week's lessons" on a teacher's Classroom home (board 15): one row per
// class x subject, the topic they are on, and one quiet chip saying where the
// week stands. Each row opens the scheme of work. Quiet chips on purpose —
// only a returned scheme earns the destructive tint (09a §9.3), so a glance
// down the list finds the one that needs the teacher.

const CHIP: Record<LessonTone, string> = {
  quiet: 'bg-muted text-muted-foreground',
  muted: 'bg-muted/60 text-muted-foreground',
  info: 'bg-accent text-brand-indigo-deep',
  locked: 'bg-destructive/10 text-destructive',
};

export function ThisWeekLessons({
  lessons,
  className,
}: {
  lessons: LessonRow[];
  className?: string;
}) {
  if (lessons.length === 0) return null;
  const weekLabel = lessons.find((l) => l.weekLabel)?.weekLabel ?? null;
  return (
    <section
      aria-labelledby="this-week-heading"
      className={cn('flex min-w-0 flex-col gap-2.5', className)}
    >
      <div className="flex items-baseline gap-2">
        <h2
          id="this-week-heading"
          className="font-serif text-base font-semibold text-foreground"
        >
          This week&rsquo;s lessons
        </h2>
        {weekLabel && (
          <span className="text-xs text-muted-foreground">{weekLabel}</span>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {lessons.map((l) => (
          <li key={l.id}>
            <Link
              href={l.href}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-hairline bg-card px-4 py-3.5 transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-[13px] text-muted-foreground">
                  {l.className}
                </span>
                <span className="text-[15px] font-medium text-foreground">
                  {l.topic}
                </span>
              </span>
              {l.state && (
                <span
                  className={cn(
                    'whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold',
                    CHIP[l.state.tone]
                  )}
                >
                  {l.state.label}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
