import { CalendarDays, CircleSlash, UserRoundPlus } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { formatWeekdayDay } from '@/components/sow/format';
import { ReliefNoteForm } from '@/components/sow/relief-note-form';
import { ReliefNoteLine } from '@/components/sow/relief-note-line';
import { Card } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { RichText } from '@/components/ui/rich-text';
import { isEmptyRichText } from '@/lib/rich-text';
import { CHECK_LABELS, type CheckOption } from '@/lib/sow/check-options';
import { type CoveringLesson, loadCoveringLesson } from '@/lib/sow/relief';
import { createServiceClient } from '@/lib/supabase/service';
import { getSessionUser } from '@/lib/supabase/server';

// The relief teacher's lesson for a class they cover today (spec §5.2,
// boards 13–14), opened from "See today's lesson" on the "You're covering"
// panel. `loadCoveringLesson` decides who may see it (live cover only) and
// reads ONLY the approved snapshot — a scheme being revised still shows the
// plan in force.
//
// Never covered the class: a 404, the same as a class that does not exist.
// Cover that has ended (or not started): said plainly, because that teacher
// did cover it and a blank 404 would read as a broken link.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CoveringLessonPage({
  params,
}: {
  params: Promise<{ sectionId: string; subjectId: string }>;
}) {
  const { sectionId, subjectId } = await params;
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!UUID.test(sectionId) || !UUID.test(subjectId)) notFound();

  const result = await loadCoveringLesson(
    createServiceClient(),
    user.id,
    sectionId,
    subjectId
  );
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <PageShell className="max-w-3xl">
        <Card className="items-center gap-3 px-6 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <CircleSlash className="size-5" strokeWidth={1.75} />
          </div>
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-foreground">
            {result.error}
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            The class&rsquo;s lesson and notes show here only on the days you
            are covering it.
          </p>
          <Link
            href="/classroom"
            className="text-sm font-medium text-primary hover:underline"
          >
            Go to your classes
          </Link>
        </Card>
      </PageShell>
    );
  }

  const { lesson } = result;
  const { context } = lesson;

  return (
    <PageShell className="max-w-3xl space-y-5">
      <CoveringBanner context={context} />
      {lesson.sow ? <Lesson lesson={lesson} /> : <NoScheme />}
      <ReliefNoteForm
        sectionId={sectionId}
        subjectId={subjectId}
        weekNumber={lesson.noteWeekNumber}
        initialNote={lesson.myNoteToday}
        placeholder={
          lesson.sow
            ? 'e.g. Finished Ch 3.3, started Worksheet 1 (items 1–6). Items 7–12 left for homework.'
            : 'e.g. Revised food chains with a worksheet; collected the homework.'
        }
      />
    </PageShell>
  );
}

function CoveringBanner({ context }: { context: CoveringLesson['context'] }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-brand-indigo-soft bg-accent px-4 py-3 text-sm text-brand-indigo-deep">
      <UserRoundPlus className="size-4.5 shrink-0" aria-hidden />
      <p>
        You&rsquo;re covering{' '}
        <b className="font-semibold">
          {context.sectionName} · {context.subjectName}
        </b>{' '}
        today, {formatWeekdayDay(context.today)}
        {context.coveredTeacherName
          ? `, for ${context.coveredTeacherName}.`
          : '.'}
      </p>
    </div>
  );
}

function NoScheme() {
  return (
    <Card className="items-start gap-2.5 px-7 py-7">
      <h1 className="font-serif text-[26px] font-semibold leading-tight tracking-tight text-foreground">
        There&rsquo;s no approved scheme of work for this class yet.
      </h1>
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        There&rsquo;s nothing in the SIS to say what this week&rsquo;s lesson
        is. Ask the subject teacher or the subject head. Whatever you teach,
        record it below so the teacher can pick up from there.
      </p>
    </Card>
  );
}

/** "was adjusted", "was delayed", "had extra activities". */
function optionPhrase(o: CheckOption): string {
  return o === 'extra'
    ? `had ${CHECK_LABELS.extra.toLowerCase()}`
    : `was ${CHECK_LABELS[o].toLowerCase()}`;
}

function lastWeekLine(last: NonNullable<CoveringLesson['lastWeek']>): string {
  const n = last.weekNumber;
  switch (last.mark) {
    case 'note':
      return `Week ${n} ${last.options.map(optionPhrase).join(' and ')}${
        last.notes.length > 0 ? ':' : '.'
      }`;
    case 'ok':
      return `Week ${n} went as planned.`;
    case 'missed':
      return `Week ${n} wasn't checked by the subject teacher.`;
    case 'todo':
      return `Week ${n} hasn't been checked yet.`;
  }
}

function Lesson({ lesson }: { lesson: CoveringLesson }) {
  const { week, lastWeek, sow } = lesson;
  if (!sow) return null;
  const details = week
    ? [
        { label: 'Learning outcomes', html: week.learningOutcomes },
        { label: 'Activities', html: week.activities },
        { label: 'Assessment this week', html: week.assessment },
      ].filter((d) => d.html && !isEmptyRichText(d.html))
    : [];

  return (
    <>
      <header className="space-y-2">
        {week ? (
          <>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {week.isNext ? 'Next week’s lesson' : 'This week’s lesson'} · Week{' '}
              {week.weekNumber} of {week.weekCount}
            </p>
            <h1 className="font-serif text-[30px] font-semibold leading-[1.15] tracking-tight text-foreground">
              {week.topic || `Week ${week.weekNumber}`}
            </h1>
          </>
        ) : (
          <h1 className="font-serif text-[26px] font-semibold leading-tight tracking-tight text-foreground">
            There&rsquo;s no lesson planned for this week.
          </h1>
        )}
        {lesson.events.length > 0 && (
          <p className="flex items-start gap-1.5 text-[13px] text-brand-amber">
            <CalendarDays className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{lesson.events.join(' · ')}</span>
          </p>
        )}
      </header>

      <Card className="gap-4 px-5 py-5 text-sm leading-relaxed text-ink-2">
        {week && details.length === 0 && (
          <p className="text-muted-foreground">
            The scheme of work has no details for this week.
          </p>
        )}
        {details.map((d) => (
          <div key={d.label}>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">
              {d.label}
            </p>
            <RichText html={d.html as string} className="text-sm" />
          </div>
        ))}

        {lastWeek && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              Last week in this class
            </p>
            <p>{lastWeekLine(lastWeek)}</p>
            {lastWeek.notes.map((n, i) => (
              <RichText
                key={i}
                html={n}
                className="border-l-2 border-brand-amber/40 pl-3 text-sm text-ink-2"
              />
            ))}
            {lastWeek.reliefNotes.map((r, i) => (
              <ReliefNoteLine
                key={`r-${i}`}
                taughtOn={r.taughtOn}
                name={r.name}
                note={r.note}
              />
            ))}
          </div>
        )}

        <Link
          href={`/classroom/sow/${sow.id}`}
          className="text-[13px] font-medium text-primary hover:underline"
        >
          Open the whole term&rsquo;s scheme of work
        </Link>
      </Card>
    </>
  );
}
