'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, GraduationCap, User } from 'lucide-react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Card } from '@/components/ui/card';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';

// Groups the four dated lists that the HFSE sheet shows as header boxes.
// Public/School holidays come from school_calendar day_type; School Events
// (SE) and Examinations (EX) come from calendar_events category.
type DatedItem = { date: string; label: string };

function formatRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10))
    ).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
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
      .map((c) => ({ date: c.date, label: c.label ?? 'Public holiday' }));
    const schoolHolidays: DatedItem[] = calendar
      .filter((c) => c.dayType === 'school_holiday')
      .map((c) => ({ date: c.date, label: c.label ?? 'School holiday' }));
    const examinations: DatedItem[] = events
      .filter((e) => e.category === 'term_exam')
      .map((e) => ({ date: e.startDate, label: e.label }));
    const schoolEvents: DatedItem[] = events
      .filter((e) => e.category !== 'term_exam')
      .map((e) => ({ date: e.startDate, label: e.label }));
    return { publicHolidays, schoolHolidays, examinations, schoolEvents };
  }, [calendar, events]);

  const totalDated =
    lists.publicHolidays.length +
    lists.schoolHolidays.length +
    lists.examinations.length +
    lists.schoolEvents.length;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <Meta icon={GraduationCap} label="Course" value={courseLabel} />
        <Meta label="Section" value={sectionName} />
        <Meta label="Term" value={term.label} />
        {scheduleLabel && <Meta label="Schedule" value={scheduleLabel} />}
        <Meta
          icon={User}
          label="Form Class Adviser"
          value={formAdviser ?? 'Unassigned'}
        />
      </div>

      <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
        <CollapsibleTrigger className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground">
          <CalendarDays className="size-3.5" aria-hidden />
          Term calendar
          <span className="text-muted-foreground/70">({totalDated})</span>
          <ChevronDown
            className={
              'size-3.5 transition-transform ' + (open ? 'rotate-180' : '')
            }
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DateList title="School Events" items={lists.schoolEvents} />
          <DateList title="School Holidays" items={lists.schoolHolidays} />
          <DateList title="Public Holidays" items={lists.publicHolidays} />
          <DateList title="Examinations" items={lists.examinations} />
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function DateList({ title, items }: { title: string; items: DatedItem[] }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-indigo-deep">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <ul className="space-y-1 text-xs text-foreground">
          {items.map((it, i) => (
            <li key={`${it.date}-${i}`} className="flex gap-2">
              <span className="shrink-0 font-mono text-muted-foreground">
                {formatRange(it.date, it.date)}
              </span>
              <span className="truncate" title={it.label}>
                {it.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
