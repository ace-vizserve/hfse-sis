'use client';

import { Plus, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { EntrantKind } from '@/lib/house-points/compute';
import {
  nextRank,
  placesFromScale,
  sameRubric,
} from '@/lib/house-points/defaults';
import type { Scale } from '@/lib/house-points/queries';
import { MAX_PLACES, type EventInput } from '@/lib/schemas/house-points';
import { cn } from '@/lib/utils';

// The fields that describe an event — shared by "New event" (this task) and
// "Edit event" (Task 9), so the two can never disagree about what an event is
// or how its rubric is built.
//
// The form is owned by the caller (it knows whether it is creating or saving,
// and what it posts); this component only renders into it. It owns the one
// piece of behaviour that is about the fields themselves: picking a Type
// refills the rubric from that type's standing point scale, asking first when
// somebody has already changed the rubric.
//
// Every event is a rubric of awards → points, and the organiser picks each
// entrant's award on the sheet (KD #228). There is no scoring or ranking to
// set up. Each award's hidden `rank` only gives its badge a medal colour; the
// award order is the row order here.

export type EventFormValues = EventInput;
type CreatableType = EventInput['eventType'];

type Option<T extends string> = { value: T; label: string; hint: string };

export const EVENT_TYPE_OPTIONS: Option<CreatableType>[] = [
  {
    value: 'internal',
    label: 'Internal competition',
    hint: 'Run inside the school, between our own students.',
  },
  {
    value: 'external',
    label: 'External competition',
    hint: 'Students representing the school against other schools.',
  },
  {
    value: 'major',
    label: 'Major event',
    hint: 'A school-wide occasion, such as Sports Day.',
  },
];

const ENTRANT_OPTIONS: Option<EntrantKind>[] = [
  {
    value: 'student',
    label: 'Students',
    hint: 'Each student gets their own award.',
  },
  {
    value: 'team',
    label: 'Teams',
    hint: "A team's points go to each house among its members.",
  },
  {
    value: 'house',
    label: 'Houses',
    hint: 'Each house gets an award as a whole.',
  },
];

/** Every label a validation error can point at, in the form's own words. */
export const EVENT_FIELD_LABELS: Record<string, string> = {
  name: 'Event name',
  heldOn: 'Date',
  eventType: 'Type',
  entrantKind: 'Who is entered',
  places: 'Rubric',
};

/** The selected-card treatment from components/classroom/discipline-record-form.tsx. */
const CARD_CLASS =
  'flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-brand-indigo/40 has-[[data-state=checked]]:bg-brand-indigo/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:disabled]:hover:bg-card';

/** A number input's text → the form's number. Blank is not zero. */
function toNumberOrNull(raw: string): number | null {
  return raw === '' ? null : Number(raw);
}

function RadioCards<T extends string>({
  idPrefix,
  options,
  value,
  onChange,
  disabled,
  disabledValues = [],
  columns,
}: {
  idPrefix: string;
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  disabledValues?: T[];
  columns?: 2 | 3;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as T)}
      disabled={disabled}
      className={cn(
        'gap-2',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-3'
      )}
    >
      {options.map((option) => {
        const id = `${idPrefix}-${option.value}`;
        return (
          <label key={option.value} htmlFor={id} className={CARD_CLASS}>
            <RadioGroupItem
              value={option.value}
              id={id}
              className="mt-0.5"
              disabled={disabled || disabledValues.includes(option.value)}
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium text-foreground">
                {option.label}
              </span>
              <span className="block text-xs text-muted-foreground">
                {option.hint}
              </span>
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}

export function EventSetupFields({
  form,
  scales,
  lockSetup = false,
}: {
  form: UseFormReturn<EventFormValues>;
  /** The standing point scales, from `loadScales()`. */
  scales: Scale[];
  /**
   * The event already has entrants: who is entered can no longer change,
   * because every award already recorded was given to those entrants.
   * Passed by the edit sheet (Task 9).
   */
  lockSetup?: boolean;
}) {
  const { control } = form;
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: 'places',
  });
  const places = useWatch({ control, name: 'places' }) ?? [];

  // The type the user has just switched to, while we ask whether their own
  // rubric should be replaced by its defaults. Asked INLINE, above the
  // rubric, never in a dialog: this component lives inside a drawer, and an
  // action inside a drawer must not open another dialog on top of it. The
  // rubric is untouched until "Replace rubric" is chosen.
  const [pendingType, setPendingType] = useState<CreatableType | null>(null);

  const scaleFor = (type: CreatableType) =>
    scales.find((s) => s.eventType === type);

  function changeType(next: CreatableType) {
    const previous = form.getValues('eventType');
    if (next === previous) return;
    form.setValue('eventType', next, {
      shouldDirty: true,
      shouldValidate: true,
    });
    // Refill silently only while the rubric still says exactly what the old
    // type's defaults said — then nobody's work is lost. Anything else was
    // typed by a person, so ask.
    const untouched = sameRubric(
      form.getValues('places'),
      placesFromScale(scaleFor(previous))
    );
    if (untouched) {
      replace(placesFromScale(scaleFor(next)));
      setPendingType(null);
    } else {
      setPendingType(next);
    }
  }

  const pendingLabel = pendingType
    ? (EVENT_TYPE_OPTIONS.find((o) => o.value === pendingType)?.label ?? '')
    : '';

  const placesError =
    form.formState.errors.places?.message ??
    form.formState.errors.places?.root?.message;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[1.5fr_1fr]">
        <FormField
          control={control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Event name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Inter-house spelling bee" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="heldOn"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Date</FormLabel>
              <FormControl>
                <DatePicker
                  value={field.value ?? ''}
                  onChange={(v) => field.onChange(v === '' ? null : v)}
                  placeholder="Optional"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={control}
        name="eventType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Type</FormLabel>
            <FormControl>
              <RadioCards
                idPrefix="hp-event-type"
                options={EVENT_TYPE_OPTIONS}
                value={field.value}
                onChange={changeType}
              />
            </FormControl>
            <FormDescription>
              Each type starts with its own awards and points.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="entrantKind"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Who is entered</FormLabel>
            <FormControl>
              <RadioCards
                idPrefix="hp-entrant"
                options={ENTRANT_OPTIONS}
                value={field.value}
                onChange={field.onChange}
                disabled={lockSetup}
                columns={3}
              />
            </FormControl>
            {lockSetup && (
              <FormDescription>
                This can&rsquo;t change once people are entered, because their
                awards were given to them.
              </FormDescription>
            )}
            <FormMessage />
          </FormItem>
        )}
      />

      {/* The rubric — a short list of awards, each worth some points. A
          field array rather than a table: it is a handful of rows edited in
          place, and every row is the same controls. */}
      {/* §9.4 accent panel, advisory: the reader can carry on around it. */}
      {pendingType && (
        <div
          role="status"
          className="flex items-start gap-4 rounded-xl border border-brand-indigo-soft bg-accent p-5"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <RotateCcw className="size-4" />
          </div>
          <div className="flex-1 space-y-3">
            <div className="space-y-1.5">
              <p className="font-serif text-base font-semibold text-foreground">
                Replace the rubric with the {pendingLabel.toLowerCase()}{' '}
                defaults?
              </p>
              <p className="text-sm text-muted-foreground">
                You&rsquo;ve changed the awards or points below, so they are
                kept until you choose.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  replace(placesFromScale(scaleFor(pendingType)));
                  setPendingType(null);
                }}
              >
                Replace rubric
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPendingType(null)}
              >
                Keep mine
              </Button>
            </div>
          </div>
        </div>
      )}

      <section className="space-y-2" aria-labelledby="hp-rubric-heading">
        <div className="space-y-1">
          <h3
            id="hp-rubric-heading"
            className="text-sm font-medium text-foreground"
          >
            Rubric
          </h3>
          <p className="text-xs text-muted-foreground">
            The awards you pick from on the sheet, and the points each one
            earns. They appear on the sheet in this order.
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_2rem] items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Award</span>
            <span className="text-right">Points</span>
            <span className="sr-only">Remove</span>
          </div>

          <ul className="divide-y divide-border">
            {fields.map((row, index) => {
              const current = places[index];
              return (
                <li
                  key={row.id}
                  className="grid grid-cols-[minmax(0,1fr)_5.5rem_2rem] items-start gap-2 px-3 py-2"
                >
                  <FormField
                    control={control}
                    name={`places.${index}.label`}
                    render={({ field }) => (
                      <FormItem className="gap-1">
                        <FormLabel className="sr-only">
                          Award {index + 1}
                        </FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Gold" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={control}
                    name={`places.${index}.points`}
                    render={({ field }) => (
                      <FormItem className="gap-1">
                        <FormLabel className="sr-only">
                          Points for award {index + 1}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="any"
                            className="text-right tabular-nums"
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            // Blank is kept as NaN so the schema answers
                            // "Enter the points for this award." — never a
                            // silent 0.
                            value={Number.isNaN(field.value) ? '' : field.value}
                            onChange={(e) =>
                              field.onChange(
                                toNumberOrNull(e.target.value) ?? Number.NaN
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(index)}
                    disabled={fields.length === 1}
                    aria-label={`Remove ${current?.label || `award ${index + 1}`}`}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2"
              disabled={fields.length >= MAX_PLACES}
              onClick={() =>
                append({
                  label: '',
                  // Unseen: only picks the badge colour, never a placement.
                  rank: nextRank(form.getValues('places')),
                  points: Number.NaN,
                })
              }
            >
              <Plus className="size-4" />
              Add an award
            </Button>
            {fields.length >= MAX_PLACES && (
              <span className="text-xs text-muted-foreground">
                An event can have up to {MAX_PLACES} awards.
              </span>
            )}
          </div>
        </div>

        {placesError && (
          <p className="text-sm text-destructive" role="alert">
            {placesError}
          </p>
        )}
      </section>
    </>
  );
}
