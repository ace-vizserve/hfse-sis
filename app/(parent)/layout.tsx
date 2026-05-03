import { redirect } from 'next/navigation';
import { GraduationCap } from 'lucide-react';
import { getParentSession } from '@/lib/parent/get-parent-session';
import { getSessionUser } from '@/lib/supabase/server';
import { ParentSessionWatcher } from './parent-session-watcher';
import { ParentSignoutButton } from './parent-signout-button';

// Parent surface is an avenue for parents to view their children's report
// cards — nothing else. No sidebar, no module switcher, no per-page nav.
// Just a thin top header (school identity + signed-in email + sign-out)
// and the content beneath. Anything navigation-y belongs in the content
// itself (e.g. the dashboard's child-card grid links to per-student
// report cards).
export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const session = await getParentSession();
  if (!session) {
    // No valid parent_session cookie. Two cases worth distinguishing:
    //   (a) A real staff user (non-null role) navigated here without
    //       handing off — bounce to the staff dashboard so they don't
    //       get unceremoniously kicked out to the external parent portal.
    //   (b) Anyone else — anonymous OR a stale null-role Supabase JWT
    //       leftover from the pre-KD-#65 setSession flow. Both belong
    //       at the parent portal where the SSO originates; never send
    //       them to "/" or "/login" because those are staff surfaces
    //       and a parent with a null-role JWT would see the SIS module
    //       picker (or worse, an infinite redirect dance).
    const staff = await getSessionUser();
    if (staff && staff.role !== null) {
      redirect('/');
    }
    const portalUrl =
      process.env.NEXT_PUBLIC_PARENT_PORTAL_URL ??
      'https://enrol.hfse.edu.sg/admission/dashboard';
    redirect(portalUrl);
  }

  return (
    <div className="min-h-svh bg-muted print:bg-background">
      {/* Thin top header — school identity on the left, signed-in email +
          sign-out on the right. Hidden on print so the report card prints
          cleanly without the chrome. */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6 print:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <GraduationCap className="size-4" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="font-serif text-[15px] font-semibold tracking-tight text-foreground">
              HFSE International School
            </div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Report cards
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span
            className="hidden max-w-[260px] truncate text-xs text-muted-foreground sm:inline"
            title={session.email}
          >
            {session.email}
          </span>
          <ParentSignoutButton />
        </div>
      </header>

      <main className="px-4 py-8 sm:px-6 md:px-10 md:py-10 print:p-0">
        <ParentSessionWatcher />
        {children}
      </main>
    </div>
  );
}
