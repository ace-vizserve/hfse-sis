'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm, type FieldErrors } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { EventType } from '@/lib/house-points/compute';
import type { Scale } from '@/lib/house-points/queries';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  EVENT_TYPE_LABELS,
  EVENT_TYPE_VALUES,
  ScalesPutSchema,
  type ScalesPutInput,
} from '@/lib/schemas/house-points';

// The standing point scales — the points each place earns, per event type.
// A new event COPIES its type's scale into its own rubric, so a change here
// reaches new events only; that is said on screen, because it is the one thing
// a registrar would otherwise expect the other way round.
//
// One type at a time (tabs), each with its own Save — the save replaces that
// type's scale and nothing else (PUT /api/house-points/scales). Only labels
// and points are editable: the awards themselves (how many, their order) are
// the shape every event of that type is built from.
//
// No "Place" column: an award's rank is hidden everywhere (KD #228) — it only
// colours the medal badges. Each row still saves its rank unchanged, so those
// colours survive a save.

export function PointScalesSheet({ scales }: { scales: Scale[] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<EventType>('internal');
  // Bumped on every open so each tab's form starts from the scales as they
  // are now, not from whatever was left unsaved last time.
  const [session, setSession] = useState(0);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) setSession((s) => s + 1);
        setOpen(next);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline">
          <SlidersHorizontal className="size-4" />
          Point scales
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            House points
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            Point scales
          </SheetTitle>
          <SheetDescription>
            Changes apply to new events only. Events already created keep their
            own points.
          </SheetDescription>
        </SheetHeader>

        <Tabs
          key={session}
          value={type}
          onValueChange={(v) => setType(v as EventType)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="shrink-0 overflow-x-auto border-b border-border px-6 py-3">
            <TabsList>
              {EVENT_TYPE_VALUES.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {EVENT_TYPE_LABELS[t]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {EVENT_TYPE_VALUES.map((t) => (
            // Kept mounted so an unsaved edit survives switching tabs.
            <TabsContent
              key={t}
              value={t}
              forceMount
              className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
            >
              <ScaleForm
                eventType={t}
                scale={scales.find((s) => s.eventType === t)}
                onClose={() => setOpen(false)}
              />
            </TabsContent>
          ))}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function valuesFrom(eventType: EventType, scale: Scale | undefined) {
  return {
    eventType,
    rows: [...(scale?.rows ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((r) => ({ label: r.label, rank: r.rank, points: r.points })),
  } satisfies ScalesPutInput;
}

function ScaleForm({
  eventType,
  scale,
  onClose,
}: {
  eventType: EventType;
  scale: Scale | undefined;
  onClose: () => void;
}) {
  const form = useForm<ScalesPutInput>({
    resolver: zodResolver(ScalesPutSchema),
    defaultValues: valuesFrom(eventType, scale),
  });
  const { fields } = useFieldArray({ control: form.control, name: 'rows' });

  const saveMutation = useMutation({
    mutationFn: (values: ScalesPutInput) =>
      apiFetch<{ ok: true }>(
        '/api/house-points/scales',
        jsonInit('PUT', values)
      ),
  });
  const run = useWriteAction();
  const typeLabel = EVENT_TYPE_LABELS[eventType];

  async function onSubmit(values: ScalesPutInput) {
    await run(() => saveMutation.mutateAsync(values), {
      pending: `Saving ${typeLabel.toLowerCase()} points…`,
      success: `${typeLabel} points saved`,
      // The saved values become the new starting point, so Save greys out
      // again until something else changes.
      onResolved: () => form.reset(values),
    });
  }

  function onInvalid(errors: FieldErrors<ScalesPutInput>) {
    const rows = errors.rows;
    const index = Array.isArray(rows)
      ? rows.findIndex((r) => r !== undefined)
      : -1;
    toast.error(
      index >= 0
        ? `Check row ${index + 1} of the ${typeLabel.toLowerCase()} scale.`
        : 'Check the points before saving.'
    );
    if (index >= 0) form.setFocus(`rows.${index}.label`);
  }

  const busy = form.formState.isSubmitting;
  const dirty = form.formState.isDirty;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, onInvalid)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {fields.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No points are set for this type yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>Award</span>
                <span className="text-right">Points</span>
              </div>
              <ul className="divide-y divide-border">
                {fields.map((row, index) => (
                  <li
                    key={row.id}
                    className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-start gap-2 px-3 py-2"
                  >
                    <FormField
                      control={form.control}
                      name={`rows.${index}.label`}
                      render={({ field }) => (
                        <FormItem className="gap-1">
                          <FormLabel className="sr-only">
                            Label for row {index + 1}
                          </FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`rows.${index}.points`}
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
                              // Blank stays NaN so the schema asks for a
                              // number rather than saving a silent 0.
                              value={
                                Number.isNaN(field.value) ? '' : field.value
                              }
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value === ''
                                    ? Number.NaN
                                    : Number(e.target.value)
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-background px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </Button>
          <Button
            type="submit"
            loading={busy}
            loadingText="Saving…"
            disabled={!dirty || fields.length === 0}
          >
            Save {typeLabel.toLowerCase()} points
          </Button>
        </div>
      </form>
    </Form>
  );
}
