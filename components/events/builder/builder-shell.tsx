'use client';

import { CalendarDays, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { FormCanvas } from '@/components/events/builder/form-canvas';
import { EventSettingsButton } from '@/components/events/event-settings';
import { HeaderCard } from '@/components/events/builder/header-card';
import { useAutosave } from '@/components/events/builder/use-autosave';
import { Button } from '@/components/ui/button';
import { EventDetailsSchema, type EventDetails } from '@/lib/events/event';
import { EventFormSchema, type EventForm } from '@/lib/events/form';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// The full-screen event builder: its own top bar, then a centred canvas.
// Opens and closes times are Singapore time (see lib/events/sg-time.ts); they
// travel as ISO instants.

export function BuilderShell({
  eventId,
  initialDetails,
  initialForm,
  initialPublishedAt,
  initialSlug,
  linkPrefix,
}: {
  eventId: string;
  initialDetails: EventDetails;
  initialForm: EventForm;
  initialPublishedAt: string | null;
  initialSlug: string;
  linkPrefix: string;
}) {
  const [details, setDetails] = useState(initialDetails);
  const [slug, setSlug] = useState(initialSlug);
  const [form, setForm] = useState(initialForm);
  const [publishedAt, setPublishedAt] = useState(initialPublishedAt);
  const [publishing, setPublishing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [formProblem, setFormProblem] = useState<string | null>(null);

  const formSave = useAutosave(form, async (value) => {
    const parsed = EventFormSchema.safeParse(value);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Check the form.';
      setFormProblem(message);
      throw new Error(message);
    }
    setFormProblem(null);
    await apiFetch(
      `/api/sis/events/${eventId}`,
      jsonInit('PATCH', { form: parsed.data })
    );
  });

  const detailsSave = useAutosave(details, async (value) => {
    const parsed = EventDetailsSchema.safeParse(value);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Check the details.';
      setProblem(message);
      throw new Error(message);
    }
    setProblem(null);
    await apiFetch(
      `/api/sis/events/${eventId}`,
      jsonInit('PATCH', { details: parsed.data })
    );
  });

  const published = publishedAt !== null;
  const state =
    detailsSave.state === 'saving' || formSave.state === 'saving'
      ? 'saving'
      : detailsSave.state === 'error' || formSave.state === 'error'
        ? 'error'
        : 'saved';
  // The later of the two saves.
  const savedAt =
    [detailsSave.savedAt, formSave.savedAt]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const flush = async () => {
    const [a, b] = await Promise.all([detailsSave.flush(), formSave.flush()]);
    return a && b;
  };

  async function publish() {
    setPublishing(true);
    try {
      // Publish only what is saved: wait for any pending or running save.
      if (!(await flush())) {
        toast.error("Couldn't save your last change. Try again.");
        return;
      }
      const res = await apiFetch<{ publishedAt: string }>(
        `/api/sis/events/${eventId}/publish`,
        jsonInit('POST')
      );
      setPublishedAt(res.publishedAt);
      toast.success('Published.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not publish.');
    } finally {
      setPublishing(false);
    }
  }

  const saveText =
    state === 'saving'
      ? 'saving…'
      : state === 'error'
        ? "couldn't save — retrying when you edit"
        : savedAt
          ? 'saved just now'
          : 'saved';

  return (
    <div className="flex min-h-svh flex-col bg-muted">
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-5">
        <Button asChild variant="outline" size="icon">
          <Link
            href={
              published ? `/sis/admin/events/${eventId}` : '/sis/admin/events'
            }
            aria-label="Close the builder"
          >
            <X className="size-4" />
          </Link>
        </Button>
        <span className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <CalendarDays className="size-[17px]" aria-hidden />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate font-serif text-[17px] font-semibold tracking-tight">
            {details.title.trim() || 'Untitled event'}
          </p>
          <p
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
            aria-live="polite"
          >
            Parent events · {published ? 'Published' : 'Not published'} ·{' '}
            {saveText}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden font-mono text-xs text-muted-foreground lg:inline">
            {linkPrefix}
            {slug}
          </span>
          <EventSettingsButton
            eventId={eventId}
            details={details}
            slug={slug}
            linkPrefix={linkPrefix}
            iconOnly
            onSaved={({ slug: saved, ...settings }) => {
              setSlug(saved);
              setDetails((d) => ({ ...d, ...settings }));
            }}
          />
          <Button
            type="button"
            onClick={publish}
            disabled={published || publishing}
          >
            {published ? 'Published' : 'Publish'}
          </Button>
        </div>
      </header>

      <main className="flex-1 px-4 py-8 sm:px-10">
        <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3">
          <HeaderCard
            details={details}
            onChange={setDetails}
            problem={detailsSave.state === 'error' ? problem : null}
          />
          {formSave.state === 'error' && formProblem && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm text-destructive"
            >
              {formProblem}
            </p>
          )}
          <FormCanvas
            eventId={eventId}
            form={form}
            onChange={setForm}
            answerMode={details.answerMode}
          />
        </div>
      </main>
    </div>
  );
}
