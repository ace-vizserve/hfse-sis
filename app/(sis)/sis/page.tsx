import { Activity, BookOpen, GitBranch, LayoutGrid, Users } from 'lucide-react';
import { unstable_cache } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ComparisonBarPoint } from '@/components/dashboard/charts/comparison-bar-chart';
import { AuditDailyTrendCard } from '@/components/sis/audit-daily-trend-card';
import { AuditByModuleDrillCard } from '@/components/sis/drills/audit-by-module-drill-card';
import { HubAttentionFeed } from '@/components/sis/hub-attention-feed';
import { HubModuleOverview } from '@/components/sis/hub-module-overview';
import { HubQuickActions } from '@/components/sis/hub-quick-actions';
import { HubSnapshotCard } from '@/components/sis/hub-snapshot-card';
import { HubStat } from '@/components/sis/hub-stat';
import { HubUpcomingEventsCard } from '@/components/sis/hub-upcoming-events-card';
import { HubYearBand } from '@/components/sis/hub-year-band';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { StructuralChangesFeedCard } from '@/components/sis/structural-changes-feed-card';
import { SystemHealthStrip } from '@/components/sis/system-health-strip';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { resolveCompareAy } from '@/lib/dashboard/comparison';
import type { RangeInput } from '@/lib/dashboard/range';
import { sgToday } from '@/lib/dates';
import { buildAttentionRows } from '@/lib/sis/hub-attention';
import { getHubModuleOverview } from '@/lib/sis/hub-module-overview';
import { getHubSnapshot } from '@/lib/sis/hub-snapshot';
import { isTestAyCode } from '@/lib/sis/environment';
import {
  getAuditActivityByModule,
  getAuditDailyTrend,
  getClassAssignmentReadiness,
  getHubKpis,
  getStructuralChangeFeed,
  getUpcomingCalendarEvents,
} from '@/lib/sis/dashboard';
import { getSystemHealth } from '@/lib/sis/health';
import { getAyReadiness } from '@/lib/sis/readiness';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { loadFormAdvisersBySection } from '@/lib/sis/staff';
import { listAllApproverAssignments } from '@/lib/sis/approvers/queries';
import {
  listLevels,
  listSubjectLevelOfferings,
} from '@/lib/sis/subjects/queries';
import {
  findEmptyLevels,
  type EmptyLevelGap,
} from '@/lib/sis/subject-config-gaps';

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

  // Plain RangeInput objects built directly via raw Date.UTC math (KD #32) —
  // the hub has no date-range picker, so none of the shared Preset windows
  // apply here (see lib/dashboard/range.ts's Preset union).
  const today = sgToday();
  const isoDaysAgo = (days: number) => {
    const d = new Date(
      Date.UTC(
        Number(today.slice(0, 4)),
        Number(today.slice(5, 7)) - 1,
        Number(today.slice(8, 10))
      )
    );
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const trendRange: RangeInput = {
    ayCode,
    from: isoDaysAgo(13),
    to: today,
    cmpFrom: null,
    cmpTo: null,
  };
  const weekRange: RangeInput = {
    ayCode,
    from: isoDaysAgo(6),
    to: today,
    cmpFrom: null,
    cmpTo: null,
  };

  const ayReadiness = currentAy
    ? await getAyReadiness(currentAy.ay_code)
    : null;

  const ayCodes = ayCode ? await listAyCodes(service) : [];
  const compareAyCode = ayCode
    ? resolveCompareAy(undefined, ayCodes, ayCode)
    : null;

  // System-health strip is superadmin-only (approver counts are sensitive to
  // their operational awareness). school_admin sees the hub without it. The
  // new approver-flow-counts attention signal follows the same gate — it
  // reads the same /sis/admin/approvers-only data (ROUTE_ACCESS restricts
  // that page to superadmin).
  const [
    health,
    hubKpis,
    unassignedStudents,
    upcomingEvents,
    unassignedAdviserSections,
    approverFlowCounts,
    subjectConfigGapsForHub,
    hubSnapshot,
    moduleOverview,
    structuralChanges,
    auditTrend,
    auditByModule,
  ] = await Promise.all([
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
      ? loadUnassignedAdviserSections(currentAy.id, currentAy.ay_code)
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    role === 'superadmin'
      ? loadApproverFlowCounts()
      : Promise.resolve({} as Record<string, number>),
    currentAy
      ? loadSubjectConfigGapsForHub(currentAy.id, currentAy.ay_code)
      : Promise.resolve([] as EmptyLevelGap[]),
    ayCode ? getHubSnapshot(ayCode).catch(() => null) : Promise.resolve(null),
    ayCode
      ? getHubModuleOverview(ayCode, compareAyCode).catch(
          () => [] as Awaited<ReturnType<typeof getHubModuleOverview>>
        )
      : Promise.resolve([] as Awaited<ReturnType<typeof getHubModuleOverview>>),
    getStructuralChangeFeed().catch(
      () => [] as Awaited<ReturnType<typeof getStructuralChangeFeed>>
    ),
    ayCode
      ? getAuditDailyTrend(trendRange).catch(() => null)
      : Promise.resolve(null),
    ayCode
      ? getAuditActivityByModule(weekRange).catch(() => null)
      : Promise.resolve(null),
  ]);

  const attentionRows = buildAttentionRows({
    unassigned: unassignedStudents,
    pendingChangeRequests: hubKpis?.pendingChangeRequests ?? 0,
    unassignedAdviserSections,
    approverFlowCounts,
    subjectConfigGaps: subjectConfigGapsForHub,
  });

  // Mirrors the identical chartData derivation on /sis/audit-log's Overview
  // tab (KD #154) — same RangeResult<AuditModulePoint[]> shape, same
  // current[i]/comparison[i] index alignment.
  const auditByModuleData: ComparisonBarPoint[] = auditByModule
    ? auditByModule.current.map((row, i) => ({
        category: row.module,
        current: row.count,
        ...(auditByModule.comparison
          ? { comparison: auditByModule.comparison[i]?.count ?? 0 }
          : {}),
      }))
    : [];

  return (
    <PageShell>
      <SisPageHeader
        showBackLink={false}
        group={role === 'superadmin' ? 'Admin hub' : 'Academic admin'}
        title={
          role === 'superadmin'
            ? 'System administration'
            : 'Academic administration'
        }
        description="Setup progress, today's numbers, and what needs attention — everything else is one click in the sidebar."
        chips={
          ayCode && (
            <>
              <Badge
                variant="outline"
                className={
                  isTestAyCode(ayCode)
                    ? 'h-7 border-brand-amber bg-brand-amber-light px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink'
                    : 'h-7 border-brand-mint bg-brand-mint/30 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink'
                }
              >
                {isTestAyCode(ayCode) ? 'Test' : 'Production'}
              </Badge>
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {ayCode}
              </Badge>
            </>
          )
        }
      />

      {health && <SystemHealthStrip health={health} />}

      <HubYearBand readiness={ayReadiness} />

      {hubSnapshot && <HubSnapshotCard snapshot={hubSnapshot} />}

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

      {moduleOverview.length > 0 && <HubModuleOverview rows={moduleOverview} />}

      <section className="grid gap-3 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <HubAttentionFeed rows={attentionRows} />
        </div>
        <div className="lg:col-span-2">
          <HubUpcomingEventsCard events={upcomingEvents} />
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <StructuralChangesFeedCard rows={structuralChanges} />
        {auditTrend && (
          <AuditDailyTrendCard
            current={auditTrend.current}
            comparison={auditTrend.comparison}
          />
        )}
      </div>

      {auditByModuleData.length > 0 && (
        <AuditByModuleDrillCard
          data={auditByModuleData}
          rangeFrom={weekRange.from}
          rangeTo={weekRange.to}
        />
      )}

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

// Sections in the current AY with zero `form_adviser` teacher_assignments
// row — a form-adviser-less section blocks FCA write-ups (KD #49) and the
// report-card publish comment gate (KD #129) for every student in it, so
// it's worth a "Needs attention" row rather than a silent gap discovered
// only when publishing fails weeks later.
//
// Composes the existing lib/sis/staff.ts::loadFormAdvisersBySection (itself
// unstable_cache-wrapped, tagged `sis:${ayCode}`) rather than re-querying
// teacher_assignments directly — same hoisted-uncached + per-call
// unstable_cache idiom as loadLevelDemand above, so this page's own section
// list is cached too (loadFormAdvisersBySection's cache alone wouldn't save
// the sections query).
async function loadUnassignedAdviserSectionsUncached(
  ayId: string,
  ayCode: string
): Promise<Array<{ id: string; name: string }>> {
  const service = createServiceClient();
  const { data } = await service
    .from('sections')
    .select('id, name')
    .eq('academic_year_id', ayId);
  const sections = (data ?? []) as Array<{ id: string; name: string }>;
  if (sections.length === 0) return [];

  const advisersBySection = await loadFormAdvisersBySection(
    sections.map((s) => s.id),
    ayCode
  );
  return sections.filter((s) => !advisersBySection[s.id]);
}

function loadUnassignedAdviserSectionsCached(
  ayId: string,
  ayCode: string
): Promise<Array<{ id: string; name: string }>> {
  return unstable_cache(
    () => loadUnassignedAdviserSectionsUncached(ayId, ayCode),
    ['sis-hub-unassigned-advisers', ayId],
    { revalidate: 60, tags: [`sis:${ayCode}`] }
  )();
}

async function loadUnassignedAdviserSections(
  ayId: string,
  ayCode: string
): Promise<Array<{ id: string; name: string }>> {
  try {
    return await loadUnassignedAdviserSectionsCached(ayId, ayCode);
  } catch (err) {
    console.warn(
      '[sis hub] unassigned-adviser sections fetch failed:',
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

// Per-flow assigned-approver count, for the "under-resourced approver flow"
// attention row (superadmin-only, gated at the call site — mirrors the
// /sis/admin/approvers ROUTE_ACCESS restriction this data otherwise powers).
// Deliberately NOT unstable_cache-wrapped: `listAllApproverAssignments`
// composes `lib/sis/approvers/queries.ts`'s own request-scoped
// `React.cache` (getAllUsers) and approver_assignments has no existing
// revalidateTag convention (the /sis/admin/approvers page itself reads it
// uncached, per-request) — adding a new tag here with nothing to invalidate
// it would only add staleness risk for a small, cheap query.
async function loadApproverFlowCounts(): Promise<Record<string, number>> {
  try {
    const byFlow = await listAllApproverAssignments();
    return Object.fromEntries(
      Object.entries(byFlow).map(([flow, users]) => [flow, users.length])
    );
  } catch (err) {
    console.warn(
      '[sis hub] approver flow counts fetch failed:',
      err instanceof Error ? err.message : err
    );
    return {};
  }
}

// Levels this AY with zero subjects attached at all — same check the
// warning banner on /sis/admin/subjects uses, scoped to every level rather
// than the page's single selected AY view. A level with no subjects
// silently produces no grading sheets AND nothing on the report card for
// that level, with no visible signal anywhere else, so it earns a hub row.
async function loadSubjectConfigGapsForHubUncached(
  ayId: string
): Promise<EmptyLevelGap[]> {
  const [levels, offerings] = await Promise.all([
    listLevels(),
    listSubjectLevelOfferings(ayId),
  ]);
  return findEmptyLevels(levels, offerings);
}

function loadSubjectConfigGapsForHubCached(
  ayId: string,
  ayCode: string
): Promise<EmptyLevelGap[]> {
  return unstable_cache(
    () => loadSubjectConfigGapsForHubUncached(ayId),
    ['sis-hub-subject-config-gaps', ayId],
    { revalidate: 60, tags: [`sis:${ayCode}`] }
  )();
}

async function loadSubjectConfigGapsForHub(
  ayId: string,
  ayCode: string
): Promise<EmptyLevelGap[]> {
  try {
    return await loadSubjectConfigGapsForHubCached(ayId, ayCode);
  } catch (err) {
    console.warn(
      '[sis hub] subject-config gaps fetch failed:',
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
