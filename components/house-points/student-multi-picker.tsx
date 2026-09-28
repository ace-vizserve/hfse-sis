'use client';

import { Check } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { HouseChip } from '@/components/ui/house-chip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { RosterStudent } from '@/lib/house-points/queries';
import type { HouseRow } from '@/lib/sis/houses';
import { cn } from '@/lib/utils';

// Pick several students from the year's enrolled roster — searchable by name,
// class and student number, narrowed by a class filter. Students who are
// already in (`locked`) show ticked and can't be unticked here.
//
// Its own component because a team (Task 10) picks its members the same way
// the "Add students" sheet picks entrants.
//
// cmdk rather than a plain list, after components/discipline/
// file-record-button.tsx: across the whole school, typing beats scrolling
// several hundred rows. `keywords` carries the searchable text so the item's
// `value` can stay the unique section_student id.

const ALL_CLASSES = 'all';

const collator = new Intl.Collator('en-SG', {
  numeric: true,
  sensitivity: 'base',
});

export function StudentMultiPicker({
  roster,
  houses,
  selected,
  locked,
  onChange,
  className,
}: {
  roster: RosterStudent[];
  houses: HouseRow[];
  /** Newly ticked section_student ids. */
  selected: ReadonlySet<string>;
  /** Already in — shown ticked, not selectable. */
  locked: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  className?: string;
}) {
  const [classFilter, setClassFilter] = useState(ALL_CLASSES);

  const housesById = useMemo(
    () => new Map(houses.map((h) => [h.id, h])),
    [houses]
  );

  const classes = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of roster) map.set(s.sectionId, s.sectionName);
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      collator.compare(a.name, b.name)
    );
  }, [roster]);

  const shown = useMemo(
    () =>
      roster
        .filter(
          (s) => classFilter === ALL_CLASSES || s.sectionId === classFilter
        )
        .sort(
          (a, b) =>
            collator.compare(a.sectionName, b.sectionName) ||
            collator.compare(a.name, b.name)
        ),
    [roster, classFilter]
  );

  // "Everyone in this class" is the common case for a class-wide event — the
  // bulk path, so nobody ticks thirty boxes by hand.
  const pickableInClass =
    classFilter === ALL_CLASSES
      ? []
      : shown.filter((s) => !locked.has(s.sectionStudentId));
  const allClassPicked =
    pickableInClass.length > 0 &&
    pickableInClass.every((s) => selected.has(s.sectionStudentId));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function toggleClass() {
    const next = new Set(selected);
    for (const s of pickableInClass) {
      if (allClassPicked) next.delete(s.sectionStudentId);
      else next.add(s.sectionStudentId);
    }
    onChange(next);
  }

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="h-9 w-48" aria-label="Class">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CLASSES}>All classes</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pickableInClass.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={toggleClass}>
            {allClassPicked
              ? 'Untick the whole class'
              : `Tick all ${pickableInClass.length} in this class`}
          </Button>
        )}
      </div>

      <Command className="min-h-0 flex-1 rounded-lg border border-border">
        <CommandInput placeholder="Search by name, class or number…" />
        <CommandList className="max-h-none flex-1">
          <CommandEmpty>Nobody on this year&apos;s roll matches.</CommandEmpty>
          {shown.map((s) => {
            const isLocked = locked.has(s.sectionStudentId);
            const on = isLocked || selected.has(s.sectionStudentId);
            const house = s.houseId ? housesById.get(s.houseId) : undefined;
            return (
              <CommandItem
                key={s.sectionStudentId}
                value={s.sectionStudentId}
                keywords={[s.name, s.sectionName, s.studentNumber]}
                disabled={isLocked}
                onSelect={() => toggle(s.sectionStudentId)}
                className="gap-3"
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-input',
                    on
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background'
                  )}
                >
                  {on && <Check className="size-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {s.name}
                  {isLocked && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      Already entered
                    </span>
                  )}
                  {!isLocked && on && (
                    <span className="sr-only"> (ticked)</span>
                  )}
                </span>
                {house && (
                  <HouseChip
                    name={house.name}
                    colourToken={house.colourToken}
                    className="hidden shrink-0 sm:inline-flex"
                  />
                )}
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {s.sectionName}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {s.studentNumber}
                </span>
              </CommandItem>
            );
          })}
        </CommandList>
      </Command>
    </div>
  );
}
