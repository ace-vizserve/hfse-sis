'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  EntrantKind,
  PlacementMode,
  RankWithin,
} from '@/lib/house-points/compute';
import {
  nextRank,
  ordinal,
  placesFromScale,
  sameRubric,
} from '@/lib/house-points/defaults';
import type { Scale } from '@/lib/house-points/queries';
import type { EventInput } from '@/lib/schemas/house-points';
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
    hint: 'Each student is placed on their own.',
  },
  {
    value: 'team',
    label: 'Teams',
    hint: "A team's points go to each house among its members.",
  },
  {
    value: 'house',
    label: 'Houses',
    hint: 'Each house is placed as a whole.',
  },
];

const PLACEMENT_OPTIONS: Option<PlacementMode>[] = [
  {
    value: 'score',
    label: 'Ranked from scores',
    hint: 'Enter each score. The highest takes 1st place.',
  },
  {
    value: 'pick',
    label: 'Picked by hand',
    hint: 'Choose each place yourself.',
  },
];

const RANK_WITHIN_OPTIONS: { value: RankWithin; label: string }[] = [
  { value: 'section', label: 'Each class' },
  { value: 'level', label: 'Each level' },
  { value: 'event', label: 'Whole event' },
];

/** The rank Select's value for the "everyone else" row (rank null). */
const EVERYONE_ELSE = 'everyone-else';

/** Every label a validation error can point at, in the form's own words. */
export const EVENT_FIELD_LABELS: Record<string, string> = {
  name: 'Event name',
  heldOn: 'Date',
  eventType: 'Type',
  entrantKind: 'Who is entered',
  placementMode: 'How placements are decided',
  maxScore: 'Highest possible score',
  rankWithin: 'Rank students within',
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
   * The event already has entrants: who is entered and how they are placed
   * can no longer change, because every score and place already recorded was
   * given under those rules. Passed by the edit sheet (Task 9).
   */
  lockSetup?: boolean;
}) {
  const { control } = form;
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: 'places',
  });
  const entrantKind = useWatch({ control, name: 'entrantKind' });
  const placementMode = useWatch({ control, name: 'placementMode' });
  const places = useWatch({ control, name: 'places' }) ?? [];
  const isScore = placementMode === 'score';

  // The type the user has just switched to, while we ask whether their own
  // rubric should be replaced by its defaults.
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
    } else {
      setPendingType(next);
    }
  }

  function changeEntrant(next: EntrantKind) {
    form.setValue('entrantKind', next, {
      shouldDirty: true,
      shouldValidate: true,
    });
    // Mirrors the database rule: a house has no score of its own to rank.
    if (next === 'house' && form.getValues('placementMode') !== 'pick') {
      form.setValue('placementMode', 'pick', {
        shouldDirty: true,
        shouldValidate: true,
      });
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
              Each type starts with its own points for each place.
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
                onChange={changeEntrant}
                disabled={lockSetup}
                columns={3}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="placementMode"
        render={({ field }) => (
          <FormItem>
            <FormLabel>How placements are decided</FormLabel>
            <FormControl>
              <RadioCards
                idPrefix="hp-placement"
                options={PLACEMENT_OPTIONS}
                value={field.value}
                onChange={field.onChange}
                disabled={lockSetup}
                disabledValues={entrantKind === 'house' ? ['score'] : []}
                columns={2}
              />
            </FormControl>
            {lockSetup ? (
              <FormDescription>
                These can&rsquo;t change once people are entered, because their
                scores and places were recorded under them.
              </FormDescription>
            ) : entrantKind === 'house' ? (
              <FormDescription>
                Houses are always picked by hand — a house has no score of its
                own to rank.
              </FormDescription>
            ) : null}
            <FormMessage />
          </FormItem>
        )}
      />

      {isScore && (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={control}
            name="maxScore"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Highest possible score</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    className="tabular-nums"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={field.value ?? ''}
                    onChange={(e) =>
                      field.onChange(toNumberOrNull(e.target.value))
                    }
                    placeholder="50"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {/* Teams and houses are always ranked across the whole event, so
              this only means something when students are entered alone. */}
          {entrantKind === 'student' && (
            <FormField
              control={control}
              name="rankWithin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rank students within</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {RANK_WITHIN_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>
      )}

      {/* The rubric — a short list of places, each worth some points. A
          field array rather than a table: it is a handful of rows edited in
          place, and every row is the same three controls. */}
      <section className="space-y-2" aria-labelledby="hp-rubric-heading">
        <div className="space-y-1">
          <h3
            id="hp-rubric-heading"
            className="text-sm font-medium text-foreground"
          >
            Rubric
          </h3>
          <p className="text-xs text-muted-foreground">
            {isScore
              ? 'The points each place earns. "Everyone else" covers anyone with a score who didn\'t place.'
              : 'The places you can pick from, and the points each one earns.'}
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <div
            className={cn(
              'grid items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground',
              isScore
                ? 'grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_2rem]'
                : 'grid-cols-[minmax(0,1fr)_5.5rem_2rem]'
            )}
          >
            <span>Label</span>
            {isScore && <span>Rank</span>}
            <span className="text-right">Points</span>
            <span className="sr-only">Remove</span>
          </div>

          <ul className="divide-y divide-border">
            {fields.map((row, index) => {
              const current = places[index];
              const rankOptions = Math.max(places.length, current?.rank ?? 0);
              return (
                <li
                  key={row.id}
                  className={cn(
                    'grid items-start gap-2 px-3 py-2',
                    isScore
                      ? 'grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_2rem]'
                      : 'grid-cols-[minmax(0,1fr)_5.5rem_2rem]'
                  )}
                >
                  <FormField
                    control={control}
                    name={`places.${index}.label`}
                    render={({ field }) => (
                      <FormItem className="gap-1">
                        <FormLabel className="sr-only">
                          Label for row {index + 1}
                        </FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="1st place" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {isScore && (
                    <FormField
                      control={control}
                      name={`places.${index}.rank`}
                      render={({ field }) => (
                        <FormItem className="gap-1">
                          <FormLabel className="sr-only">
                            Rank for row {index + 1}
                          </FormLabel>
                          <Select
                            value={
                              field.value === null
                                ? EVERYONE_ELSE
                                : String(field.value)
                            }
                            onValueChange={(v) =>
                              field.onChange(
                                v === EVERYONE_ELSE ? null : Number(v)
                              )
                            }
                          >
                            <FormControl>
                              <SelectTrigger className="w-full tabular-nums">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Array.from(
                                { length: rankOptions },
                                (_, i) => i + 1
                              ).map((r) => (
                                <SelectItem key={r} value={String(r)}>
                                  {ordinal(r)}
                                </SelectItem>
                              ))}
                              <SelectItem value={EVERYONE_ELSE}>
                                Everyone else
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <FormField
                    control={control}
                    name={`places.${index}.points`}
                    render={({ field }) => (
                      <FormItem className="gap-1">
                        <FormLabel className="sr-only">
                          Points for row {index + 1}
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
                            // "Enter the points for this place." — never a
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
                    aria-label={`Remove ${current?.label || `row ${index + 1}`}`}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-border px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() =>
                append({
                  label: '',
                  rank: nextRank(form.getValues('places')),
                  points: Number.NaN,
                })
              }
            >
              <Plus className="size-4" />
              Add a place
            </Button>
          </div>
        </div>

        {placesError && (
          <p className="text-sm text-destructive" role="alert">
            {placesError}
          </p>
        )}
      </section>

      <AlertDialog
        open={pendingType !== null}
        onOpenChange={(open) => {
          if (!open) setPendingType(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Replace the rubric with the {pendingLabel.toLowerCase()} defaults?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You&rsquo;ve changed the places or points. Replacing them brings
              back the standard points for this type; keeping them leaves your
              rubric as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my rubric</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingType)
                  replace(placesFromScale(scaleFor(pendingType)));
                setPendingType(null);
              }}
            >
              Replace rubric
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
