import { redirect } from 'next/navigation';

import { PageShell } from '@/components/ui/page-shell';
import { getSessionUser } from '@/lib/supabase/server';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getQuickActions } from '@/lib/home/quick-actions';
import { getHomeKpis } from '@/lib/home/kpis';
import { getModuleCards } from '@/lib/home/module-cards';
import { getHomeTodos, reportCardGapsTodo } from '@/lib/home/todos';
import { getUpcomingCalendarEvents } from '@/lib/sis/dashboard';
import { QuickActionsRow } from '@/components/home/quick-actions-row';
import { SnapshotCard } from '@/components/home/snapshot-card';
import { ComingUpPanel } from '@/components/home/coming-up-panel';
import { TodoPanel } from '@/components/home/todo-panel';
import { ModuleCardGrid } from '@/components/home/module-card-grid';

// Root `/` is the SIS entry point. Single-module roles auto-redirect to
// their module; the 4 multi-module roles (teacher, academic_coordinator,
// school_admin, superadmin) see a role-aware overview — quick actions,
// to-dos, upcoming events, KPIs, and a module-card grid scoped to what
// isRouteAllowed lets them open. See
// docs/superpowers/specs/2026-07-24-home-role-overview-design.md.
export default async function Home() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { role, email, id: userId } = sessionUser;

  // Same forced-redirect rules as before — unchanged from the plain-picker
  // version. Only the 4 multi-module roles ever render the rest of this
  // page.
  if (!role) redirect('/login');
  if (role === 'p_file_officer') redirect('/p-files');
  if (role === 'admissions') redirect('/admissions');

  const ay = await getCurrentAcademicYear();

  // No current AY configured — render the header + quick actions + an empty
  // module grid rather than throwing a 500 on the very first page most
  // roles land on after login.
  if (!ay) {
    return (
      <PageShell className="max-w-[1040px]">
        <Header email={email} />
        <QuickActionsRow actions={getQuickActions(role)} />
        <p className="text-sm text-muted-foreground">
          No current academic year is set yet — ask a superadmin to configure
          one in SIS Admin.
        </p>
      </PageShell>
    );
  }

  const todoTitle =
    role === 'teacher'
      ? 'Needs your attention'
      : role === 'school_admin'
        ? 'To-do — approvals assigned to you'
        : 'To-do';

  const [quickActions, kpis, moduleCards, baseTodos, reportCardGaps, events] =
    await Promise.all([
      Promise.resolve(getQuickActions(role)),
      getHomeKpis(role, ay.ay_code),
      getModuleCards(role, ay.ay_code, userId),
      getHomeTodos(role, ay.ay_code, userId),
      role === 'academic_coordinator' ||
      role === 'school_admin' ||
      role === 'superadmin'
        ? reportCardGapsTodo(ay.ay_code)
        : Promise.resolve(null),
      getUpcomingCalendarEvents(ay.ay_code, 2, 14),
    ]);

  const todos = reportCardGaps ? [...baseTodos, reportCardGaps] : baseTodos;

  return (
    <PageShell className="max-w-[1040px]">
      <Header email={email} />
      <QuickActionsRow actions={quickActions} />
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start">
        <TodoPanel title={todoTitle} items={todos} />
        <div className="flex flex-col gap-3 lg:w-[300px] lg:shrink-0">
          <ComingUpPanel events={events} />
          <SnapshotCard kpis={kpis} />
        </div>
      </div>
      <ModuleCardGrid cards={moduleCards} />
    </PageShell>
  );
}

function Header({ email }: { email: string }) {
  return (
    <header className="mb-5">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        HFSE · Student Information System
      </p>
      <h1 className="font-serif text-[28px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[32px]">
        Good morning, {email}.
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Here&apos;s where things stand across your modules today.
      </p>
    </header>
  );
}
