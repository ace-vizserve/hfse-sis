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
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export const isDateFilter = (v: string | null | undefined): v is DateFilter =>
  DATE_OPTIONS.some((o) => o.value === v);

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
    value === 'custom'
      ? [custom.from || 'Any date', custom.to || 'Any date'].join(' – ')
      : picked?.label;
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
                className="rounded-sm px-1.5 font-normal"
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
