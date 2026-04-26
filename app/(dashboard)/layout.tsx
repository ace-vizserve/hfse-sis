import { redirect } from 'next/navigation';

import { TopbarModuleSwitcher } from '@/components/topbar-module-switcher';
import { getSessionUser } from '@/lib/supabase/server';

// Neutral shared layout for pages that don't belong to any single module:
//   `/`                   — module picker (multi-module roles) + redirects
//   `/account`            — password / profile (every authenticated role)
//   `/admin/admissions`   — read-only Admissions analytics (no module yet)
//
// All module-specific chrome (sidebars, badges, module-scoped nav) lives in
// the respective (markbook) / (records) / (p-files) / (sis) layouts.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { role } = sessionUser;
  if (!role) redirect('/parent');
  if (role === 'p-file') redirect('/p-files');
  if (role === 'admissions') redirect('/admissions');

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
        <TopbarModuleSwitcher role={role} />
      </header>
      <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10">
        {children}
      </div>
    </div>
  );
}
