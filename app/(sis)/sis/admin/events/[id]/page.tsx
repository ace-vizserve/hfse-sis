import { Pencil, Users, UsersRound, UserCheck, UserX } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { MetricCard } from '@/components/dashboard/metric-card';
import {
  CloseRegistrationButton,
  CopyLinkButton,
} from '@/components/events/event-actions';
import { EventSettingsButton } from '@/components/events/event-settings';
import { RegistrationsTable } from '@/components/events/registrations-table';
import { StatusBadge } from '@/components/events/events-table';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/ui/page-shell';
import { requirePageRoles } from '@/lib/auth/require-page-roles';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import {
  eventShortLink,
  eventShortLinkLabel,
  builderHref,
  formatClosesAt,
  formatEventDate,
  stripTrailingStop,
} from '@/lib/events/display';
import { loadEventDetail } from '@/lib/events/staff';
import { createServiceClient } from '@/lib/supabase/service';

// /sis/admin/events/[id] — one event: its details and who has registered,
// who is not joining, and who has not answered yet.

export default async function ParentEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageRoles([...ENROLMENT_PLACEMENT_WRITERS]);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const service = createServiceClient();
  const detail = await loadEventDetail(service, id, new Date());
  if (!detail) notFound();
  const { event, form, registered, notJoining, notRegistered, families } =
    detail;

  const origin =
    process.env.ADMISSIONS_PORTAL_ORIGIN ??
    process.env.NEXT_PUBLIC_PARENT_PORTAL_URL;
  const link = eventShortLink(event.slug, origin);
  const canClose = event.status === 'open' || event.status === 'upcoming';
  const twoChildren = (() => {
    // Families with more than one registered child.
    const per = new Map<string, number>();
    for (const r of registered) {
      const key = r.registeredBy.email;
      per.set(key, (per.get(key) ?? 0) + 1);
    }
    return [...per.values()].filter((c) => c > 1).length;
  })();

  const details = [
    formatEventDate(event.startsOn, event.endsOn) +
      (event.timeLabel ? `, ${event.timeLabel}` : ''),
    event.venue,
    `Registration closes ${formatClosesAt(event.closesAt)}`,
  ]
    .filter(Boolean)
    .join('. ');
  const n = (v: number) => v.toLocaleString('en-SG');

  return (
    <PageShell>
      <SisPageHeader
        group="Parent events"
        title={`${event.title}.`}
        description={details}
        backHref="/sis/admin/events"
        backLabel="Parent events"
        chips={
          <div className="flex flex-col items-start gap-2 md:items-end">
            <StatusBadge status={event.status} />
            <span className="font-mono text-xs text-muted-foreground">
              {eventShortLinkLabel(link)}
            </span>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CopyLinkButton link={link} />
            <EventSettingsButton
              eventId={event.id}
              slug={event.slug}
              linkPrefix={eventShortLinkLabel(eventShortLink('', origin))}
              details={{
                title: event.title,
                description: event.description,
                startsOn: event.startsOn,
                endsOn: event.endsOn,
                timeLabel: event.timeLabel,
                venue: event.venue,
                scope: {
                  audience: event.audience,
                  levels: event.levels,
                  sectionIds: event.sectionIds,
                },
                answerMode: event.answerMode,
                opensAt: event.opensAt,
                closesAt: event.closesAt,
              }}
            />
            <Button asChild variant="outline">
              <Link href={builderHref(event.id)}>
                <Pencil className="size-4" />
                Edit event
              </Link>
            </Button>
            {canClose && <CloseRegistrationButton id={event.id} />}
          </div>
        }
      />

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          <MetricCard
            label="Children registered"
            value={n(registered.length)}
            icon={UserCheck}
            tileClassName="from-brand-mint to-brand-mint/70"
            subtext={`Of ${n(detail.eligible)} children it is for · ${stripTrailingStop(scopeText(event))}`}
          />
          <MetricCard
            label="Families"
            value={n(families)}
            icon={UsersRound}
            subtext={
              twoChildren > 0
                ? `${twoChildren} registered more than one child`
                : 'Parents who have answered'
            }
          />
          <MetricCard
            label="Not registered yet"
            value={n(notRegistered.length)}
            icon={Users}
            tileClassName="from-brand-amber to-brand-amber/70"
            subtext="Children whose parents have not answered"
          />
          <MetricCard
            label="Not joining"
            value={n(notJoining.length)}
            icon={UserX}
            subtext="Parents said no, with a reason"
          />
        </div>
      </div>

      <RegistrationsTable
        eventTitle={event.title}
        form={form}
        registered={registered}
        notJoining={notJoining}
        notRegistered={notRegistered}
      />
    </PageShell>
  );
}

function scopeText(e: {
  audience: string;
  levels: string[];
  sectionIds: string[];
}): string {
  if (e.sectionIds.length > 0)
    return `${e.sectionIds.length} ${e.sectionIds.length === 1 ? 'class' : 'classes'}`;
  if (e.levels.length > 0) return e.levels.join(', ');
  return e.audience === 'all'
    ? 'Whole school'
    : e.audience === 'primary'
      ? 'Primary'
      : 'Secondary';
}
