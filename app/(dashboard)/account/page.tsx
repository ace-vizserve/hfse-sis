import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { createClient } from '@/lib/supabase/server';
import { getViewContext } from '@/lib/auth/view-context';
import { createServiceClient } from '@/lib/supabase/service';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getRecentActivity } from '@/lib/account/activity';
import { getTeacherSections } from '@/lib/account/sections';
import { getThisTermStats } from '@/lib/account/this-term-stats';
import { shortcutsForRole } from '@/lib/account/shortcuts';
import { resolveHiddenModules } from '@/lib/sidebar/resolve-hidden-modules';
import { viewAllActivityHref } from '@/lib/account/view-all-target';
import { getStaffDisplayEntries } from '@/lib/auth/staff-list';
import { ChangePasswordForm } from './change-password-form';
import { AboutCard } from './about-card';
import { RecentActivityCard } from './recent-activity-card';
import { ShortcutsCard } from './shortcuts-card';
import { ThisTermCard } from './this-term-card';

export default async function AccountPage() {
  // `getViewContext`, not `getSessionUser`: this page carries two surfaces that
  // describe the job you are doing rather than the account you hold — the
  // section roster under "About" and the Shortcuts card — and both were reading
  // the account role while the switcher in the layout above said "Teacher". It
  // is the same read the layout already made this request (`cache()`d), so it
  // costs nothing extra here.
  const sessionUser = await getViewContext();
  const role = sessionUser?.role ?? null;
  const email = sessionUser?.email ?? '';
  // The lens, with the account role as the floor — see the same line in
  // app/(dashboard)/page.tsx. `role` still drives everything that authorises.
  const activeRole = sessionUser?.activeRole ?? role;

  const supabase = await createClient();
  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear();
  const ayCode = currentAy?.ay_code ?? '';

  // Independent per-account fetches — a single Promise.all so they run in
  // parallel rather than a waterfall. `getStaffDisplayEntries` gives a real
  // display name (staff full_name/name from auth user_metadata, KD #87)
  // instead of deriving one from the email's local part; `SessionUser`
  // (lib/supabase/server.ts) carries only id/email/role, no name field, so
  // this is genuinely a better source, not a stylistic choice. The
  // teacher-only section-roster query and the per-role stats query are only
  // *dispatched* when applicable (`Promise.resolve(...)` otherwise) — the
  // real DB call is skipped, not fired-and-discarded, for every other role.
  // Every branch here is defensive: layout.tsx already redirects away any
  // session with a null role before this component renders, but the old
  // page handled `role ?? null` explicitly too, so this keeps that safety
  // net rather than assuming the layout guarantee holds forever.
  const [activity, sections, stats, staffEntries] = await Promise.all([
    getRecentActivity(email),
    // ⚠ THE VIEW, NOT THE ACCOUNT ROLE. This lists the classes you teach, and
    // in the Teacher view a teaching admin teaches some — showing her nothing
    // there was the same "wired but never reached" gap as the home page's. Read
    // with the CALLER'S client and scoped to her own user id, so RLS is the
    // boundary and this branch is an optimisation, not a gate: it skips a query
    // whose answer is empty for anyone with no assignments.
    sessionUser && activeRole === 'teacher'
      ? getTeacherSections(supabase, sessionUser.id)
      : Promise.resolve(undefined),
    sessionUser && role
      ? getThisTermStats({
          role,
          userId: sessionUser.id,
          email,
          ayCode,
          supabase,
          service,
        })
      : Promise.resolve([]),
    getStaffDisplayEntries(),
  ]);

  const name =
    (email && new Map(staffEntries).get(email)) ||
    email.split('@')[0] ||
    'Account';

  const hiddenModules = sessionUser
    ? await resolveHiddenModules(role, sessionUser.id, activeRole)
    : [];
  // ⚠ THE TABLE STAYS ON THE ACCOUNT ROLE; THE FILTER CARRIES THE VIEW. The
  // shortcut for each module comes from `quickActionByRole`, which is a
  // role-keyed table like the home page's — but unlike that one it is not a
  // list of a job's daily work, it is "the one thing this account does in each
  // module it can open", and lensing it is a separate decision nobody has made.
  // What must NOT happen is this card offering "Browse students" while the
  // switcher three lines up has stopped showing the Records tile, and passing
  // the lensed `hiddenModules` is what prevents that: `shortcutsForRole` drops
  // any module on that list. She keeps a non-empty card either way — the
  // fallback in that helper lists every module still standing.
  const shortcuts = role ? shortcutsForRole(role, hiddenModules) : [];

  return (
    <PageShell>
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Home
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Account
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Account settings.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Your signed-in identity, recent activity, and how to change your
            password.
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:items-start">
        <div className="space-y-6">
          <AboutCard
            name={name}
            email={email}
            role={role}
            sections={sections}
          />
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
                Change password
              </CardTitle>
              <CardDescription>
                Use a strong password you don&apos;t use anywhere else. Minimum
                8 characters.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <RecentActivityCard
            rows={activity}
            viewAllHref={
              role ? viewAllActivityHref(role, email) : '/markbook/audit-log'
            }
          />
          <div className="grid gap-6 md:grid-cols-2">
            <ShortcutsCard shortcuts={shortcuts} />
            <ThisTermCard stats={stats} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
