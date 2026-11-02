import { CalendarCheck, CalendarClock, Users, UsersRound } from 'lucide-react';

import { NewEventButton } from '@/components/events/event-actions';
import {
  EventsTable,
  NotPublishedStrip,
} from '@/components/events/events-table';
import { MetricCard } from '@/components/dashboard/metric-card';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { requirePageRoles } from '@/lib/auth/require-page-roles';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { eventShortLink } from '@/lib/events/display';
import { loadEventList } from '@/lib/events/staff';
import { createServiceClient } from '@/lib/supabase/service';

// /sis/admin/events — Parent events for the current year: each event's
// registration count and lifecycle. Staff create an event here, build its
// form in the builder, and open an event to see who has registered.

export default async function ParentEventsPage() {
  await requirePageRoles([...ENROLMENT_PLACEMENT_WRITERS]);

  const service = createServiceClient();
  const ay = await getCurrentAcademicYear(service);
  if (!ay) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No current academic year configured.
        </div>
      </PageShell>
    );
  }

  const events = await loadEventList(service, ay.id, new Date());
  const ids = events.map((e) => e.id);
  let families = 0;
  if (ids.length > 0) {
    const { count, error } = await service
      .from('parent_event_submissions')
      .select('id', { count: 'exact', head: true })
      .in('event_id', ids);
    if (error) throw error;
    families = count ?? 0;
  }

  const origin =
    process.env.ADMISSIONS_PORTAL_ORIGIN ??
    process.env.NEXT_PUBLIC_PARENT_PORTAL_URL;
  const rows = events.map((e) => ({
    ...e,
    link: eventShortLink(e.slug, origin),
  }));

  const open = events.filter(
    (e) => e.status === 'open' || e.status === 'upcoming'
  ).length;
  const past = events.filter((e) => e.status === 'past').length;
  const childrenRegistered = events.reduce((n, e) => n + e.registered, 0);
  const n = (v: number) => v.toLocaleString('en-SG');

  return (
    <PageShell>
      <SisPageHeader
        group="This year"
        title="Parent events."
        description="Events parents register their children for, from the enrolment site. Build the form, share the link, and watch who has answered."
        actions={<NewEventButton />}
        chips={
          <Badge
            variant="outline"
            className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            {ay.ay_code}
          </Badge>
        }
      />

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          <MetricCard
            label="Open for registration"
            value={n(open)}
            icon={CalendarCheck}
            tileClassName="from-brand-mint to-brand-mint/70"
            subtext={
              open === 1
                ? 'event taking registrations'
                : 'events taking registrations'
            }
          />
          <MetricCard
            label="Children registered"
            value={n(childrenRegistered)}
            icon={Users}
            subtext="Across all events this year"
          />
          <MetricCard
            label="Families"
            value={n(families)}
            icon={UsersRound}
            subtext="Parents who have answered"
          />
          <MetricCard
            label="Past"
            value={n(past)}
            icon={CalendarClock}
            subtext="Events already held"
          />
        </div>
      </div>

      <NotPublishedStrip rows={rows} />
      <EventsTable rows={rows} />
    </PageShell>
  );
}
