import { Activity, BookOpen, GitBranch, LayoutGrid, Users } from 'lucide-react';
import { unstable_cache } from 'next/cache';
import { redirect } from 'next/navigation';

import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { HubAttentionFeed } from '@/components/sis/hub-attention-feed';
import { HubQuickActions } from '@/components/sis/hub-quick-actions';
import { HubStat } from '@/components/sis/hub-stat';
import { HubUpcomingEventsCard } from '@/components/sis/hub-upcoming-events-card';
import { HubYearBand } from '@/components/sis/hub-year-band';
import { SystemHealthStrip } from '@/components/sis/system-health-strip';
import { PageShell } from '@/components/ui/page-shell';
import {
  getCurrentAcademicYear,
  getUpcomingAcademicYear,
} from '@/lib/academic-year';
import { buildAttentionRows } from '@/lib/sis/hub-attention';
import { isTestAyCode } from '@/lib/sis/environment';
import {
  getClassAssignmentReadiness,
  getHubKpis,
  getUpcomingCalendarEvents,
} from '@/lib/sis/dashboard';
import { getSystemHealth } from '@/lib/sis/health';
import { getLevelRows, getOfferedLevelIds } from '@/lib/sis/levels';
import {
  computeLevelDemand,
  type LevelDemandRow,
} from '@/lib/sis/level-demand';
import { getAyReadiness } from '@/lib/sis/readiness';
import { getSessionUser } from '@/lib/supabase/server';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPages } from '@/lib/supabase/paginate';

// SIS Admin Hub — a command centre, not a menu (Task V1 of the visual
// redesign, `docs/superpowers/specs/2026-07-11-sis-admin-visual-redesign.html`
// Screen 1). Reachable only by school_admin + superadmin (guard below).
// Layout: hero → year band (signature element) → stat band → 3:2
// "Needs attention" / "Coming up" → quick actions. Everything below the
// hero is status or a launch point — nothing here duplicates the sidebar.
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
  const [health, hubKpis, unassignedStudents, upcomingEvents, levelDemand] =
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
      currentAy
        ? loadLevelDemand(currentAy.ay_code, currentAy.id)
        : Promise.resolve({
            rows: [] as LevelDemandRow[],
            acceptingAyCode: ayCode,
          }),
    ]);

  const attentionRows = buildAttentionRows({
    unassigned: unassignedStudents,
    pendingChangeRequests: hubKpis?.pendingChangeRequests ?? 0,
    levelDemand: levelDemand.rows,
    acceptingAyCode: levelDemand.acceptingAyCode,
  });

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
        description="Setup progress, today's numbers, and what needs attention — everything else is one click in the sidebar."
        badges={
          ayCode
            ? [
                {
                  label: isTestAyCode(ayCode) ? 'Test' : 'Production',
                  tone: isTestAyCode(ayCode) ? 'amber' : 'mint',
                },
                { label: ayCode },
              ]
            : []
        }
      />

      {health && <SystemHealthStrip health={health} />}

      <HubYearBand readiness={ayReadiness} />

      {hubKpis && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <HubStat
            label="Enrolled students"
            value={hubKpis.enrolledStudents}
            icon={Users}
            tone="brand"
          />
          <HubStat
            label="Active sections"
            value={hubKpis.activeSections}
            icon={LayoutGrid}
            tone="sky"
          />
          <HubStat
            label="Grade changes waiting"
            value={hubKpis.pendingChangeRequests}
            icon={GitBranch}
            tone={hubKpis.pendingChangeRequests > 0 ? 'amber' : 'muted'}
            subtext={
              hubKpis.pendingChangeRequests > 0
                ? 'Awaiting approval'
                : 'No changes waiting'
            }
          />
          <HubStat
            label="Report cards open to parents"
            value={hubKpis.openPublicationWindows}
            icon={BookOpen}
            tone={hubKpis.openPublicationWindows > 0 ? 'mint' : 'muted'}
            subtext={
              hubKpis.openPublicationWindows > 0
                ? 'Open to parents now'
                : 'None open right now'
            }
          />
        </section>
      )}

      <section className="grid gap-3 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <HubAttentionFeed rows={attentionRows} />
        </div>
        <div className="lg:col-span-2">
          <HubUpcomingEventsCard events={upcomingEvents} />
        </div>
      </section>

      <HubQuickActions />

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

// Demand for a level the accepting AY doesn't offer — same source + pattern
// as `/sis/admin/levels` (KD #118: the "accepting" AY is the open early-bird
// upcoming year if one exists, else the operationally current year). Kept
// local to this page since the hub only needs the un-offered/unknown rows
// (filtered downstream by `buildAttentionRows`), not the full manager UI.
// Returns the resolved `acceptingAyCode` alongside the rows so the caller
// (and `buildAttentionRows`, final-review fix #2) can say which AY a level
// isn't offered in, instead of a generic "this year."
async function loadLevelDemand(
  currentAyCode: string,
  currentAyId: string
): Promise<{ rows: LevelDemandRow[]; acceptingAyCode: string }> {
  try {
    // getUpcomingAcademicYear() uses a cookie-scoped server client (per its
    // own module doc) — per KD #54's gotcha, that must run here in the RSC
    // body, never inside unstable_cache. Only the resulting fetch (levels +
    // offered ids + admissions applications, all service-client) is cached.
    const upcoming = await getUpcomingAcademicYear();
    const acceptingAyId = upcoming?.id ?? currentAyId;
    const acceptingAyCode = upcoming?.ay_code ?? currentAyCode;
    const rows = await loadLevelDemandRowsCached(
      acceptingAyId,
      acceptingAyCode
    );
    return { rows, acceptingAyCode };
  } catch (err) {
    console.warn(
      '[sis hub] level demand fetch failed:',
      err instanceof Error ? err.message : err
    );
    return { rows: [], acceptingAyCode: currentAyCode };
  }
}

// Hoisted-uncached + per-call unstable_cache idiom (KD #46) — mirrors the
// caching already established for getLevelRows/getOfferedLevelIds
// (lib/sis/levels.ts), which this composes. Tagged both 'levels' (so a
// levels/offerings edit invalidates it, same tag those two use) and
// `sis:${acceptingAyCode}` (so an admissions-side write for that AY does
// too, per the existing `revalidateTag('sis:${ayCode}')` convention).
async function loadLevelDemandRowsUncached(
  acceptingAyId: string,
  acceptingAyCode: string
): Promise<LevelDemandRow[]> {
  const service = createServiceClient();
  const [levels, offeredSet] = await Promise.all([
    getLevelRows(service),
    getOfferedLevelIds(service, acceptingAyId),
  ]);

  const admissions = createAdmissionsClient();
  const prefix = `ay${acceptingAyCode.replace(/^AY/i, '').toLowerCase()}`;
  type AppLevelRow = { levelApplied: string | null };
  type PageResult<T> = PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;
  const apps = await fetchAllPages<AppLevelRow>(
    (from, to) =>
      admissions
        .from(`${prefix}_enrolment_applications`)
        .select('levelApplied')
        .range(from, to) as unknown as PageResult<AppLevelRow>
  );
  return computeLevelDemand(apps, levels, offeredSet);
}

function loadLevelDemandRowsCached(
  acceptingAyId: string,
  acceptingAyCode: string
): Promise<LevelDemandRow[]> {
  return unstable_cache(
    () => loadLevelDemandRowsUncached(acceptingAyId, acceptingAyCode),
    ['sis-hub-level-demand', acceptingAyId],
    { revalidate: 60, tags: ['levels', `sis:${acceptingAyCode}`] }
  )();
}
