'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Searchable, grouped multi-select — the SIS copy of the parent portal's
// learning-needs picker (app-online-admission src/components/ui/
// additional-learning-needs-combo-box.tsx): a popover list with a search box,
// grouped items with a tick, and the picks shown as removable chips.
//
// The value is the list itself; joining it into the one text column the portal
// writes is the caller's job. A pick that is not on the list (an older free-text
// answer) is kept and shown as a chip like any other, so nothing is dropped.
//
// `modal` on the Popover for the same reason as CountryCombobox: inside a
// Sheet, a non-modal popover's list cannot be scrolled.
export const MultiSelectCombobox = React.forwardRef<
  HTMLButtonElement,
  {
    value: string[];
    onChange: (next: string[]) => void;
    groups: readonly { group: string; items: readonly string[] }[];
    placeholder?: string;
    searchPlaceholder?: string;
  } & Omit<
    React.ComponentProps<typeof Button>,
    'value' | 'onChange' | 'variant' | 'role'
  >
>(function MultiSelectCombobox(
  {
    value,
    onChange,
    groups,
    placeholder = 'Select…',
    searchPlaceholder = 'Search…',
    className,
    ...rest
  },
  ref
) {
  const [open, setOpen] = React.useState(false);

  function toggle(item: string) {
    onChange(
      value.includes(item) ? value.filter((v) => v !== item) : [...value, item]
    );
  }

  return (
    <div className="space-y-2">
      <Popover modal open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn('h-9 w-full justify-between font-normal', className)}
            {...rest}
          >
            <span className="truncate">
              {value.length === 0 ? placeholder : `${value.length} selected`}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>Nothing matches.</CommandEmpty>
              {groups.map((g) => (
                <CommandGroup key={g.group} heading={g.group}>
                  {g.items.map((item) => (
                    <CommandItem
                      key={item}
                      value={item}
                      onSelect={() => toggle(item)}
                    >
                      {item}
                      <Check
                        className={cn(
                          'ml-auto size-4',
                          value.includes(item) ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item) => (
            <Badge
              key={item}
              variant="outline"
              className="gap-1 border-brand-indigo/30 bg-brand-indigo/5 pr-1 text-foreground"
            >
              {item}
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== item))}
                className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/30"
                aria-label={`Remove ${item}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
});
