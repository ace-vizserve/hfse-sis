import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getRecentActivity } from '@/lib/account/activity';
import { getTeacherSections } from '@/lib/account/sections';
import { resolveHiddenModules } from '@/lib/sidebar/resolve-hidden-modules';
import { viewAllActivityHref } from '@/lib/account/view-all-target';
import { MODULE_ORDER, SIDEBAR_REGISTRY } from '@/lib/sidebar/registry';
import { isRouteAllowed } from '@/lib/auth/roles';
import { getStaffDisplayEntries } from '@/lib/auth/staff-list';
import { ChangePasswordForm } from './change-password-form';
import { AccessCard } from './access-card';
import { IdentityBand } from './identity-band';
import { RecentActivityCard } from './recent-activity-card';

/**
 * The account page — who you are signed in as, what that gives you, and how to
 * change your password.
 *
 * ⚠ IT WAS THREE-FIFTHS A DASHBOARD UNTIL 2026-09-10. "Shortcuts" repeated the
 * module switcher a few inches away, "This term" repeated the home page, and
 * between them they pushed identity into a 300px rail. Mr Ace: *"make it a
 * proper account page"*. What survived is what is actually about the account:
 * identity, access, security, and your own activity.
 *
 * `lib/account/shortcuts.ts` and `this-term-card.tsx` are untouched and still
 * exported — the home page is next, and "This term" may well belong there
 * rather than nowhere. Deleting them before that decision would be throwing
 * away work to make one page tidy.
 */
export default async function AccountPage() {
  const sessionUser = await getSessionUser();
  const role = sessionUser?.role ?? null;
  const roles = sessionUser?.roles ?? [];
  const email = sessionUser?.email ?? '';

  const supabase = await createClient();
  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear();
  const ayCode = currentAy?.ay_code ?? '';

  // Independent per-account fetches — a single Promise.all so they run in
  // parallel rather than a waterfall. `getStaffDisplayEntries` gives a real
  // display name (staff full_name/name from auth user_metadata, KD #87)
  // instead of deriving one from the email's local part.
  //
  // ⚠ THE ASSIGNMENT QUERY IS NO LONGER GATED ON `role === 'teacher'`. It reads
  // `teacher_assignments` by USER id, so the gate never made it correct — it
  // only made it empty for everyone else, which is how four form-class
  // advisers on `school_admin` accounts ended up with no classes listed on
  // their own account page. Read with the CALLER'S client and scoped to their
  // own id, so RLS remains the boundary.
  const [activity, sections, staffEntries, authUser] = await Promise.all([
    getRecentActivity(email),
    sessionUser
      ? getTeacherSections(supabase, sessionUser.id)
      : Promise.resolve([]),
    getStaffDisplayEntries(),
    // `last_sign_in_at` lives on the auth record, not in the JWT claims, so it
    // needs the admin API. Failure is not fatal: the row simply doesn't render
    // rather than taking the page down over a nice-to-have.
    sessionUser
      ? service.auth.admin
          .getUserById(sessionUser.id)
          .then((r) => r.data.user)
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const name =
    (email && new Map(staffEntries).get(email)) ||
    email.split('@')[0] ||
    'Account';

  const hiddenModules = sessionUser
    ? await resolveHiddenModules(role, sessionUser.id)
    : [];

  // The same question the module switcher asks, answered the same way — a
  // module is yours if the route table admits your role and the teaching lens
  // hasn't hidden it. Asked here rather than reimplemented so the two cannot
  // disagree about what you can open.
  const modules = MODULE_ORDER.filter(
    (m) =>
      isRouteAllowed(SIDEBAR_REGISTRY[m].primaryHref, role) &&
      !hiddenModules.includes(m)
  ).map((m) => SIDEBAR_REGISTRY[m].label);

  const lastSignIn = authUser?.last_sign_in_at ?? null;

  return (
    <PageShell>
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Home
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Account
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Account settings.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Who you&apos;re signed in as, what that gives you access to, and how
          to change your password.
        </p>
      </header>

      <IdentityBand name={name} email={email} role={role} roles={roles} />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <AccessCard modules={modules} sections={sections ?? []} />

        <Card>
          <CardHeader>
            <CardDescription>Password and sign-in</CardDescription>
            <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Security
            </CardTitle>
            <CardAction>
              <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <ShieldCheck className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            {lastSignIn && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted px-3 py-2.5">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Last signed in
                </span>
                <span className="font-mono text-[12.5px] tabular-nums text-foreground">
                  {new Intl.DateTimeFormat('en-SG', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'Asia/Singapore',
                  }).format(new Date(lastSignIn))}
                </span>
              </div>
            )}
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Use a strong password you don&apos;t use anywhere else. Minimum 8
              characters.
            </p>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>

      <RecentActivityCard
        rows={activity}
        viewAllHref={
          role ? viewAllActivityHref(role, email) : '/markbook/audit-log'
        }
      />

      {/* §7.7 mono trust strip. This page is where someone checks what their
          account can do, so the line that matters is that the system is
          keeping a record of it. */}
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {ayCode ? `${ayCode} · ` : ''}Every change you make is recorded in the
        audit log
      </p>
    </PageShell>
  );
}
