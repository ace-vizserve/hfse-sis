'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Trash2 } from 'lucide-react';
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
import type {
  EntrantKind,
  Place,
  PlacementMode,
  RankWithin,
} from '@/lib/house-points/compute';
import type { Scale } from '@/lib/house-points/queries';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { EventInputSchema } from '@/lib/schemas/house-points';

// "Edit event" — the same fields as "New event" (EventSetupFields), filled
// with this event's own setup. Places keep their ids, so the route updates
// the rows that already exist rather than replacing the rubric wholesale.
//
// Once anyone is entered, who is entered and how they are placed are locked
// (`lockSetup`) — every score and place already recorded was given under them,
// and the route refuses the change with a 409 anyway.
//
// DELETE is asked INSIDE the drawer, as an inline panel, never as a dialog on
// top of it (Mr Ace: never nest dialogs). It is only offered while the event
// has no participants; the route refuses otherwise.

export type EditableEvent = {
  id: string;
  ayCode: string;
  name: string;
  heldOn: string | null;
  eventType: EventFormValues['eventType'];
  entrantKind: EntrantKind;
  placementMode: PlacementMode;
  maxScore: number | null;
  rankWithin: RankWithin;
  places: Place[];
};

function valuesFrom(event: EditableEvent): EventFormValues {
  return {
    ayCode: event.ayCode,
    name: event.name,
    heldOn: event.heldOn,
    eventType: event.eventType,
    entrantKind: event.entrantKind,
    placementMode: event.placementMode,
    maxScore: event.maxScore,
    rankWithin: event.rankWithin,
    places: [...event.places]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => ({
        id: p.id,
        label: p.label,
        rank: p.rank,
        points: p.points,
      })),
  };
}

export function EditEventSheet({
  event,
  participantCount,
  scales,
}: {
  event: EditableEvent;
  participantCount: number;
  scales: Scale[];
}) {
  const router = useRouter();
  const run = useWriteAction();
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<EventFormValues>({
    resolver: zodResolver(EventInputSchema),
    defaultValues: valuesFrom(event),
  });

  const hasParticipants = participantCount > 0;

  function onOpenChange(next: boolean) {
    if (deleting) return;
    // Start from the event as it is NOW — the page may have refreshed since.
    if (next) form.reset(valuesFrom(event));
    setConfirmingDelete(false);
    setOpen(next);
  }

  async function onSubmit(values: EventFormValues) {
    // Everything but the year, which never changes. A score only has a
    // ceiling when scores are used at all.
    const { ayCode: _ayCode, ...rest } = values;
    void _ayCode;
    const body = {
      ...rest,
      maxScore: values.placementMode === 'score' ? values.maxScore : null,
    };
    await run(
      () =>
        apiFetch<{ ok: true; changed: boolean }>(
          `/api/house-points/events/${encodeURIComponent(event.id)}`,
          jsonInit('PATCH', body)
        ),
      {
        pending: 'Saving event…',
        success: (data) => (data.changed ? 'Event saved' : 'Nothing to save'),
        onResolved: () => setOpen(false),
      }
    );
  }

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
      if (index >= 0) form.setFocus(`places.${index}.label`);
      return;
    }
    form.setFocus(first as Path<EventFormValues>);
  }

  async function deleteEvent() {
    setDeleting(true);
    await run(
      () =>
        apiFetch<{ ok: true }>(
          `/api/house-points/events/${encodeURIComponent(event.id)}`,
          jsonInit('DELETE')
        ),
      {
        pending: 'Deleting event…',
        success: 'Event deleted',
        // This page is about to stop existing; the list is where the user
        // lands, and it renders fresh on arrival.
        refresh: false,
        onResolved: () => {
          setOpen(false);
          router.push('/records/house-points');
        },
      }
    );
    setDeleting(false);
  }

  const busy = form.formState.isSubmitting || deleting;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <Pencil className="size-4" />
          Edit event
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            House points · {event.ayCode}
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            Edit event
          </SheetTitle>
          <SheetDescription>
            {hasParticipants
              ? 'Change the name, date, type or rubric. Placements and points on the sheet follow the new rubric straight away.'
              : 'Change anything about this event. Nobody is entered yet.'}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit, onInvalid)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <EventSetupFields
                form={form}
                scales={scales}
                lockSetup={hasParticipants}
              />
            </div>

            {/* Delete, asked in place — §9.4 destructive panel, pinned above
                the footer so it is never scrolled out of sight. */}
            {confirmingDelete && (
              <div
                role="alert"
                className="mx-6 mb-4 flex shrink-0 items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
                  <Trash2 className="size-4" />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="space-y-1.5">
                    <p className="font-serif text-base font-semibold text-foreground">
                      Delete {event.name}?
                    </p>
                    <p className="text-sm text-muted-foreground">
                      The event and its rubric are removed for good. This
                      can&rsquo;t be undone.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      loading={deleting}
                      loadingText="Deleting…"
                      onClick={deleteEvent}
                    >
                      Delete event
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={deleting}
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Keep it
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-background px-6 py-4">
              {hasParticipants ? (
                <p className="max-w-56 text-xs text-muted-foreground">
                  To delete this event, remove everyone from its sheet first.
                </p>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy || confirmingDelete}
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="size-4" />
                  Delete event
                </Button>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={form.formState.isSubmitting}
                  loadingText="Saving…"
                  disabled={deleting}
                >
                  Save changes
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
