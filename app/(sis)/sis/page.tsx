import { Activity, BookOpen, GitBranch, LayoutGrid, Users } from 'lucide-react';
import { unstable_cache } from 'next/cache';
import { redirect } from 'next/navigation';

import { HubAttentionFeed } from '@/components/sis/hub-attention-feed';
import { HubQuickActions } from '@/components/sis/hub-quick-actions';
import { HubStat } from '@/components/sis/hub-stat';
import { HubUpcomingEventsCard } from '@/components/sis/hub-upcoming-events-card';
import { HubYearBand } from '@/components/sis/hub-year-band';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { SystemHealthStrip } from '@/components/sis/system-health-strip';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { buildAttentionRows } from '@/lib/sis/hub-attention';
import { isTestAyCode } from '@/lib/sis/environment';
import {
  getClassAssignmentReadiness,
  getHubKpis,
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
  listSubjects,
  listSubjectLevelOfferings,
} from '@/lib/sis/subjects/queries';
import { listTemplateSubjectLevelOfferings } from '@/lib/sis/template/queries';
import {
  computeSubjectConfigGaps,
  type SubjectConfigGap,
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
  const ayReadiness = currentAy
    ? await getAyReadiness(currentAy.ay_code)
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
      : Promise.resolve([] as SubjectConfigGap[]),
  ]);

  const attentionRows = buildAttentionRows({
    unassigned: unassignedStudents,
    pendingChangeRequests: hubKpis?.pendingChangeRequests ?? 0,
    unassignedAdviserSections,
    approverFlowCounts,
    subjectConfigGaps: subjectConfigGapsForHub,
  });

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

// Levels whose Structure Defaults (template_subject_level_offerings)
// template says a subject SHOULD teach at, that this AY's
// subject_level_offerings is missing — same computation and offerings-based
// query shape as the warning banner on /sis/admin/subjects (migration 080
// moved "which levels a subject teaches at" off subject_configs/
// template_subject_configs onto these two offerings tables — see that
// page's source, this mirrors it), scoped to every in-use level rather
// than the page's single selected AY view. A missing attachment silently
// drops that subject from grading-sheet creation AND the report card with
// no visible signal anywhere else, so it earns a hub row.
async function loadSubjectConfigGapsForHubUncached(
  ayId: string
): Promise<SubjectConfigGap[]> {
  const [subjects, levels, offerings, templateOfferings] = await Promise.all([
    listSubjects(),
    listLevels(),
    listSubjectLevelOfferings(ayId),
    listTemplateSubjectLevelOfferings(),
  ]);
  return computeSubjectConfigGaps(
    levels,
    subjects,
    templateOfferings,
    offerings
  );
}

function loadSubjectConfigGapsForHubCached(
  ayId: string,
  ayCode: string
): Promise<SubjectConfigGap[]> {
  return unstable_cache(
    () => loadSubjectConfigGapsForHubUncached(ayId),
    ['sis-hub-subject-config-gaps', ayId],
    { revalidate: 60, tags: [`sis:${ayCode}`] }
  )();
}

async function loadSubjectConfigGapsForHub(
  ayId: string,
  ayCode: string
): Promise<SubjectConfigGap[]> {
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
