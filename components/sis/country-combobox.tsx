'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';

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
import { COUNTRY_NAMES } from '@/lib/data/countries';
import { cn } from '@/lib/utils';

// Single-select searchable country picker. Stores the country NAME (not a
// demonym, not an ISO code) — matches the admissions portal's own
// LocationSelector, which does `field.onChange(value?.name)`.
//
// A stored value outside COUNTRY_NAMES (a legacy free-text entry, a typo)
// renders as an extra "(current)" item instead of leaving the trigger
// blank — same idiom as edit-profile-sheet.tsx's `kind: 'select'` fallback
// for preferredPaymentScheme/Method. Selecting it is a no-op (it's already
// the value); it exists so the field doesn't look broken/empty.
//
// Forwards `ref` and any extra props through to the trigger <Button> so
// this works correctly inside shadcn's <FormControl> (a Radix Slot that
// clones id/aria-describedby/aria-invalid onto this component's element).
export const CountryCombobox = React.forwardRef<
  HTMLButtonElement,
  {
    value: string | null;
    onChange: (next: string | null) => void;
    className?: string;
  } & Omit<
    React.ComponentProps<typeof Button>,
    'value' | 'onChange' | 'variant' | 'role' | 'className'
  >
>(function CountryCombobox({ value, onChange, className, ...rest }, ref) {
  const [open, setOpen] = React.useState(false);
  const isKnown = value == null || COUNTRY_NAMES.includes(value);

  return (
    // `modal` is load-bearing, not decorative. This combobox is rendered
    // inside the profile/family edit Sheets, and a Radix Sheet locks scrolling
    // via react-remove-scroll, which only exempts its own content subtree. The
    // popover portals to document.body — outside that subtree — so without
    // `modal` the wheel is swallowed and the ~250-item country list appears
    // frozen. Setting it makes the popover manage its own scroll lock and
    // exempt itself. The list's own max-height/overflow was already correct;
    // the CSS was never the problem.
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('h-9 w-full justify-between font-normal', className)}
          {...rest}
        >
          <span className="truncate">{value ?? 'Select country...'}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search country..." />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {value != null && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  <X className="mr-2 size-4" />
                  Clear selection
                </CommandItem>
              )}
              {!isKnown && value && (
                <CommandItem value={value} onSelect={() => setOpen(false)}>
                  {value} (current)
                  <Check className="ml-auto size-4 opacity-100" />
                </CommandItem>
              )}
              {COUNTRY_NAMES.map((name) => (
                <CommandItem
                  key={name}
                  value={name}
                  onSelect={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                >
                  {name}
                  <Check
                    className={cn(
                      'ml-auto size-4',
                      value === name ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
