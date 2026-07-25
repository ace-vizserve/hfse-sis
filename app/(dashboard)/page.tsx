import { redirect } from 'next/navigation';
import { Sunrise, Sun, Moon } from 'lucide-react';

import { PageShell } from '@/components/ui/page-shell';
import { getSessionUser } from '@/lib/supabase/server';
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

  // No current AY configured — render just the header + quick actions
  // rather than throwing a 500 on the very first page most roles land on
  // after login.
  if (!ay) {
    return (
      <PageShell>
        <Header email={email} quickActions={getQuickActions(role)} />
        <p className="mt-8 text-sm text-muted-foreground">
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

  const [quickActions, recentActions, baseTodos, reportCardGaps, events] =
    await Promise.all([
      Promise.resolve(getQuickActions(role)),
      getRecentActions(email),
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
    <PageShell>
      <Header email={email} quickActions={quickActions} />
      <div className="mt-8 mb-6 flex flex-col gap-3 lg:flex-row lg:items-stretch">
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
  email,
  quickActions,
}: {
  email: string;
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
            {label}, {email}.
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
