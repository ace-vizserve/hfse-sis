import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/supabase/server';
import { ModuleSidebar } from '@/components/module-sidebar';
import {
  SIDEBAR_GROUPS_COOKIE,
  expandedGroupsFor,
} from '@/lib/sidebar/group-state';
import { FeedbackSheet } from '@/components/feedback-sheet';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AyBanner } from '@/components/sis/ay-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getStaffCount } from '@/lib/auth/staff-list';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { resolveHiddenModules } from '@/lib/sidebar/resolve-hidden-modules';
import type { SidebarCounts } from '@/lib/auth/roles';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import {
  getDeclarationWaitingCount,
  getStagedWaitingCount,
} from '@/lib/sidebar/notification-counts';
import { GRADE_CHANGE_FLOWS } from '@/lib/change-requests/staged-flows';
import { getAyReadiness } from '@/lib/sis/readiness';
import { getSectionsCount } from '@/lib/sis/sidebar-counts';
import { createServiceClient } from '@/lib/supabase/service';

// Cache Components (next.config.ts) requires each segment to prerender into a
// static shell or declare that it blocks. This layout reads cookies() to gate on
// the session (KD #35), so it legitimately blocks. Kept on the MODULE layout, not
// the root, so the rest of the app keeps validating; pages below can opt back in.
export const instant = false;

export default async function SisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const view = await getSessionUser();
  if (!view) redirect('/login');

  const { id, email, role, roles } = view;
  // THE INVARIANT: a route-GROUP layout is the UNION of its group's
  // ROUTE_ACCESS rows, never the intersection. The layout runs before the page,
  // so it must admit every role allowed on ANY path in the group — otherwise it
  // shuts someone out of a route the route table explicitly grants them, and the
  // symptom is a redirect from a page that never got to run its own guard.
  //
  // Which is why `admissions` appears here while the broad `/sis` ROUTE_ACCESS
  // row excludes them: they are admitted by the longer-prefix
  // `/sis/admin/discount-codes` row (KD #133), the single cross-module surface
  // they own operationally. That is NOT a leak and must not be "tidied" into
  // matching the `/sis` row — doing so would break Discount Codes for the team
  // that uses it. The narrowing is the per-route gate's job, and it does it:
  // longest-prefix-wins keeps them on that one route, every other /sis nav entry
  // is hidden from them via `requiresRoles`, and the bare Admin Hub link is
  // gated, so they see no dead links.
  //
  // Same reasoning admits `academic_coordinator`, who holds rows for ay-setup,
  // calendar, sections, staff and admin/subjects plus the `/sis` hub itself
  // (KD #169), while audit-log, school-config, approvers and admin/roles carry
  // longer-prefix rows that keep her out.
  if (
    role !== 'admissions' &&
    role !== 'academic_coordinator' &&
    role !== 'school_admin' &&
    role !== 'superadmin'
  ) {
    if (!role) redirect('/login');
    redirect('/');
  }

  // ⚠ TWO WAVES, NOT SIX. Everything here feeds the SIDEBAR and the header —
  // `{children}` reads none of it — but it sat in the layout body as a chain of
  // separate `await`s, so every page in this module waited for the whole chain
  // before rendering a pixel. Measured against AY2026 on a warm connection:
  // capabilities 295ms, then readiness 581ms (20 queries, for one "3/8" chip),
  // then sections+staff 296ms — 1,172ms of chrome decoration on the critical
  // path, and that is before the three counts below, which were two more waves.
  //
  // Only `readiness` and `sectionsCount` genuinely depend on anything (the
  // current AY). The rest were sequential by habit. Wave 1 issues every
  // independent read together; wave 2 issues the two that need the AY.
  //
  // Role conditionals are unchanged — a role that skipped a fetch before still
  // skips it, it just skips it in parallel. `Promise.resolve(null)` keeps the
  // tuple positions stable so the skip stays as readable as the fetch.
  //
  // Sections/Staff are fetched only for the roles that see those nav items
  // (academic coordinator + school_admin + superadmin); admissions (a single
  // Discount Codes link) and any other role skip them entirely.
  const canSeeYearNav =
    role === 'academic_coordinator' ||
    role === 'school_admin' ||
    role === 'superadmin';
  // Same three roles as `canSeeYearNav` today, named separately because they
  // answer different questions — one is "does this nav group exist for you",
  // the other "can you decide a change request". Collapsing them would make a
  // future divergence silent.
  const canSeeChangeRequests =
    role === 'academic_coordinator' ||
    role === 'school_admin' ||
    role === 'superadmin';
  const service = createServiceClient();

  const [
    cookieStore,
    capabilities,
    currentAy,
    staffCount,
    changeRequestCount,
    // Not gated on role: being an approver is decided by being ON a step, not
    // by holding a role, so the count answers that itself and returns 0.
    declarationCount,
    gradeChangeStepCount,
    // Always empty here, and cheaply so — the only tiles this hides are the
    // ones a subject-teacher-only account cannot use, and `/sis` does not admit
    // a teacher at all. Called anyway so all eight layouts read the same and
    // none has to carry that rule in its head. It costs no query:
    // `resolveHiddenModules` returns early for a non-teacher role. See
    // lib/sidebar/module-visibility.ts.
    hiddenModules,
  ] = await Promise.all([
    cookies(),
    getCapabilitiesForRole(role),
    getCurrentAcademicYear(),
    canSeeYearNav ? getStaffCount() : Promise.resolve(null),
    canSeeChangeRequests
      ? getSidebarChangeRequestCount(service, role, id)
      : Promise.resolve(null),
    getDeclarationWaitingCount(service, role, id),
    // Grade changes decided step by step — same "on a step" rule.
    getStagedWaitingCount(service, role, id, GRADE_CHANGE_FLOWS),
    resolveHiddenModules(role, id),
  ]);

  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';
  const expandedGroups = expandedGroupsFor(
    cookieStore.get(SIDEBAR_GROUPS_COOKIE)?.value,
    'sis'
  );

  // Wave 2 — the only two reads that needed the AY resolved first. AY Setup's
  // chip reuses `readiness` (the same data powers the floating readiness pill),
  // so it costs no extra query.
  const [readiness, sectionsCount] = await Promise.all([
    (role === 'school_admin' || role === 'superadmin') && currentAy
      ? getAyReadiness(currentAy.ay_code)
      : Promise.resolve(null),
    canSeeYearNav && currentAy
      ? getSectionsCount(currentAy.ay_code)
      : Promise.resolve(null),
  ]);

  const sidebarCounts: SidebarCounts = {};
  if (readiness) {
    sidebarCounts.aySetupReadiness = `${readiness.complete}/${readiness.total}`;
  }
  if (sectionsCount != null) {
    sidebarCounts.sectionsCount = String(sectionsCount);
  }
  if (staffCount != null) {
    sidebarCounts.staffCount = String(staffCount);
  }

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="sis"
        role={role}
        email={email}
        userId={id}
        counts={sidebarCounts}
        hiddenModules={hiddenModules}
        capabilities={capabilities}
        expandedGroups={expandedGroups}
        roles={roles}
      />
      <SidebarInset>
        <AyBanner />
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
          <div className="flex items-center w-full mx-auto max-w-[1440px]">
            <SidebarTrigger className="-ml-1" />
            <div className="ml-auto flex items-center gap-2">
              <FeedbackSheet />
              <NotificationBell
                role={role}
                userId={id}
                initialCount={changeRequestCount}
                initialDeclarationCount={declarationCount}
                initialGradeChangeStepCount={gradeChangeStepCount}
              />
            </div>
          </div>
        </header>
        <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
