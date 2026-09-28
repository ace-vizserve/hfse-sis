'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, type FieldErrors, type Path } from 'react-hook-form';
import { toast } from 'sonner';

import {
  EVENT_FIELD_LABELS,
  EventSetupFields,
  type EventFormValues,
} from '@/components/house-points/event-setup-fields';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { placesFromScale } from '@/lib/house-points/defaults';
import type { Scale } from '@/lib/house-points/queries';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { EventInputSchema } from '@/lib/schemas/house-points';

// Creating a house-points event. The sheet shell follows
// components/discipline/file-record-button.tsx; the form body follows
// components/classroom/discipline-record-form.tsx (fields scroll, the Cancel /
// Create row stays pinned). The fields themselves live in EventSetupFields so
// "Edit event" renders exactly the same ones.
//
// The rubric starts as a COPY of the standing point scale for the chosen type.
// What is saved is the event's own copy: changing a scale later never reaches
// an event that already exists.

function blankValues(ayCode: string, scales: Scale[]): EventFormValues {
  return {
    ayCode,
    name: '',
    heldOn: null,
    eventType: 'internal',
    entrantKind: 'student',
    placementMode: 'score',
    maxScore: null,
    rankWithin: 'event',
    places: placesFromScale(scales.find((s) => s.eventType === 'internal')),
  };
}

export function NewEventSheet({
  ayCode,
  scales,
}: {
  /** The year the event is created in — the page's selected year. */
  ayCode: string;
  scales: Scale[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm<EventFormValues>({
    resolver: zodResolver(EventInputSchema),
    defaultValues: blankValues(ayCode, scales),
  });

  const createMutation = useMutation({
    mutationFn: (values: EventFormValues) =>
      apiFetch<{ ok: true; id: string }>(
        '/api/house-points/events',
        jsonInit('POST', values)
      ),
  });

  const run = useWriteAction();

  function onOpenChange(next: boolean) {
    // Start fresh every time, from the scales as they are NOW — they may have
    // been changed in the Point scales sheet since this page loaded.
    if (next) form.reset(blankValues(ayCode, scales));
    setOpen(next);
  }

  async function onSubmit(values: EventFormValues) {
    const body: EventFormValues = {
      ...values,
      // A score only has a ceiling when scores are used at all.
      maxScore: values.placementMode === 'score' ? values.maxScore : null,
    };
    await run(() => createMutation.mutateAsync(body), {
      pending: 'Creating event…',
      success: 'Event created',
      onResolved: (created) => {
        setOpen(false);
        router.push(`/records/house-points/${created.id}`);
      },
      // The new event's own page is where the user lands, so there is no list
      // to refresh underneath first.
      refresh: false,
    });
  }

  // `handleSubmit` alone is silent when validation fails, and this form is
  // taller than the sheet — the message is often scrolled out of sight.
  function onInvalid(errors: FieldErrors<EventFormValues>) {
    const names = Object.keys(errors);
    if (names.length === 0) return;
    const labels = names.map((n) => EVENT_FIELD_LABELS[n] ?? n);
    const shown = labels.slice(0, 3).join(', ');
    toast.error(
      labels.length > 3
        ? `Check these fields: ${shown}, and ${labels.length - 3} more.`
        : `Check these fields: ${shown}.`
    );
    const first = names[0];
    if (first === 'places') {
      const rows = errors.places;
      const index = Array.isArray(rows)
        ? rows.findIndex((r) => r !== undefined)
        : -1;
      if (index >= 0) {
        form.setFocus(`places.${index}.label`);
      }
      return;
    }
    form.setFocus(first as Path<EventFormValues>);
  }

  const busy = form.formState.isSubmitting;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New event
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            House points · {ayCode}
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            New event
          </SheetTitle>
          <SheetDescription>
            Set how it is placed and what each place is worth. You add the
            students, teams or houses on the next page.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit, onInvalid)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <EventSetupFields form={form} scales={scales} />
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-background px-6 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" loading={busy} loadingText="Creating…">
                Create event
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
