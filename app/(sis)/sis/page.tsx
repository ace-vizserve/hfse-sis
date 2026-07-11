import { Activity, BookOpen, GitBranch, LayoutGrid, Users } from 'lucide-react';
import { redirect } from 'next/navigation';

import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { MetricCard } from '@/components/dashboard/metric-card';
import { HubYearSetupCard } from '@/components/sis/year-setup/hub-year-setup-card';
import { HubClassAssignmentCallout } from '@/components/sis/hub-class-assignment-callout';
import { HubUpcomingEventsCard } from '@/components/sis/hub-upcoming-events-card';
import { SystemHealthStrip } from '@/components/sis/system-health-strip';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import {
  getClassAssignmentReadiness,
  getHubKpis,
  getUpcomingCalendarEvents,
} from '@/lib/sis/dashboard';
import { getSystemHealth } from '@/lib/sis/health';
import { getAyReadiness } from '@/lib/sis/readiness';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// SIS Admin Hub — status + launch, not a menu (SIS Admin IA redesign, Phase
// 2). Reachable only by school_admin + superadmin (guard below); the audit
// BI tab that used to live behind `?view=audit` here was relocated to the
// "Overview" view on `/sis/audit-log` in Phase 3 (a stale `?view=audit`
// link just renders this hub, unaffected by the param). The Organisation /
// Access / Related card grids and the staffing + lifecycle cards were
// removed: their destinations are one click away via the SIS sidebar
// (regrouped this phase) or, for staffing, the Staff page itself.
export default async function SisAdminHub() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const role = sessionUser.role;
  if (role !== 'school_admin' && role !== 'superadmin') {
    redirect('/');
  }

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  const ayCode = currentAy?.ay_code ?? '';
  const ayReadiness = currentAy
    ? await getAyReadiness(currentAy.ay_code)
    : null;

  // System-health strip is superadmin-only (approver counts are sensitive to
  // their operational awareness). school_admin sees the hub without it.
  const [health, hubKpis, unassignedStudents, upcomingEvents] =
    await Promise.all([
      role === 'superadmin' ? getSystemHealth() : Promise.resolve(null),
      ayCode ? getHubKpis(ayCode).catch(() => null) : Promise.resolve(null),
      ayCode
        ? getClassAssignmentReadiness(ayCode).catch(
            () => [] as Awaited<ReturnType<typeof getClassAssignmentReadiness>>
          )
        : Promise.resolve(
            [] as Awaited<ReturnType<typeof getClassAssignmentReadiness>>
          ),
      ayCode
        ? getUpcomingCalendarEvents(ayCode).catch(
            () => [] as Awaited<ReturnType<typeof getUpcomingCalendarEvents>>
          )
        : Promise.resolve(
            [] as Awaited<ReturnType<typeof getUpcomingCalendarEvents>>
          ),
    ]);

  return (
    <PageShell>
      <DashboardHero
        eyebrow={
          role === 'superadmin' ? 'SIS · Admin hub' : 'SIS · Academic admin'
        }
        title={
          role === 'superadmin'
            ? 'System administration'
            : 'Academic administration'
        }
        description="Run the school year — setup progress, today's numbers, and what needs attention."
        badges={ayCode ? [{ label: ayCode }] : []}
      />

      {health && <SystemHealthStrip health={health} />}

      {/* At-a-glance KPI strip — enrolled headcount, sections, pending
          change requests, and currently-open report card windows. */}
      {hubKpis && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Enrolled students"
            value={hubKpis.enrolledStudents}
            icon={Users}
            intent="default"
          />
          <MetricCard
            label="Active sections"
            value={hubKpis.activeSections}
            icon={LayoutGrid}
            intent="default"
          />
          <MetricCard
            label="Pending change requests"
            value={hubKpis.pendingChangeRequests}
            icon={GitBranch}
            intent={hubKpis.pendingChangeRequests > 0 ? 'warning' : 'default'}
            subtext={
              hubKpis.pendingChangeRequests > 0
                ? 'Awaiting approval'
                : 'All clear'
            }
          />
          <MetricCard
            label="Open report card windows"
            value={hubKpis.openPublicationWindows}
            icon={BookOpen}
            intent={hubKpis.openPublicationWindows > 0 ? 'good' : 'default'}
            subtext={
              hubKpis.openPublicationWindows > 0
                ? 'Parents can view now'
                : 'None active'
            }
          />
        </section>
      )}

      {/* Enrolled-but-unplaced students callout — actionable amber alert. */}
      {unassignedStudents.length > 0 && (
        <HubClassAssignmentCallout
          count={unassignedStudents.length}
          ayLabel={currentAy?.label}
        />
      )}

      {/* Year Setup — single guided entry point (the steps live in /sis/ay-setup). */}
      <section className="space-y-3">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Year Setup
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <HubYearSetupCard readiness={ayReadiness} />
        </div>
      </section>

      {/* Upcoming calendar events — next few events for the current AY. */}
      <HubUpcomingEventsCard events={upcomingEvents} />

      {/* Trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Activity className="size-3" strokeWidth={2.25} />
        <span>{ayCode || '—'}</span>
        <span className="text-border">·</span>
        <span>Refreshes every 2 minutes</span>
      </div>
    </PageShell>
  );
}
