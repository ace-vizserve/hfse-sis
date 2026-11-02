import { ArrowLeft, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { BuilderShell } from '@/components/events/builder/builder-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requirePageRoles } from '@/lib/auth/require-page-roles';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { eventShortLink, eventShortLinkLabel } from '@/lib/events/display';
import type { EventDetails } from '@/lib/events/event';
import { EventFormSchema } from '@/lib/events/form';
import { createServiceClient } from '@/lib/supabase/service';

// /sis/admin/events/[id]/build — the full-screen builder for one event.

type Row = {
  slug: string;
  title: string;
  description: string | null;
  starts_on: string;
  ends_on: string | null;
  time_label: string | null;
  venue: string | null;
  audience: 'all' | 'primary' | 'secondary';
  levels: EventDetails['scope']['levels'] | null;
  section_ids: string[] | null;
  answer_mode: 'consent' | 'register';
  opens_at: string;
  closes_at: string;
  form: unknown;
  published_at: string | null;
};

export default async function EventBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageRoles([...ENROLMENT_PLACEMENT_WRITERS]);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const { data, error } = await createServiceClient()
    .from('parent_events')
    .select(
      'slug, title, description, starts_on, ends_on, time_label, venue, audience, levels, section_ids, answer_mode, opens_at, closes_at, form, published_at'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) notFound();
  const r = data as unknown as Row;

  const form = EventFormSchema.safeParse(r.form);
  // Never open the editor on a stand-in empty form: its first autosave would
  // overwrite the real one. Say so and change nothing.
  if (!form.success) {
    console.error(
      `[events] stored form for ${id} failed the schema`,
      form.error.issues
    );
    return <FormUnreadable />;
  }

  return (
    <BuilderShell
      eventId={id}
      initialDetails={{
        title: r.title,
        description: r.description ?? '',
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        timeLabel: r.time_label ?? '',
        venue: r.venue ?? '',
        scope: {
          audience: r.audience,
          levels: r.levels ?? [],
          sectionIds: r.section_ids ?? [],
        },
        answerMode: r.answer_mode,
        opensAt: r.opens_at,
        closesAt: r.closes_at,
      }}
      initialForm={form.data}
      initialPublishedAt={r.published_at}
      initialSlug={r.slug}
      // "enrol.hfse.edu.sg/events/" — shown before the slug in Event settings.
      linkPrefix={eventShortLinkLabel(
        eventShortLink(
          '',
          process.env.ADMISSIONS_PORTAL_ORIGIN ??
            process.env.NEXT_PUBLIC_PARENT_PORTAL_URL
        )
      )}
    />
  );
}

// §7.6 empty-state recipe (same as RecordNotFound), full screen because the
// builder has no SIS sidebar.
function FormUnreadable() {
  return (
    <main className="flex min-h-svh flex-col justify-center bg-background px-4">
      <Card className="mx-auto w-full max-w-xl">
        <CardContent className="flex flex-col items-center gap-5 px-6 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <TriangleAlert className="size-5" strokeWidth={1.75} />
          </div>
          <div className="space-y-2.5">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Parent events
            </p>
            <h1 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
              This event&rsquo;s form couldn&rsquo;t be loaded.
            </h1>
            <p className="mx-auto max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Nothing has been changed. Please tell the SIS team so they can
              look at it.
            </p>
          </div>
          <Button asChild>
            <Link href="/sis/admin/events">
              <ArrowLeft className="size-4" />
              Back to parent events
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
