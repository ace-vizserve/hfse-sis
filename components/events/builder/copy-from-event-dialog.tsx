'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { EventForm } from '@/lib/events/form';
import { apiFetch } from '@/lib/query/fetcher';
import { cn } from '@/lib/utils';

// "Copy from another event": lists this year's other events; choosing one adds
// copies of its sections to the end of this form.

type Listed = { id: string; title: string; form: EventForm };

export function CopyFromEventDialog({
  eventId,
  open,
  onOpenChange,
  onCopy,
}: {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopy: (form: EventForm) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['parent-events', 'copy-list', eventId],
    queryFn: ({ signal }) =>
      apiFetch<{ events: Listed[] }>(
        `/api/sis/events?exclude=${encodeURIComponent(eventId)}`,
        { signal }
      ),
    enabled: open,
  });
  const events = (query.data?.events ?? []).filter(
    (e) => e.form.sections.length > 0
  );
  const pick = events.find((e) => e.id === chosen) ?? null;

  const count = (f: EventForm) => {
    const qs = f.sections.reduce((n, s) => n + s.questions.length, 0);
    const ss = f.sections.length;
    return `${ss} ${ss === 1 ? 'section' : 'sections'} · ${qs} ${qs === 1 ? 'question' : 'questions'}`;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setChosen(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy from another event</DialogTitle>
          <DialogDescription>
            Its sections and questions are added to the end of this form. You
            can change them afterwards.
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <p className="py-6 text-sm text-muted-foreground">Loading events…</p>
        ) : query.isError ? (
          <p className="py-6 text-sm text-destructive">
            Could not load the events. Close this and try again.
          </p>
        ) : events.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No other event this year has a form to copy yet.
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Events"
            className="flex max-h-80 flex-col gap-1.5 overflow-y-auto"
          >
            {events.map((e) => (
              <Button
                key={e.id}
                type="button"
                variant="outline"
                role="radio"
                aria-checked={chosen === e.id}
                onClick={() => setChosen(e.id)}
                className={cn(
                  'h-auto justify-between gap-4 px-4 py-3 text-left',
                  chosen === e.id && 'border-brand-indigo bg-accent'
                )}
              >
                <span className="truncate font-medium text-foreground">
                  {e.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {count(e.form)}
                </span>
              </Button>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!pick}
            onClick={() => {
              if (!pick) return;
              onCopy(pick.form);
              setChosen(null);
              onOpenChange(false);
            }}
          >
            Copy sections
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
