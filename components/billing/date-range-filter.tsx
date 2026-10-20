'use client';

import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';

import {
  DATE_OPTIONS,
  type DateFilter,
} from '@/components/billing/customer-transactions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { usePageParams } from '@/components/ui/data-table/use-page-params';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { formatDay } from '@/lib/billing/view';
import { cn } from '@/lib/utils';

export const isDateFilter = (v: string | null | undefined): v is DateFilter =>
  DATE_OPTIONS.some((o) => o.value === v);

const isIsoDay = (v: string | null | undefined): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

type DateParamState = {
  date: DateFilter;
  custom: { from: string; to: string };
};

/** The page params a Date filter state is kept under — `?date=` (left out
 *  for the default), plus `?from=` / `?to=` for a Custom range. */
export function dateParamChanges(
  s: DateParamState,
  fallback: DateFilter
): Record<string, string | null> {
  const custom = s.date === 'custom';
  return {
    date: s.date === fallback ? null : s.date,
    from: custom && s.custom.from ? s.custom.from : null,
    to: custom && s.custom.to ? s.custom.to : null,
  };
}

/**
 * A list's Date filter, kept in the page URL (`?date=`, and `?from=` /
 * `?to=` for Custom) so a stat tile can open it, and a refresh or Back shows
 * the same dates. Picking a date writes the URL; a URL changed from outside
 * (a tile link while the page stays mounted, Back) re-seeds the filter. An
 * unknown `?date=` falls back to `fallback`.
 */
export function useDateFilterParam(
  initial: { date?: string; from?: string; to?: string },
  fallback: DateFilter = 'last-3-months'
) {
  const seed = (): DateParamState => ({
    date: isDateFilter(initial.date) ? initial.date : fallback,
    custom: {
      from: isIsoDay(initial.from) ? initial.from : '',
      to: isIsoDay(initial.to) ? initial.to : '',
    },
  });
  const [state, setState] = React.useState<DateParamState>(seed);
  // The URL this filter last saw, and the ones it wrote that have not come
  // back from the server render yet — those are its own, not a re-seed.
  const urlKey = `${initial.date ?? ''}|${initial.from ?? ''}|${initial.to ?? ''}`;
  const [seenKey, setSeenKey] = React.useState(urlKey);
  const [pending, setPending] = React.useState<string[]>([]);
  if (urlKey !== seenKey) {
    setSeenKey(urlKey);
    const i = pending.indexOf(urlKey);
    if (i >= 0) setPending(pending.slice(i + 1));
    else setState(seed());
  }
  const setPageParams = usePageParams();
  const commit = (next: DateParamState) => {
    setState(next);
    const changes = dateParamChanges(next, fallback);
    const key = `${changes.date ?? ''}|${changes.from ?? ''}|${changes.to ?? ''}`;
    if (key !== seenKey) setPending((p) => [...p, key].slice(-10));
    setPageParams(changes);
  };
  return {
    date: state.date,
    custom: state.custom,
    setDate: (date: DateFilter) => commit({ ...state, date }),
    setCustom: (custom: { from: string; to: string }) =>
      commit({ ...state, custom }),
  };
}

// A list page's Date filter in the SIS's own toolbar look — the dashed chip
// the table's facets use, with the chosen range shown in it. One choice at a
// time (QuickBooks' Date presets); Custom opens a From / To pair underneath.
export function DateRangeFilter({
  value,
  onChange,
  custom,
  onCustomChange,
}: {
  value: DateFilter;
  onChange: (v: DateFilter) => void;
  custom: { from: string; to: string };
  onCustomChange: (c: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const picked = DATE_OPTIONS.find((o) => o.value === value);
  const shown =
    value !== 'custom'
      ? picked?.label
      : custom.from && custom.to
        ? `${formatDay(custom.from)} – ${formatDay(custom.to)}`
        : custom.from
          ? `From ${formatDay(custom.from)}`
          : custom.to
            ? `Until ${formatDay(custom.to)}`
            : 'Custom';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-dashed">
          Date
          {value !== 'all' && (
            <>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              <Badge
                variant="secondary"
                className="rounded-sm px-1.5 font-sans text-xs font-normal normal-case tracking-normal"
              >
                {shown}
              </Badge>
            </>
          )}
          <ChevronDown className="ml-1 h-3 w-3 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              {DATE_OPTIONS.map((o) => (
                <CommandItem
                  key={o.value}
                  onSelect={() => {
                    onChange(o.value);
                    if (o.value !== 'custom') setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 size-4',
                      value === o.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {o.label === 'All' ? 'Any date' : o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {value === 'custom' && (
          <div className="grid gap-3 border-t border-border p-3">
            <Field>
              <FieldLabel htmlFor="date-range-from">From</FieldLabel>
              <DatePicker
                id="date-range-from"
                value={custom.from}
                onChange={(from) => onCustomChange({ ...custom, from })}
                placeholder="Any date"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="date-range-to">To</FieldLabel>
              <DatePicker
                id="date-range-to"
                value={custom.to}
                onChange={(to) => onCustomChange({ ...custom, to })}
                placeholder="Any date"
              />
            </Field>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
