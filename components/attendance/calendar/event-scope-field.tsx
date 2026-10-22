'use client';

// The pickers behind "Who is it for?" on the calendar's add/edit dialog.
//
// The dialog owns ONE dropdown (Whole school / Primary / Secondary / Specific
// levels… / Specific classes…) for every entry type. These are what it reveals:
//   • LevelPicker — "Specific levels…": the P1–P6 / S1–S4 chip rows. Works for
//     closures too since migration 196 (`school_calendar.audience` takes a
//     level code), as well as for informational events (`levels`, mig. 158).
//   • ClassPicker — "Specific classes…": informational events only. No closure
//     has ever been per-class.
//
// Chips rather than a dropdown: ten fixed values, and the common answers are
// one level or a run of them. A dropdown hides the whole vocabulary behind a
// click and makes Leadership Camp (P4 through S4) seven clicks with the list
// reopening each time.
//
// Design system: ToggleGroup variant="outline" already carries the accent wash
// §9.1 reserves for configuration on its on-state, so the chips need no colour
// of their own. Level codes are set in `font-mono` per §3.3 — they are codes.
import { useQuery } from '@tanstack/react-query';
import { Check, Users } from 'lucide-react';
import { useState } from 'react';

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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  describeClassScope,
  describeLevelScope,
  PRIMARY_LEVEL_CODES,
  SECONDARY_LEVEL_CODES,
  sortLevels,
  spansBothBands,
} from '@/lib/attendance/event-scope';
import { apiFetch } from '@/lib/query/fetcher';
import { cn } from '@/lib/utils';
import type { LevelCode } from '@/lib/sis/levels';

type SectionOption = {
  id: string;
  name: string;
  level: { code: string } | null;
};

/** "Specific levels…" — both chip rows and the sentence that reads them back. */
export function LevelPicker({
  levels,
  onChange,
  mixedNote = false,
}: {
  levels: LevelCode[];
  onChange: (next: LevelCode[]) => void;
  /** Show the "spans both halves" note (informational events only). */
  mixedNote?: boolean;
}) {
  const toggle = (next: string[]) => onChange(sortLevels(next as LevelCode[]));
  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <ScopeBand
          name="Primary"
          codes={PRIMARY_LEVEL_CODES}
          value={levels}
          onValueChange={toggle}
        />
        <ScopeBand
          name="Secondary"
          codes={SECONDARY_LEVEL_CODES}
          value={levels}
          onValueChange={toggle}
        />
      </div>
      <p className="text-[13px] text-muted-foreground">
        {levels.length === 0 ? (
          'Pick at least one level.'
        ) : (
          <span className="text-ink-2">{describeLevelScope(levels)}</span>
        )}
      </p>
      {mixedNote && spansBothBands(levels) ? (
        // Events only: an event's `audience` is three-valued, so a scope that
        // straddles both halves is stored as 'all' beside its levels. Said out
        // loud rather than stored quietly — a scope nobody could see was the
        // reason this field exists. (Closures write one row per level, so
        // they never need this.)
        <p className="rounded-md border border-brand-indigo-soft bg-accent px-3 py-2 text-[12.5px] leading-relaxed text-accent-foreground">
          Screens that only understand primary or secondary will show this to
          the whole school. The levels you picked are still saved, and every
          screen will use them once it is updated.
        </p>
      ) : null}
    </div>
  );
}

/** "Specific classes…" — a searchable class list (informational events only). */
export function ClassPicker({
  sectionIds,
  onChange,
}: {
  sectionIds: string[];
  onChange: (next: string[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  // Mounted only once someone picks "Specific classes…" — nothing in AY2025 or
  // AY2026 is scoped this tightly, so the list would otherwise be loaded on
  // every event anyone adds.
  const sectionsQuery = useQuery({
    queryKey: ['sections', 'for-event-scope'],
    queryFn: () => apiFetch<{ sections: SectionOption[] }>('/api/sections'),
    staleTime: 5 * 60_000,
  });
  const sections = sectionsQuery.data?.sections ?? [];

  function toggleSection(id: string) {
    onChange(
      sectionIds.includes(id)
        ? sectionIds.filter((s) => s !== id)
        : [...sectionIds, id]
    );
  }

  return (
    <div className="space-y-2">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full justify-start font-normal"
          >
            <Users className="size-4" />
            {sectionIds.length === 0
              ? 'Choose classes'
              : describeClassScope(sectionIds.length)}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Search classes…" />
            <CommandList>
              <CommandEmpty>
                {sectionsQuery.isPending
                  ? 'Loading classes…'
                  : 'No class by that name.'}
              </CommandEmpty>
              <CommandGroup>
                {sections.map((s) => {
                  const on = sectionIds.includes(s.id);
                  return (
                    <CommandItem
                      key={s.id}
                      value={s.name}
                      onSelect={() => toggleSection(s.id)}
                    >
                      <Check
                        className={cn('size-4', !on && 'opacity-0')}
                        aria-hidden
                      />
                      <span>{s.name}</span>
                      {s.level?.code ? (
                        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                          {s.level.code}
                        </span>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <p className="text-[13px] text-ink-2">
        {sectionIds.length === 0
          ? 'Pick at least one class.'
          : describeClassScope(sectionIds.length)}
      </p>
    </div>
  );
}

/** One half of the school as a row of level chips. */
export function ScopeBand({
  name,
  codes,
  value,
  onValueChange,
}: {
  name: string;
  codes: readonly LevelCode[];
  value: LevelCode[];
  onValueChange: (next: string[]) => void;
}) {
  // The group owns only its own band's codes, so a change here must carry the
  // other band's selection through untouched.
  const others = value.filter((v) => !codes.includes(v));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        {name}
      </span>
      <ToggleGroup
        type="multiple"
        variant="outline"
        size="sm"
        value={value.filter((v) => codes.includes(v))}
        onValueChange={(next) => onValueChange([...others, ...next])}
        className="flex-wrap"
      >
        {codes.map((code) => (
          <ToggleGroupItem
            key={code}
            value={code}
            aria-label={code}
            className="px-2.5 font-mono text-xs"
          >
            {code}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
