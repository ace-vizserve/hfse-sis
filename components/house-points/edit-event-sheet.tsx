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
import type { EntrantKind, Place } from '@/lib/house-points/compute';
import type { Scale } from '@/lib/house-points/queries';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { EventInputSchema } from '@/lib/schemas/house-points';
import type { HouseRow } from '@/lib/sis/houses';

// "Edit event" — the same fields as "New event" (EventSetupFields), filled
// with this event's own setup. Places keep their ids, so the route updates
// the rows that already exist rather than replacing the rubric wholesale.
//
// Once anyone is entered, who is entered is locked (`lockSetup`) — every
// award already recorded was given to those entrants, and the route refuses
// the change with a 409 anyway.
//
// DELETE is asked INSIDE the drawer, as an inline panel, never as a dialog on
// top of it (Mr Ace: never nest dialogs). Any event can be deleted, with or
// without participants (Mr Ace, 2026-09-29: "you dont have to be hard on
// rules bro, as long as all is audit logged") — the route snapshots every
// result into the one audit row it writes, so the confirm panel below states
// exactly what disappears instead of refusing the action.

export type EditableEvent = {
  id: string;
  ayCode: string;
  name: string;
  heldOn: string | null;
  eventType: EventFormValues['eventType'];
  entrantKind: EntrantKind;
  places: Place[];
};

function valuesFrom(event: EditableEvent): EventFormValues {
  return {
    ayCode: event.ayCode,
    name: event.name,
    heldOn: event.heldOn,
    eventType: event.eventType,
    entrantKind: event.entrantKind,
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

/** Only the houses this event actually credited, richest first — what the delete confirm names. */
function houseLines(
  totals: Record<string, number>,
  houses: HouseRow[]
): { name: string; points: number }[] {
  return houses
    .map((h) => ({ name: h.name, points: totals[h.id] ?? 0 }))
    .filter((h) => h.points > 0)
    .sort((a, b) => b.points - a.points);
}

/** Plain-English scope for the confirm panel — what the delete actually takes with it. */
function deleteScopeText(
  eventName: string,
  participantCount: number,
  lines: { name: string; points: number }[]
): string {
  if (participantCount === 0) {
    return `This deletes ${eventName}. Nobody has been entered yet. The change is recorded in the audit log.`;
  }
  const results = participantCount === 1 ? 'result' : 'results';
  const houseText = lines.length
    ? ` ${lines
        .map((h, i) =>
          i === 0 ? `${h.name} loses ${h.points}` : `${h.name} ${h.points}`
        )
        .join(', ')}.`
    : '';
  return `This deletes ${eventName} and its ${participantCount} ${results}.${houseText} The change is recorded in the audit log.`;
}

export function EditEventSheet({
  event,
  participantCount,
  totals,
  houses,
  scales,
}: {
  event: EditableEvent;
  participantCount: number;
  totals: Record<string, number>;
  houses: HouseRow[];
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
    // Everything but the year, which never changes.
    const { ayCode: _ayCode, ...body } = values;
    void _ayCode;
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
        success: `Deleted ${event.name}`,
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
              ? 'Change the name, date, type or rubric. Awards and points on the sheet follow the new rubric straight away.'
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
                      {deleteScopeText(
                        event.name,
                        participantCount,
                        houseLines(totals, houses)
                      )}{' '}
                      This can&rsquo;t be undone.
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
              <Button
                type="button"
                variant="destructive"
                disabled={busy || confirmingDelete}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="size-4" />
                Delete event
              </Button>
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
