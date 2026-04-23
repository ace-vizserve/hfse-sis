import { ArrowUpRight, BookOpen, FolderCog, FolderKanban, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import type { Role } from '@/lib/auth/roles';
import { getSessionUser } from '@/lib/supabase/server';

// Root `/` is the SIS entry point. All four modules are peers — no single
// module "owns" the root. Single-module roles auto-redirect to their module;
// multi-module roles see a neutral picker.
export default async function Home() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { role, email } = sessionUser;

  // Single-module roles: skip the picker, go straight to work.
  if (role === 'teacher') redirect('/markbook');
  if (role === 'p-file') redirect('/p-files');
  if (role === 'admissions') redirect('/admissions');
  if (!role) redirect('/parent');

  // Superadmin defaults to /sis per KD #42 — structural oversight, not daily
  // operational work. They can still pick any module via the switcher.
  if (role === 'superadmin') redirect('/sis');

  // Multi-module roles (registrar, school_admin, admin) see the picker.
  return (
    <PageShell>
      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          HFSE · Student Information System
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Pick a module.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{email}</span>. Every
          module below surfaces a different facet of the same student record. The module
          switcher in the top-left lets you pivot any time.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <ModuleCard
          href="/markbook"
          icon={BookOpen}
          eyebrow="Academic"
          title="Markbook"
          description="Grades, report cards, adviser comments, change-request workflow, and the current-AY dashboard with school-wide stats."
          cta="Open Markbook"
          role={role}
          allowedRoles={['registrar', 'school_admin', 'admin']}
        />
        <ModuleCard
          href="/records"
          icon={FolderCog}
          eyebrow="Operational"
          title="Records"
          description="Day-to-day student records — profiles, family, stage pipeline, document validation, discount-code catalogue."
          cta="Open Records"
          role={role}
          allowedRoles={['registrar', 'school_admin', 'admin']}
        />
        <ModuleCard
          href="/p-files"
          icon={FolderKanban}
          eyebrow="Documents"
          title="P-Files"
          description="Per-student document repository with revision history. Read-only for admin; full write for p-file officers."
          cta="Open P-Files"
          role={role}
          allowedRoles={['school_admin', 'admin']}
        />
        <ModuleCard
          href="/sis"
          icon={ShieldCheck}
          eyebrow="Structural"
          title="SIS Admin"
          description="AY setup, approver management, cross-module admin controls. Structural ops, not daily use."
          cta="Open SIS Admin"
          role={role}
          allowedRoles={['school_admin', 'admin']}
        />
      </section>
    </PageShell>
  );
}

function ModuleCard({
  href,
  icon: Icon,
  eyebrow,
  title,
  description,
  cta,
  role,
  allowedRoles,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
  role: Role | null;
  allowedRoles: Role[];
}) {
  const enabled = role != null && allowedRoles.includes(role);
  const Inner = (
    <Card
      className={`@container/card h-full transition-all ${
        enabled ? 'hover:border-brand-indigo/40 hover:shadow-sm' : 'cursor-not-allowed opacity-60'
      }`}
    >
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </CardContent>
      <CardFooter>
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          {enabled ? cta : 'Requires higher role'}
          {enabled && <ArrowUpRight className="size-3.5" />}
        </span>
      </CardFooter>
    </Card>
  );

  return enabled ? <Link href={href}>{Inner}</Link> : Inner;
}
