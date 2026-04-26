import {
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  FileStack,
  FolderKanban,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { isRouteAllowed } from '@/lib/auth/roles';
import { getSessionUser } from '@/lib/supabase/server';

// Root `/` is the SIS entry point. Single-module roles auto-redirect to
// their module; multi-module roles see a "pick a module" tile picker
// — same lifecycle order + same canonical role gate as the top-bar
// switcher, so the picker can't drift from ROUTE_ACCESS.
//
// Lifecycle order: Admissions → Records → P-Files → Markbook → Attendance
// → Evaluation → SIS Admin (matches lib/sidebar/registry.ts MODULE_ORDER).
const MODULES: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/admissions', label: 'Admissions', icon: FileStack },
  { href: '/records', label: 'Records', icon: Users },
  { href: '/p-files', label: 'P-Files', icon: FolderKanban },
  { href: '/markbook', label: 'Markbook', icon: BookOpen },
  { href: '/attendance', label: 'Attendance', icon: CalendarCheck },
  { href: '/evaluation', label: 'Evaluation', icon: ClipboardCheck },
  { href: '/sis', label: 'SIS Admin', icon: ShieldCheck },
];

export default async function Home() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { role, email } = sessionUser;

  // Roles with 0 or 1 module accesses skip the picker — there's nothing to
  // pick. Everyone else (teacher, registrar, school_admin, admin, superadmin)
  // sees the centered tile picker, scoped to the modules they can open.
  if (!role) redirect('/parent');
  if (role === 'p-file') redirect('/p-files');
  if (role === 'admissions') redirect('/admissions');
  // Only modules the role can actually open are rendered — disabled tiles
  // are dropped entirely (no dimmed-and-locked treatment).
  const visibleModules = MODULES.filter((m) => isRouteAllowed(m.href, role));

  return (
    <PageShell>
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-10 text-center">
        <header className="max-w-2xl space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            HFSE · Student Information System
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Pick a module.
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{email}</span>. Every module
            surfaces a different facet of the same student record.
          </p>
        </header>

        <section className="flex flex-wrap justify-center gap-4">
          {visibleModules.map((m) => (
            <ModuleTile key={m.href} href={m.href} label={m.label} icon={m.icon} />
          ))}
        </section>
      </div>
    </PageShell>
  );
}

function ModuleTile({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Link href={href} className="block">
      <Card className="@container/card flex aspect-square w-40 cursor-pointer flex-col items-center justify-center gap-4 p-6 text-center transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md md:w-44">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <Icon className="size-6" />
        </div>
        <span className="font-serif text-base font-semibold tracking-tight text-foreground">
          {label}
        </span>
      </Card>
    </Link>
  );
}
