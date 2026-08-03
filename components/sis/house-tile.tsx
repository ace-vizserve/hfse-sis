'use client';

import { useMutation } from '@tanstack/react-query';
import { House } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/select';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  houseSwatchClass,
  houseTileClass,
  type HouseRow,
} from '@/lib/sis/houses';
import { cn } from '@/lib/utils';

const NONE = '__none__';

// Which house a student belongs to (migration 110), as the fourth tile in the
// permanent record's fact band.
//
// It sits with Academic years / Total placements / Terms graded because that
// is what it is: a fact about this student, and the only one of the four you
// can change. Two earlier attempts treated it as a control needing a home — a
// full-width strip with its caption and its select at opposite ends of a wide
// row, then an 11px chip beside a 40px serif name — and both vanished. A tile
// inherits its neighbours' size and position, which is what makes it visible;
// nothing had to be invented to draw the eye.
//
// Anatomy matches `Stat` exactly — label, value, footnote, icon — with the
// control occupying the footnote slot where the others read "Years on roster".
//
// Saves on selection rather than behind a Save button: it is a single choice
// from four, and the allowance editors this was originally modelled on need a
// button only because they take free numeric input that can be mid-typing.
export function HouseTile({
  enroleeNumber,
  houses,
  initialHouseId,
  disabled,
  disabledReason,
}: {
  enroleeNumber: string;
  houses: HouseRow[];
  initialHouseId: string | null;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();

  // Held locally so the tile changes colour on click rather than after the
  // round-trip and the refresh behind it. Re-syncs from the prop, which is
  // what reverts it when a save fails.
  const [houseId, setHouseId] = useState(initialHouseId);
  useEffect(() => setHouseId(initialHouseId), [initialHouseId]);

  const saveMutation = useMutation({
    mutationFn: (next: string | null) =>
      apiFetch(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/house`,
        jsonInit('PATCH', { houseId: next })
      ),
    onSuccess: (_data, next) => {
      const name = houses.find((h) => h.id === next)?.name;
      toast.success(name ? `Moved to ${name}` : 'House cleared');
      router.refresh();
    },
    onError: (err) => {
      // A failed PATCH changed nothing, so the prop is still the saved value.
      setHouseId(initialHouseId);
      toast.error(err instanceof Error ? err.message : 'save failed');
    },
  });

  const current = houseId ? houses.find((h) => h.id === houseId) : undefined;
  const isDisabled = disabled || saveMutation.isPending || houses.length === 0;

  return (
    <div
      // `data-slot="card"` only when a house is set. The parent grid paints
      // every card-slotted child with a faint primary gradient; the empty
      // state is deliberately transparent and dashed, and that rule would
      // fill it back in — a child class cannot outrank the parent's `*:`
      // selector.
      data-slot={current ? 'card' : undefined}
      className={cn(
        '@container/card flex flex-col justify-between gap-6 rounded-xl py-6',
        current
          ? 'border bg-card text-card-foreground shadow-sm'
          : // The one dashed outline in a row of filled cards. A gap you
            // notice — which is the point while ~400 students still need one.
            'border border-dashed border-hairline-strong'
      )}
    >
      <div className="grid grid-cols-[1fr_auto] items-start gap-2 px-6">
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            House
          </p>
          <p
            className={cn(
              'font-serif text-[26px] font-semibold leading-none tracking-tight @[240px]/card:text-[30px]',
              current ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {current ? current.name : 'Not assigned'}
          </p>
        </div>
        <div
          className={cn(
            'flex size-9 items-center justify-center rounded-xl',
            current
              ? cn(houseTileClass(current.colourToken), 'text-white shadow-sm')
              : 'border border-dashed border-hairline-strong text-muted-foreground'
          )}
        >
          <House className="size-4" aria-hidden />
        </div>
      </div>

      <div className="px-6">
        <Select
          value={houseId ?? NONE}
          disabled={isDisabled}
          onValueChange={(v) => {
            const next = v === NONE ? null : v;
            setHouseId(next);
            saveMutation.mutate(next);
          }}
        >
          <SelectTrigger
            aria-label="House"
            title={disabled ? disabledReason : undefined}
            className={cn(
              'h-8 w-fit gap-1.5 rounded-lg px-2.5 text-xs font-medium shadow-none [&>svg]:size-3',
              current
                ? 'border-border bg-card text-muted-foreground hover:text-foreground'
                : // The only outlined-primary control on this page, because
                  // for now "not assigned" is nearly always the state.
                  'border-primary/50 bg-transparent font-semibold text-primary hover:bg-primary/5'
            )}
          >
            {current ? 'Change house' : 'Choose a house'}
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {/* The rule that makes a house unlike every other field on this
                  page. It belongs where it is read — on opening the menu,
                  which is the moment it matters — not as standing body copy
                  beside a control nobody had found. */}
              <SelectLabel className="max-w-[15rem] whitespace-normal text-[11px] font-normal leading-snug text-muted-foreground">
                Stays with the student for their whole time at the school. It is
                not reset when the year rolls over.
              </SelectLabel>
              {houses.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        houseSwatchClass(h.colourToken)
                      )}
                      aria-hidden
                    />
                    {h.name}
                  </span>
                </SelectItem>
              ))}
              {/* A house set by mistake has to be removable. */}
              <SelectItem value={NONE}>
                <span className="text-muted-foreground">Not assigned</span>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        {disabled && disabledReason && (
          <p className="mt-2 text-xs text-muted-foreground">{disabledReason}</p>
        )}
      </div>
    </div>
  );
}
