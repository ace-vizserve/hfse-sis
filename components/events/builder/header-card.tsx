'use client';

import type { ReactNode } from 'react';

import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { formatEventDate } from '@/lib/events/display';
import type { EventDetails } from '@/lib/events/event';
import { cn } from '@/lib/utils';

// What parents read about the event, edited in place: the title and
// description are typed straight into the card, and each detail chip opens a
// small editor. Who it is for, registration times, how parents answer and the
// link are settings (the cog on the top bar), not shown here.

type Props = {
  details: EventDetails;
  onChange: (next: EventDetails) => void;
  /** Why the latest edit could not be saved, if it could not. */
  problem: string | null;
};

function Chip({
  name,
  value,
  children,
  wide,
}: {
  name: string;
  value: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Edit ${name.toLowerCase()}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-muted/50 px-2.5 py-1 text-left text-[13px] transition-colors hover:border-brand-indigo-soft hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:border-brand-indigo-soft data-[state=open]:bg-accent"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">
            {name}
          </span>
          <span className="text-foreground">{value || 'Not set'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('space-y-3', wide ? 'w-[420px]' : 'w-72')}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function HeaderCard({ details, onChange, problem }: Props) {
  const set = (patch: Partial<EventDetails>) =>
    onChange({ ...details, ...patch });

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="h-2 bg-gradient-to-br from-brand-indigo to-brand-navy" />
      <div className="flex flex-col gap-4 px-8 py-6">
        <div className="flex items-start justify-between gap-4">
          <Input
            aria-label="Event title"
            value={details.title}
            maxLength={120}
            placeholder="Give the event a title"
            onChange={(e) => set({ title: e.target.value })}
            className="h-auto min-w-0 flex-1 border-transparent bg-transparent px-0 font-serif text-[34px] font-semibold leading-[1.1] tracking-tight shadow-none hover:border-hairline focus-visible:px-2 md:text-[34px]"
          />
          <span className="mt-3 hidden shrink-0 text-xs text-muted-foreground sm:block">
            Click any detail to edit it
          </span>
        </div>
        <Textarea
          aria-label="Event description"
          value={details.description}
          maxLength={4000}
          rows={2}
          placeholder="Tell parents what this event is, in a sentence or two."
          onChange={(e) => set({ description: e.target.value })}
          className="field-sizing-content min-h-0 resize-none border-transparent bg-transparent px-0 text-[15px] leading-relaxed text-ink-2 shadow-none hover:border-hairline focus-visible:px-2"
        />

        <div className="flex flex-wrap gap-2">
          <Chip
            name="Dates"
            value={formatEventDate(details.startsOn, details.endsOn ?? null)}
          >
            <div className="space-y-1.5">
              <Label>Starts</Label>
              <DatePicker
                value={details.startsOn}
                allowClear={false}
                onChange={(d) => d && set({ startsOn: d })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ends (leave empty for a one-day event)</Label>
              <DatePicker
                value={details.endsOn ?? ''}
                onChange={(d) => set({ endsOn: d || null })}
              />
            </div>
          </Chip>
          <Chip name="Time" value={details.timeLabel}>
            <div className="space-y-1.5">
              <Label htmlFor="event-time">What time is it?</Label>
              <Input
                id="event-time"
                value={details.timeLabel}
                maxLength={60}
                placeholder="8:00 am to 12:00 nn"
                onChange={(e) => set({ timeLabel: e.target.value })}
              />
            </div>
          </Chip>
          <Chip name="Venue" value={details.venue}>
            <div className="space-y-1.5">
              <Label htmlFor="event-venue">Where is it?</Label>
              <Input
                id="event-venue"
                value={details.venue}
                maxLength={120}
                placeholder="Singapore Discovery Centre"
                onChange={(e) => set({ venue: e.target.value })}
              />
            </div>
          </Chip>
        </div>

        {problem ? (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : null}
      </div>
    </section>
  );
}
