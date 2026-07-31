import Link from 'next/link';
import {
  ArrowUpRight,
  CalendarCheck,
  CalendarOff,
  Check,
  CircleSlash,
  Clock,
} from 'lucide-react';

import { Card } from '@/components/ui/card';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { cn } from '@/lib/utils';
import {
  formatDayLabel,
  formatTime,
  type AdviserSection,
} from '@/lib/attendance/adviser-dashboard';
import type { AdviserDashboard } from '@/lib/attendance/adviser-dashboard-queries';

// The adviser's view of Attendance. The registrar's dashboard answers "how is
// the school doing"; this answers "is today marked", which is binary and
// expires every morning — so it leads, and the term figures sit under it.
//
// The signature is that the today strip COLLAPSES when everything is in: two
// marked classes become one sentence, not two green cards. Absence of work
// should look like absence rather than turn into more content.

function StateDot({ kind }: { kind: 'done' | 'todo' | 'off' }) {
  const Icon = kind === 'done' ? Check : kind === 'todo' ? Clock : CircleSlash;
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-[30px] shrink-0 items-center justify-center rounded-full',
        kind === 'done' && 'bg-brand-mint/20 text-brand-mint',
        kind === 'todo' && 'bg-brand-amber/15 text-brand-amber',
        kind === 'off' && 'bg-muted text-muted-foreground'
      )}
    >
      <Icon className="size-[15px]" strokeWidth={kind === 'done' ? 2.8 : 2.2} />
    </span>
  );
}

function TodayRow({
  section,
  today,
}: {
  section: AdviserSection;
  today: string;
}) {
  const href = `/attendance/${section.sectionId}?date=${today}`;

  if (section.today.kind === 'marked') {
    const t = section.today.tally;
    return (
      <div className="flex items-center gap-3.5 border-b border-border px-5 py-4 last:border-b-0">
        <StateDot kind="done" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            {section.sectionName}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t.lastMarkedAt && (
              <>
                Marked{' '}
                <span className="font-mono tabular-nums">
                  {formatTime(t.lastMarkedAt)}
                </span>{' '}
                ·{' '}
              </>
            )}
            <span className="font-mono tabular-nums">{t.present}</span> present,{' '}
            <span className="font-mono tabular-nums">{t.late}</span> late,{' '}
            <span className="font-mono tabular-nums">{t.absent}</span> absent
            {t.excused > 0 && (
              <>
                , <span className="font-mono tabular-nums">{t.excused}</span>{' '}
                excused
              </>
            )}
          </p>
        </div>
        <Link
          href={href}
          className="inline-flex h-8 shrink-0 items-center rounded-md border border-hairline-strong px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          View
        </Link>
      </div>
    );
  }

  if (section.today.kind === 'not-a-school-day') {
    return (
      <div className="flex items-center gap-3.5 border-b border-border px-5 py-4 last:border-b-0">
        <StateDot kind="off" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            {section.sectionName}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            No register today.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3.5 border-b border-border px-5 py-4 last:border-b-0">
      <StateDot kind="todo" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold tracking-tight text-foreground">
          {section.sectionName}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{section.rosterCount}</span>{' '}
          {section.rosterCount === 1 ? 'student' : 'students'} · not marked
        </p>
      </div>
      <Link
        href={href}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-gradient-to-b from-brand-indigo-soft to-brand-indigo px-3.5 text-[13px] font-medium text-white shadow-button transition-shadow hover:shadow-button-hover"
      >
        Open register
        <ArrowUpRight className="size-3.5" />
      </Link>
    </div>
  );
}

export function AdviserAttendanceDashboard({
  data,
}: {
  data: AdviserDashboard;
}) {
  const outstanding = data.sections.filter((s) => s.today.kind === 'unmarked');
  const allDone =
    data.isSchoolDay && outstanding.length === 0 && data.sections.length > 0;

  return (
    <div className="space-y-8">
      <header className="flex items-start gap-4 border-b border-border pb-7">
        <div
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl text-white shadow-brand-tile',
            allDone
              ? 'bg-gradient-to-br from-brand-mint to-brand-sky'
              : 'bg-gradient-to-br from-brand-indigo to-brand-navy'
          )}
        >
          {data.isSchoolDay ? (
            <CalendarCheck className="size-5" />
          ) : (
            <CalendarOff className="size-5" />
          )}
        </div>
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            My classes · Attendance
          </p>
          <h1 className="mt-2 font-serif text-[29px] font-semibold leading-[1.08] tracking-tight text-foreground md:text-[32px]">
            {data.headline}
          </h1>
          {data.subhead && (
            <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              {data.subhead}
            </p>
          )}
        </div>
      </header>

      {/* Today. Collapsed to one line when there is nothing to do — the whole
          point of the surface is that a good morning is a short page. */}
      <Card className="gap-0 overflow-hidden p-0">
        {allDone ? (
          <div className="flex items-center gap-3 px-5 py-[18px]">
            <StateDot kind="done" />
            <p className="text-sm text-ink-2">
              {data.sections.map((s) => s.sectionName).join(' and ')}{' '}
              {data.sections.length === 1 ? 'is' : 'are'} in for today.
            </p>
          </div>
        ) : !data.isSchoolDay ? (
          <div className="flex items-center gap-3 px-5 py-[18px]">
            <StateDot kind="off" />
            <p className="text-sm text-ink-2">
              {data.holidayLabel ? (
                <>
                  <span className="font-semibold text-foreground">
                    {data.holidayLabel}
                  </span>{' '}
                  — no register today.
                </>
              ) : (
                'Not a school day — no register today.'
              )}
              {data.nextSchoolDay && (
                <> Next school day is {formatDayLabel(data.nextSchoolDay)}.</>
              )}
            </p>
          </div>
        ) : (
          data.sections.map((s) => (
            <TodayRow key={s.sectionId} section={s} today={data.today} />
          ))
        )}
      </Card>

      {/* This term — a weekly reading, so it sits below today. */}
      <section className="space-y-3">
        <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
          This term
        </h2>
        <Card className="gap-0 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-muted/40">
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold text-muted-foreground">
                    Class
                  </th>
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold text-muted-foreground">
                    Attendance
                  </th>
                  <th className="whitespace-nowrap px-5 py-2.5 text-left text-[11px] font-semibold text-muted-foreground">
                    Present · late · absent · excused
                  </th>
                  <th className="px-5 py-2.5 text-right text-[11px] font-semibold text-muted-foreground">
                    School days
                  </th>
                  <th className="px-5 py-2.5 text-right text-[11px] font-semibold text-muted-foreground">
                    Perfect
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.sections.map((s) => {
                  const sum = data.summaries[s.sectionId];
                  const pct = sum?.averageAttendancePct ?? null;
                  return (
                    <tr
                      key={s.sectionId}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="px-5 py-3.5">
                        <IdentifierLink
                          href={`/attendance/${s.sectionId}/summary`}
                          className="text-sm"
                        >
                          {s.sectionName}
                        </IdentifierLink>
                        <div className="text-xs text-muted-foreground">
                          {s.rosterCount}{' '}
                          {s.rosterCount === 1 ? 'student' : 'students'}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {pct == null ? (
                          <span className="text-xs text-muted-foreground">
                            Nothing marked yet
                          </span>
                        ) : (
                          <>
                            <span
                              className={cn(
                                'font-mono text-[15px] font-semibold tabular-nums tracking-tight',
                                pct >= 95
                                  ? 'text-brand-mint'
                                  : pct >= 90
                                    ? 'text-foreground'
                                    : 'text-brand-amber'
                              )}
                            >
                              {pct.toFixed(1)}%
                            </span>
                            <div className="mt-1.5 h-[5px] w-[130px] overflow-hidden rounded-full bg-muted">
                              <span
                                className="block h-full rounded-full bg-gradient-to-r from-brand-mint to-brand-sky"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {sum
                          ? `${sum.totalDaysPresent} · ${sum.totalDaysLate} · ${sum.totalDaysAbsent} · ${sum.totalDaysExcused}`
                          : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                        {sum?.schoolDays ?? 0}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                        {sum?.perfectAttendanceCount ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <WorthALook data={data} />
    </div>
  );
}

/** Days that slipped, and students who have spent a leave allowance. Renders
 *  nothing at all when both are empty — an empty card would be noise. */
function WorthALook({ data }: { data: AdviserDashboard }) {
  const withGaps = data.sections.filter((s) => s.unmarked.length > 0);
  if (withGaps.length === 0 && data.quotaRisks.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
        Worth a look
      </h2>
      <Card className="gap-0 overflow-hidden p-0">
        {withGaps.map((s) => (
          <div
            key={s.sectionId}
            className="flex items-start gap-3 border-b border-border px-5 py-3.5 last:border-b-0"
          >
            <span
              aria-hidden
              className="mt-[7px] size-[7px] shrink-0 rounded-full bg-brand-amber"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">
                {s.unmarked.length}{' '}
                {s.unmarked.length === 1
                  ? 'school day was'
                  : 'school days were'}{' '}
                never marked
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {s.sectionName} —{' '}
                {s.unmarked.slice(0, 4).map(formatDayLabel).join(', ')}
                {s.unmarked.length > 4 && ` and ${s.unmarked.length - 4} more`}
              </p>
            </div>
            <Link
              href={`/attendance/${s.sectionId}?date=${s.unmarked[0]}`}
              className="shrink-0 text-[13px] font-medium text-primary hover:underline hover:underline-offset-4"
            >
              Backfill
            </Link>
          </div>
        ))}
        {data.quotaRisks.map((r) => (
          <div
            key={`${r.kind}-${r.studentId}`}
            className="flex items-start gap-3 border-b border-border px-5 py-3.5 last:border-b-0"
          >
            <span
              aria-hidden
              className="mt-[7px] size-[7px] shrink-0 rounded-full bg-destructive"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">
                {r.studentName} has used {r.used} of {r.allowance}{' '}
                {r.kind === 'compassionate' ? 'compassionate' : 'vacation'} days
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {r.sectionName} · over the{' '}
                {r.kind === 'compassionate' ? 'yearly' : 'term'} allowance
              </p>
            </div>
          </div>
        ))}
      </Card>
    </section>
  );
}
