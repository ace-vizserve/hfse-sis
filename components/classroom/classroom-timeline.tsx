'use client';

import * as React from 'react';
import { History } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { auditActionLabel, auditContextSummary } from '@/lib/audit/humanize';
import {
  countByKind,
  groupTimeline,
  kindForAction,
  type TimelineEvent,
  type TimelineKind,
} from '@/lib/classroom/timeline';
import { cn } from '@/lib/utils';

// "What happened in this class." Previously ~50 audit rows in one flat slab
// whose loudest element — a coloured pill — was usually the SAME WORD forty
// times running, over rows that mostly carried no detail at all.
//
// The fix is to treat repetition as repetition: seven write-ups saved back to
// back by one person is ONE row with a count and a time span, not seven. The
// day becomes a sticky heading so rows keep only a time, and the badge becomes
// a dot on a spine so colour still says what KIND of event this is without
// shouting the same word down the page.
//
// Labels and summaries still go through the shared humanizer (KD #121) — never
// a hand-rolled label, never JSON.stringify(context).

const KIND_LABEL: Record<TimelineKind, string> = {
  grades: 'Grades',
  writeups: 'Write-ups',
  roster: 'Roster',
  sheets: 'Sheets',
  other: 'Other',
};

/** Dot colour per kind. Single source — the chip and the dot read this map. */
const KIND_DOT: Record<TimelineKind, string> = {
  grades: 'bg-brand-indigo',
  writeups: 'bg-brand-mint',
  roster: 'bg-brand-amber',
  sheets: 'bg-brand-sky',
  other: 'bg-ink-5',
};

const CHIP_ORDER: TimelineKind[] = [
  'grades',
  'writeups',
  'roster',
  'sheets',
  'other',
];

function initialsOf(name: string): string {
  return name
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Singapore',
  });
}

/** `Today` / `Yesterday` / `Tue 22 Jul`, in Singapore time. */
function dayLabel(date: string, todaySg: string): string {
  if (date === todaySg) return 'Today';
  const d = new Date(`${date}T00:00:00+08:00`);
  const yesterday = new Date(`${todaySg}T00:00:00+08:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    date ===
    yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })
  ) {
    return 'Yesterday';
  }
  return d.toLocaleDateString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Singapore',
  });
}

export type ClassroomTimelineProps = {
  events: TimelineEvent[];
  /** actor email → display name. Missing entries fall back to the email. */
  actorNames: Record<string, string>;
  /** `yyyy-MM-dd` in SGT, resolved on the server so the label can't disagree
   *  with the grouping. */
  todaySg: string;
  limit: number;
};

export function ClassroomTimeline({
  events,
  actorNames,
  todaySg,
  limit,
}: ClassroomTimelineProps) {
  const [active, setActive] = React.useState<TimelineKind | null>(null);

  const counts = React.useMemo(() => countByKind(events), [events]);
  const visible = React.useMemo(
    () =>
      active
        ? events.filter((e) => kindForAction(e.action) === active)
        : events,
    [events, active]
  );
  const days = React.useMemo(() => groupTimeline(visible), [visible]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <History className="size-4" />
        </div>
        <p>Nothing recorded for this class yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Timeline
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Most recent {events.length}
          {events.length === limit ? '+' : ''}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <FilterChip
          label="All"
          count={events.length}
          on={active === null}
          onClick={() => setActive(null)}
        />
        {CHIP_ORDER.filter((k) => counts[k] > 0).map((k) => (
          <FilterChip
            key={k}
            label={KIND_LABEL[k]}
            count={counts[k]}
            on={active === k}
            onClick={() => setActive(active === k ? null : k)}
          />
        ))}
      </div>

      <Card className="gap-0 overflow-hidden p-0">
        {days.map((day) => (
          <div key={day.date}>
            <div className="sticky top-0 z-[2] flex items-center gap-2.5 border-b border-border bg-muted/70 px-[18px] py-2.5 backdrop-blur">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                {dayLabel(day.date, todaySg)}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-ink-5">
                {day.eventCount} {day.eventCount === 1 ? 'event' : 'events'}
              </span>
            </div>
            {day.runs.map((run) => (
              <RunRow key={run.key} run={run} actorNames={actorNames} />
            ))}
          </div>
        ))}
        {days.length === 0 && (
          <p className="px-[18px] py-6 text-center text-sm text-muted-foreground">
            No {active ? KIND_LABEL[active].toLowerCase() : ''} events in this
            window.
          </p>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        The most recent {limit} events for this class — sheet activity, grade
        changes, roster changes, and write-up saves. This is a recent window,
        not the full history.
      </p>
    </div>
  );
}

function FilterChip({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
        on
          ? 'border-brand-indigo/40 bg-accent text-accent-foreground'
          : 'border-hairline-strong bg-card text-ink-3 hover:text-foreground'
      )}
    >
      {label}
      <span className="font-mono text-[10.5px] tabular-nums opacity-70">
        {count}
      </span>
    </button>
  );
}

function RunRow({
  run,
  actorNames,
}: {
  run: ReturnType<typeof groupTimeline>[number]['runs'][number];
  actorNames: Record<string, string>;
}) {
  const [open, setOpen] = React.useState(false);
  const actor = actorNames[run.actorEmail] ?? run.actorEmail;
  const isRun = run.events.length > 1;

  // The humanizer returns '—' when a context carries nothing summarisable
  // (KD #121). A dash is not information — omit the line instead of padding
  // the row with one.
  const summary = auditContextSummary(run.action, run.events[0].context);
  const detail = summary && summary !== '—' ? summary : null;

  const timeLabel = isRun
    ? `${timeOf(run.startedAt)} – ${timeOf(run.endedAt)}`
    : timeOf(run.endedAt);

  return (
    <div className="relative flex gap-3.5 px-[18px] py-3">
      {/* The spine — what makes this read as a timeline rather than a list
          that happens to be in date order. */}
      <span
        aria-hidden
        className="absolute bottom-0 left-[30px] top-0 w-px bg-border"
      />
      <span
        aria-hidden
        className={cn(
          'relative z-[1] mt-[7px] ml-2 size-[9px] shrink-0 rounded-full ring-[3px] ring-card',
          KIND_DOT[run.kind]
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2.5">
          <span className="text-sm font-medium text-foreground">
            {auditActionLabel(run.action)}
          </span>
          {isRun && (
            <span className="rounded-full bg-muted px-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
              ×{run.events.length}
            </span>
          )}
          <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-ink-5">
            {timeLabel}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo-soft to-brand-indigo text-[8.5px] font-bold text-white"
            >
              {initialsOf(actor)}
            </span>
            <span className="text-xs text-ink-3">{actor}</span>
          </span>
          {detail && (
            <>
              <span className="text-hairline-strong">·</span>
              <span className="text-xs text-muted-foreground">{detail}</span>
            </>
          )}
        </div>

        {isRun && (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="mt-1.5 text-xs text-primary hover:underline hover:underline-offset-4"
            >
              {open ? 'Hide entries' : `Show ${run.events.length} entries`}
            </button>
            {open && (
              <ul className="mt-2 space-y-1.5 border-l border-border pl-3">
                {run.events.map((e) => {
                  const each = auditContextSummary(e.action, e.context);
                  return (
                    <li key={e.id} className="flex gap-2.5 text-xs text-ink-3">
                      <span className="min-w-[38px] font-mono text-[10.5px] tabular-nums text-ink-5">
                        {timeOf(e.createdAt)}
                      </span>
                      <span className="min-w-0">
                        {each && each !== '—'
                          ? each
                          : auditActionLabel(e.action)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
