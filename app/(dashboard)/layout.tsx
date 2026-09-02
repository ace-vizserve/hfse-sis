import { redirect } from 'next/navigation';

import { CommandPaletteTrigger } from '@/components/sis/command-palette';
import { TopbarModuleSwitcher } from '@/components/topbar-module-switcher';
import { TopbarViewSwitcher } from '@/components/view-switch/topbar-view-switcher';
import { getViewContext } from '@/lib/auth/view-context';
import { resolveHiddenModules } from '@/lib/sidebar/resolve-hidden-modules';

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
  // `getViewContext`, not `getSessionUser`: these two pages had no profile
  // popover and therefore no way to change view at all, so a teaching admin
  // who landed on `/` was stuck in whichever view she arrived in. That was
  // tolerable while nothing pointed at the control; it stopped being tolerable
  // when the wrong-view notice started telling people to switch. `role` still
  // drives everything below that it drove before.
  const viewer = await getViewContext();
  if (!viewer) redirect('/login');

  const { role, entitled, activeRole } = viewer;
  if (!role) redirect('/login');

  // Both roles go in, and they answer different halves. The real `role` drives
  // the assignment-shaped narrowing, which only ever narrows a teacher and must
  // never take Attendance off an admin. `activeRole` drives the route-shaped
  // one: `/sis`, `/records`, `/p-files` and `/admissions` do not admit a
  // teacher, so the topbar switcher stops offering those tiles while a teaching
  // admin is in the Teacher view — and gives them straight back when she
  // switches home. See the ruling on `resolveTeacherNavScope`.
  const hiddenModules = await resolveHiddenModules(role, viewer.id, activeRole);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md">
        <TopbarModuleSwitcher role={role} hiddenModules={hiddenModules} />
        <div className="ml-auto w-full max-w-sm">
          <CommandPaletteTrigger placeholder="Search students or navigate…" />
        </div>
        {/* Renders nothing for an account with one view — which is every
            account but the six that also teach. */}
        <TopbarViewSwitcher entitled={entitled} activeRole={activeRole} />
      </header>
      <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10">
        {children}
      </div>
    </div>
  );
}
