import { redirect } from 'next/navigation';

import { CommandPaletteTrigger } from '@/components/sis/command-palette';
import { TopbarModuleSwitcher } from '@/components/topbar-module-switcher';
import { resolveHiddenModules } from '@/lib/sidebar/resolve-hidden-modules';
import { getSessionUser } from '@/lib/supabase/server';

// Cache Components (next.config.ts) requires each segment to prerender into a
// static shell or declare that it blocks. This layout reads cookies() to gate on
// the session (KD #35), so it legitimately blocks. Kept on the MODULE layout, not
// the root, so the rest of the app keeps validating; pages below can opt back in.
export const instant = false;

// Neutral shared layout for pages that don't belong to any single module:
//   `/`                   — module picker (multi-module roles) + redirects
//   `/account`            — password / profile (every authenticated role)
//   `/admin/admissions`   — read-only Admissions analytics (no module yet)
//
// All module-specific chrome (sidebars, badges, module-scoped nav) lives in
// the respective (markbook) / (records) / (p-files) / (sis) layouts.
//
// The single-module redirects (p_file_officer → /p-files, admissions →
// /admissions) belong to `/` ALONE and live in its page, not here. Running
// them at the layout applied them to every child, which made `/account`
// unreachable for exactly those two roles — they bounced back to their module
// from the profile menu and so had no way to change their password in the app.
// Nothing is lost by not repeating them here:
//   `/`                 — app/(dashboard)/page.tsx runs the identical three.
//   `/admin/admissions` — ROUTE_ACCESS admits academic_coordinator+ only, and
//                         proxy.ts bounces everyone else to `/`, where the
//                         page redirect then applies.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { role } = sessionUser;
  if (!role) redirect('/login');

  const hiddenModules = await resolveHiddenModules(role, sessionUser.id);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md">
        <TopbarModuleSwitcher role={role} hiddenModules={hiddenModules} />
        <div className="ml-auto w-full max-w-sm">
          <CommandPaletteTrigger placeholder="Search students or navigate…" />
        </div>
      </header>
      <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10">
        {children}
      </div>
    </div>
  );
}
