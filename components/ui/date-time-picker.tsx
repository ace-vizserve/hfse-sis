'use client';

import * as React from 'react';
import { CalendarIcon, Clock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * DateTimePicker — popover calendar + time input.
 *
 * Replacement for native `<Input type="datetime-local">`. Handles
 * round-tripping to an ISO string while showing the value in the user's
 * local timezone (same behavior as the native control, just with the
 * polished shadcn look).
 *
 * Value is an ISO 8601 UTC string (what the server expects). Empty string
 * represents "no value yet".
 */
export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick a date and time',
  id,
  disabled,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const parsed = value ? new Date(value) : null;

  // Local time representation used by the calendar + time input.
  const [draftDate, setDraftDate] = React.useState<Date | undefined>(
    parsed ?? undefined,
  );
  const [draftTime, setDraftTime] = React.useState<string>(
    parsed ? toLocalTime(parsed) : '09:00',
  );

  // Sync draft state when the controlled value changes externally.
  React.useEffect(() => {
    if (!value) {
      setDraftDate(undefined);
      return;
    }
    const d = new Date(value);
    setDraftDate(d);
    setDraftTime(toLocalTime(d));
  }, [value]);

  function commit(d: Date | undefined, time: string) {
    if (!d) return;
    const [hours, minutes] = time.split(':').map((n) => Number(n) || 0);
    const next = new Date(d);
    next.setHours(hours, minutes, 0, 0);
    onChange(next.toISOString());
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-10 w-full justify-start gap-2 font-normal',
            !parsed && 'text-ink-5',
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 text-ink-4" />
          {parsed ? (
            <span className="font-mono text-[12px] tabular-nums text-foreground">
              {formatDisplay(parsed)}
            </span>
          ) : (
            <span>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={draftDate}
          onSelect={(d) => {
            setDraftDate(d);
            commit(d, draftTime);
          }}
          captionLayout="dropdown"
        />
        <div className="flex items-center gap-2 border-t border-hairline p-3">
          <Clock className="h-4 w-4 text-ink-4" />
          <Input
            type="time"
            value={draftTime}
            onChange={(e) => {
              setDraftTime(e.target.value);
              commit(draftDate, e.target.value);
            }}
            className="h-9 flex-1 font-mono tabular-nums"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function toLocalTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDisplay(d: Date): string {
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
