'use client';

// EventScopeField — "Who is it for?" on a calendar event.
//
// Replaces the three-value Level dropdown (Whole school / Primary / Secondary)
// for INFORMATIONAL events. Day-affecting entries keep the old control: closures
// are still whole-school-or-band, because nothing in two years of HFSE's
// calendar closes school for one level and `school_calendar` has no level
// column to put it in.
//
// Chips rather than a dropdown: ten fixed values, and the common answers are
// one level or a run of them. A dropdown hides the whole vocabulary behind a
// click and makes Leadership Camp (P4 through S4) seven clicks with the list
// reopening each time.
//
// Levels and classes swap rather than stack — "P6, and also S1 Discipline 1"
// has no meaning anyone asked for, and calendar_events_one_scope_chk refuses it.
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
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  describeClassScope,
  describeLevelScope,
  sortLevels,
  spansBothBands,
} from '@/lib/attendance/event-scope';
import { apiFetch } from '@/lib/query/fetcher';
import { cn } from '@/lib/utils';
import { LEVEL_CODES, type LevelCode } from '@/lib/sis/levels';

const PRIMARY_CODES = LEVEL_CODES.filter((c) => c.startsWith('P'));
const SECONDARY_CODES = LEVEL_CODES.filter((c) => c.startsWith('S'));

type SectionOption = {
  id: string;
  name: string;
  level: { code: string } | null;
};

export function EventScopeField({
  levels,
  sectionIds,
  onChange,
}: {
  levels: LevelCode[];
  sectionIds: string[];
  /** Emits both halves — the caller stores one scope or the other, never both. */
  onChange: (next: { levels: LevelCode[]; sectionIds: string[] }) => void;
}) {
  const byClass = sectionIds.length > 0;
  const [classMode, setClassMode] = useState(byClass);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Only fetched once someone actually opens the class picker — nothing in
  // AY2025 or AY2026 is scoped this tightly, so the list would otherwise be
  // loaded on every event anyone adds.
  const sectionsQuery = useQuery({
    queryKey: ['sections', 'for-event-scope'],
    queryFn: () => apiFetch<{ sections: SectionOption[] }>('/api/sections'),
    enabled: classMode,
    staleTime: 5 * 60_000,
  });
  const sections = sectionsQuery.data?.sections ?? [];

  function toggleLevels(next: string[]) {
    onChange({ levels: sortLevels(next as LevelCode[]), sectionIds: [] });
  }

  function toggleSection(id: string) {
    const next = sectionIds.includes(id)
      ? sectionIds.filter((s) => s !== id)
      : [...sectionIds, id];
    onChange({ levels: [], sectionIds: next });
  }

  const mixed = spansBothBands(levels);

  return (
    <div className="space-y-2">
      <Label>Who is it for?</Label>

      {classMode ? (
        <>
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
          <p className="flex flex-wrap items-baseline gap-2 text-[13px] text-muted-foreground">
            <span className="text-ink-2">
              {describeClassScope(sectionIds.length)}
            </span>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-[13px]"
              onClick={() => {
                setClassMode(false);
                onChange({ levels: [], sectionIds: [] });
              }}
            >
              Choose levels instead
            </Button>
          </p>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <ScopeBand
              name="Primary"
              codes={PRIMARY_CODES}
              value={levels}
              onValueChange={toggleLevels}
            />
            <ScopeBand
              name="Secondary"
              codes={SECONDARY_CODES}
              value={levels}
              onValueChange={toggleLevels}
            />
          </div>
          <p className="flex flex-wrap items-baseline gap-2 text-[13px] text-muted-foreground">
            <span className="text-ink-2">{describeLevelScope(levels)}</span>
            {levels.length === 0 ? (
              <>
                <span>Pick levels to narrow it.</span>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-[13px]"
                  onClick={() => {
                    setClassMode(true);
                    setPickerOpen(true);
                  }}
                >
                  Just one or two classes?
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-[13px]"
                onClick={() => onChange({ levels: [], sectionIds: [] })}
              >
                Clear
              </Button>
            )}
          </p>
          {mixed ? (
            // Said out loud rather than stored quietly: the whole reason this
            // field exists is that a scope nobody could see was wrong.
            <p className="rounded-md border border-brand-indigo-soft bg-accent px-3 py-2 text-[12.5px] leading-relaxed text-accent-foreground">
              Screens that only understand primary or secondary will show this
              to the whole school. The levels you picked are still saved, and
              every screen will use them once it is updated.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function ScopeBand({
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
