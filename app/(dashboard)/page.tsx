import { redirect } from 'next/navigation';
import { Sunrise, Sun, Moon } from 'lucide-react';

import { PageShell } from '@/components/ui/page-shell';
import { UpcomingCoverPanel } from '@/components/relief/upcoming-cover';
import { loadUpcomingCoverForUser } from '@/lib/relief/upcoming';
import { createClient } from '@/lib/supabase/server';
import { getViewContext } from '@/lib/auth/view-context';
import { resolveTeacherNavScope } from '@/lib/sidebar/resolve-hidden-modules';
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { sgHour } from '@/lib/dates';
import { getQuickActions, type QuickAction } from '@/lib/home/quick-actions';
import { greetingForHour, type GreetingBucket } from '@/lib/home/greeting';
import { getRecentActions } from '@/lib/home/recent-actions';
import { getHomeTodos, reportCardGapsTodo } from '@/lib/home/todos';
import { getUpcomingCalendarEvents } from '@/lib/sis/dashboard';
import { QuickActionsRow } from '@/components/home/quick-actions-row';
import { ComingUpPanel } from '@/components/home/coming-up-panel';
import { TodoPanel } from '@/components/home/todo-panel';
import { RecentActionsPanel } from '@/components/home/recent-actions-panel';

// Root `/` is the SIS entry point. Single-module roles auto-redirect to
// their module; the 4 multi-module roles (teacher, academic_coordinator,
// school_admin, superadmin) see a role-aware overview — quick actions,
// to-dos, upcoming events, and the signed-in user's own recent activity
// across every module. See
// docs/superpowers/specs/2026-07-24-home-role-overview-design.md.
export default async function Home() {
  const viewer = await getViewContext();
  if (!viewer) redirect('/login');

  const { role, email, id: userId, activeRole } = viewer;

  // One assignment read, two answers: which modules are dead ends for this
  // teacher (the home page must agree with the switchers), and which of the two
  // teaching jobs they hold — an adviser and a subject teacher share the
  // `teacher` role but do different work, so the actions and to-dos below are
  // filtered per job, not per role (KD #160).
  //
  // ⚠ TWO ROLES GO IN, DELIBERATELY. `hiddenModules` is keyed on the real
  // `role` — hiding a module only ever narrows a teacher, and must never take
  // Attendance away from an admin who happens to be looking as one. `profile`
  // is keyed on `activeRole`: in the Teacher view a teaching admin IS doing
  // adviser or subject work, and leaving it on her account role would give her
  // a Teacher home page with none of the teacher actions on it. The full
  // ruling is on `resolveTeacherNavScope`.
  //
  // ✅ AND THAT SECOND HALF IS NO LONGER DORMANT (Phase 3b). It was wired and
  // correct in 3a and still changed nothing on screen, because both consumers
  // picked their ROWS by the real role before `profile` was ever consulted —
  // `getQuickActions` indexed `QUICK_ACTIONS[role]` and `getHomeTodos` filtered
  // `source.roles.includes(role)`, and every row carrying a `requires:` or
  // reading `profile.*` sits under a `teacher`-only key. Both now take the view
  // as a fifth/sixth argument, so a teaching admin's home page finally shows the
  // marks and write-ups she owes instead of an admin's approvals.
  //
  // ⚠ `hiddenModules` now carries a second, route-shaped narrowing too — the
  // modules the VIEW cannot open — which is why `activeRole` matters to it as
  // well. The assignment half is still keyed on the real `role` and still must
  // be. Full ruling on `resolveTeacherNavScope`.
  const { hiddenModules, profile } = await resolveTeacherNavScope(
    role,
    userId,
    activeRole
  );

  // Same forced-redirect rules as before — unchanged from the plain-picker
  // version. Only the 4 multi-module roles ever render the rest of this
  // page.
  if (!role) redirect('/login');
  if (role === 'p_file_officer') redirect('/p-files');
  if (role === 'admissions') redirect('/admissions');

  // Falls back to email when no display name is set (getStaffDisplayNameById
  // → lib/auth/staff-list.ts::loadAllStaffUncached already does this).
  //
  // The capabilities go to getQuickActions: some of the pages it offers guard
  // on a CAPABILITY rather than a role name, so the row has to be able to ask
  // the same question the page will — otherwise it advertises work the page
  // bounces the viewer away from (KD #173). Cached and tagged `permissions`,
  // so this is not a fresh query per render.
  const [staffNames, capabilities] = await Promise.all([
    getStaffDisplayNameById(),
    getCapabilitiesForRole(role),
  ]);
  const displayName = new Map(staffNames).get(userId) ?? email;

  const ay = await getCurrentAcademicYear();

  // No current AY configured — render just the header + quick actions
  // rather than throwing a 500 on the very first page most roles land on
  // after login.
  if (!ay) {
    return (
      <PageShell>
        <Header
          name={displayName}
          quickActions={getQuickActions(
            role,
            hiddenModules,
            profile,
            capabilities,
            activeRole ?? role
          )}
        />
        <p className="mt-8 text-sm text-muted-foreground">
          No current academic year is set yet — ask a superadmin to configure
          one in SIS Admin.
        </p>
      </PageShell>
    );
  }

  // The lens, with the account role as the floor. `activeRole` is `null` only
  // for a viewer with no staff lens at all — a parent — and one never reaches
  // this page; naming `role` here rather than carrying `null` downstream keeps
  // that impossible case from having to be modelled in two row tables.
  const view = activeRole ?? role;

  // Every branch from here down names `view`, not `role`. The panel titles, the
  // rows in them and the cover panel all describe the job on screen, and a
  // Teacher view showing "To-do — approvals assigned to you" over a list of
  // marks due would be describing the other one.
  const todoTitle =
    view === 'teacher'
      ? 'Needs your attention'
      : view === 'school_admin'
        ? 'To-do — approvals assigned to you'
        : 'To-do';

  const [quickActions, recentActions, baseTodos, reportCardGaps, events] =
    await Promise.all([
      Promise.resolve(
        getQuickActions(role, hiddenModules, profile, capabilities, view)
      ),
      getRecentActions(email),
      getHomeTodos(role, ay.ay_code, userId, profile, capabilities, view),
      // ⚠ ON THE VIEW TOO, THOUGH THE BRIEF DID NOT NAME IT — because it is
      // appended to the SAME panel `getHomeTodos` just filled, and leaving it
      // on the account role would put one oversight row ("N report cards have
      // no adviser comment") at the bottom of an otherwise teacher-shaped list.
      // Half-lensing one panel is the defect this phase exists to remove, not a
      // smaller version of it.
      view === 'academic_coordinator' ||
      view === 'school_admin' ||
      view === 'superadmin'
        ? reportCardGapsTodo(ay.ay_code)
        : Promise.resolve(null),
      getUpcomingCalendarEvents(ay.ay_code, 2, 14),
    ]);

  // Cover this teacher is booked to take but cannot open yet (migration 123).
  // ⚠ Read with the CALLER'S client on purpose — the row-read policy is
  // deliberately unwindowed, so a teacher can see their own booking without
  // anything here reaching for the service client.
  //
  // ⚠ ON THE VIEW, AND RLS IS WHAT MAKES THAT SAFE. The old `role === 'teacher'`
  // test was an optimisation, not a gate: the query runs through the caller's
  // own client against a policy that already scopes it to their own bookings,
  // so a viewer with no cover gets an empty array whatever role is named here.
  // A teaching admin standing in for a colleague is exactly who this panel is
  // for, and in the Admin view she still does not see it — the same read, one
  // view later, is the whole feature.
  const upcomingCover =
    view === 'teacher'
      ? await loadUpcomingCoverForUser(await createClient(), userId)
      : [];

  const todos = reportCardGaps ? [...baseTodos, reportCardGaps] : baseTodos;

  return (
    <PageShell>
      <Header name={displayName} quickActions={quickActions} />
      <UpcomingCoverPanel covers={upcomingCover} className="mt-8" />
      {/* The panel renders nothing when there is no cover booked, which is the
          ordinary case — so the gap below the header has to come from here
          instead, or every teacher without cover gets a tighter page. */}
      <div
        className={`${upcomingCover.length > 0 ? 'mt-6' : 'mt-8'} mb-6 flex flex-col gap-3 lg:flex-row lg:items-stretch`}
      >
        <TodoPanel title={todoTitle} items={todos} />
        <ComingUpPanel events={events} />
      </div>
      <RecentActionsPanel actions={recentActions} />
    </PageShell>
  );
}

const GREETING_ICON: Record<GreetingBucket, typeof Sunrise> = {
  morning: Sunrise,
  afternoon: Sun,
  evening: Moon,
};

function Header({
  name,
  quickActions,
}: {
  name: string;
  quickActions: QuickAction[];
}) {
  const { label, bucket } = greetingForHour(sgHour());
  const GreetingIcon = GREETING_ICON[bucket];

  return (
    <header className="flex flex-col gap-6 border-b border-border pb-7 md:flex-row md:items-end md:justify-between">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <GreetingIcon className="size-[21px]" />
        </div>
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            HFSE · Student Information System
          </p>
          <h1 className="mt-2 font-serif text-[32px] font-semibold leading-[1.08] tracking-tight text-foreground md:text-[38px]">
            {label}, {name}.
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Here&apos;s where things stand across your modules today.
          </p>
        </div>
      </div>
      <QuickActionsRow actions={quickActions} />
    </header>
  );
}
