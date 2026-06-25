'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, ClipboardCheck } from 'lucide-react';

import { COLUMN_TAG_COLOR } from '@/components/attendance/column-tags';
import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import type { ColumnTagCode } from '@/lib/attendance/sheet-columns';

// The masthead of a section's attendance register: a letterhead lockup
// (gradient tile + serif virtue name under a course·term eyebrow), a muted meta
// strip (form adviser / schedule), and a tucked-away "Term calendar" key whose
// four list headers carry the SAME SH/SE/PH/EX chips as the grid's date columns
// (a true legend tie — §10). Dated lists: Public/School holidays from
// school_calendar.day_type; School events (SE) + examinations (EX) from
// calendar_events.category.

type DatedItem = { start: string; end: string; label: string };

// Locale-independent date formatting (matches the export; avoids ICU drift).
const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function fmtDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTH_ABBR[Number(iso.slice(5, 7)) - 1]}`;
}

function formatRange(start: string, end: string): string {
  return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

export default function SheetContextCard({
  term,
  courseLabel,
  sectionName,
  formAdviser,
  scheduleLabel,
  calendar,
  events,
}: {
  term: { label: string };
  courseLabel: string;
  sectionName: string;
  formAdviser: string | null;
  scheduleLabel: string | null;
  calendar: SchoolCalendarRow[];
  events: CalendarEventRow[];
}) {
  const [open, setOpen] = useState(false);

  const lists = useMemo(() => {
    const publicHolidays: DatedItem[] = calendar
      .filter((c) => c.dayType === 'public_holiday')
      .map((c) => ({
        start: c.date,
        end: c.date,
        label: c.label ?? 'Public holiday',
      }));
    const schoolHolidays: DatedItem[] = calendar
      .filter((c) => c.dayType === 'school_holiday')
      .map((c) => ({
        start: c.date,
        end: c.date,
        label: c.label ?? 'School holiday',
      }));
    const examinations: DatedItem[] = events
      .filter((e) => e.category === 'term_exam')
      .map((e) => ({ start: e.startDate, end: e.endDate, label: e.label }));
    const schoolEvents: DatedItem[] = events
      .filter((e) => e.category !== 'term_exam')
      .map((e) => ({ start: e.startDate, end: e.endDate, label: e.label }));
    return { publicHolidays, schoolHolidays, examinations, schoolEvents };
  }, [calendar, events]);

  const totalDated =
    lists.publicHolidays.length +
    lists.schoolHolidays.length +
    lists.examinations.length +
    lists.schoolEvents.length;

  const eyebrow = [courseLabel, term.label].filter(Boolean).join(' · ');

  return (
    <Card className="@container/card gap-0 overflow-hidden py-0">
      {/* Masthead lockup */}
      <CardHeader className="gap-1 border-b border-border py-5">
        {eyebrow && (
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {eyebrow}
          </CardDescription>
        )}
        <CardTitle className="font-serif text-[22px] font-semibold tracking-tight text-foreground">
          {sectionName}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <ClipboardCheck className="size-4" aria-hidden />
          </div>
        </CardAction>
      </CardHeader>

      {/* Meta strip */}
      <div className="flex flex-wrap gap-x-10 gap-y-3 border-b border-border bg-muted/30 px-6 py-3">
        <MetaBlock
          label="Form Class Adviser"
          value={formAdviser ?? 'Unassigned'}
          muted={!formAdviser}
        />
        {scheduleLabel && <MetaBlock label="Schedule" value={scheduleLabel} />}
      </div>

      {/* Term calendar — a quiet, expandable key (hidden when the term has none) */}
      {totalDated > 0 && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="flex w-full items-center gap-2 px-6 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
            <CalendarDays
              className="size-3.5 text-muted-foreground"
              aria-hidden
            />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Term calendar
            </span>
            <Badge
              variant="secondary"
              className="h-5 px-1.5 font-mono text-[10px] tabular-nums"
            >
              {totalDated}
            </Badge>
            <ChevronDown
              className={
                'ml-auto size-4 text-muted-foreground transition-transform ' +
                (open ? 'rotate-180' : '')
              }
              aria-hidden
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            {/* gap-px over bg-border draws hairline rules between the four cells */}
            <div className="grid grid-cols-1 gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              <DateList
                tag="SE"
                title="School events"
                items={lists.schoolEvents}
              />
              <DateList
                tag="SH"
                title="School holidays"
                items={lists.schoolHolidays}
              />
              <DateList
                tag="PH"
                title="Public holidays"
                items={lists.publicHolidays}
              />
              <DateList
                tag="EX"
                title="Examinations"
                items={lists.examinations}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}

function MetaBlock({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span
        className={
          'text-sm font-medium ' +
          (muted ? 'italic text-muted-foreground' : 'text-foreground')
        }
      >
        {value}
      </span>
    </div>
  );
}

function DateList({
  tag,
  title,
  items,
}: {
  tag: ColumnTagCode;
  title: string;
  items: DatedItem[];
}) {
  return (
    <div className="bg-card px-5 py-4">
      <div className="mb-2 flex items-center gap-2">
        <ChartLegendChip
          color={COLUMN_TAG_COLOR[tag]}
          label={tag}
          className="px-1 py-px text-[9px] tracking-[0.1em]"
        />
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">
          {title}
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None this term</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={`${it.start}-${i}`} className="flex gap-2 text-xs">
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {formatRange(it.start, it.end)}
              </span>
              <span className="leading-snug text-foreground">{it.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
