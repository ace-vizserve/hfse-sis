import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowUpRight, Building2, CalendarCog, CalendarDays, Database, FolderCog, LayoutGrid, Settings2, ShieldCheck, Tag, UserCog } from 'lucide-react';

import { SystemHealthStrip } from '@/components/sis/system-health-strip';
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
import { getSystemHealth } from '@/lib/sis/health';
import { getSessionUser } from '@/lib/supabase/server';
import type { Role } from '@/lib/auth/roles';

export default async function SisAdminHub() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const role = sessionUser.role;
  if (role !== 'school_admin' && role !== 'admin' && role !== 'superadmin') {
    redirect('/');
  }

  // System-health strip is superadmin-only (approver counts are sensitive to
  // their operational awareness). school_admin/admin see the hub without it.
  const health = role === 'superadmin' ? await getSystemHealth() : null;

  return (
    <PageShell>
      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          SIS · Admin Hub
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          System administration.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Structural and system-level controls for the HFSE SIS. Day-to-day operational
          work lives in the Records module; this page is for AY rollovers, approver
          management, and other setup tasks that cross modules.
        </p>
      </header>

      {health && <SystemHealthStrip health={health} />}

      {/* Academic Year — rolls over once a year (AY rollover + calendar). */}
      <section className="space-y-3">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Academic Year
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <AdminCard
            href="/sis/ay-setup"
            icon={CalendarCog}
            eyebrow="Structural"
            title="AY Setup"
            description="Create a new academic year, switch the active AY, or retire an empty one. Creates the 4 AY-prefixed admissions tables + SIS reference rows in a single transaction."
            cta="Open AY Setup"
            role={role}
            allowedRoles={['school_admin', 'admin', 'superadmin']}
          />
          <AdminCard
            href="/sis/calendar"
            icon={CalendarDays}
            eyebrow="Academic calendar"
            title="School Calendar"
            description="Define school days, holidays, and important dates per term. Every weekday is a school day by default; registrars mark holidays and overlay event labels (Math Week, Staff Dev). The attendance grid and parent portal consume this."
            cta="Open school calendar"
            role={role}
            allowedRoles={['school_admin', 'admin', 'superadmin']}
          />
        </div>
      </section>

      {/* Organisation — AY-scoped structural config. */}
      <section className="space-y-3">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Organisation
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <AdminCard
            href="/sis/sections"
            icon={LayoutGrid}
            eyebrow="Organisation"
            title="Sections"
            description="Create and manage sections for the current academic year. Day-to-day operations (roster, grading sheets, attendance) stay in the Markbook module; setup lives here."
            cta="Manage sections"
            role={role}
            allowedRoles={['school_admin', 'admin', 'superadmin']}
          />
          <AdminCard
            href="/sis/admin/discount-codes"
            icon={Tag}
            eyebrow="Admissions catalogue"
            title="Discount Codes"
            description="Time-bound enrolment discount codes for the current academic year. Per-student grants are written by the enrolment portal directly; this is the catalogue that the portal reads."
            cta="Manage codes"
            role={role}
            allowedRoles={['school_admin', 'admin', 'superadmin']}
          />
          <AdminCard
            href="/sis/sync-students"
            icon={Database}
            eyebrow="Admissions ingest"
            title="Sync from Admissions"
            description="Preview then commit a bulk sync of students, enrolments, withdrawals, and reactivations from the admissions database. Individual students sync automatically on stage→Assigned; this tool handles the catch-up pass."
            cta="Open sync tool"
            role={role}
            allowedRoles={['registrar', 'school_admin', 'admin', 'superadmin']}
          />
        </div>
      </section>

      {/* Access — rare, superadmin-only. */}
      <section className="space-y-3">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Access
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <AdminCard
            href="/sis/admin/approvers"
            icon={ShieldCheck}
            eyebrow="Access"
            title="Approvers"
            description="Manage who approves grade-change requests. Teachers pick primary + secondary from this list at submission; only those two see the request."
            cta="Manage approvers"
            role={role}
            allowedRoles={['superadmin']}
          />
          <AdminCard
            href="/sis/admin/school-config"
            icon={Building2}
            eyebrow="School-wide"
            title="School Config"
            description="Principal + Founder/CEO signature names, PEI registration number, default publication window. Singleton — renders on every report card."
            cta="Edit settings"
            role={role}
            allowedRoles={['superadmin']}
          />
          <AdminCard
            href="/sis/admin/users"
            icon={UserCog}
            eyebrow="Access"
            title="Users"
            description="Invite staff, change roles, enable/disable accounts. Parent accounts are created by the enrolment portal and aren't shown here."
            cta="Manage users"
            role={role}
            allowedRoles={['superadmin']}
          />
          <AdminCard
            href="/sis/admin/settings"
            icon={Settings2}
            eyebrow="System"
            title="Settings"
            description="System-level toggles including the Production / Test environment switcher. Switching to Test auto-provisions a disposable academic year and seeds fake students for UAT."
            cta="Open settings"
            role={role}
            allowedRoles={['superadmin']}
          />
        </div>
      </section>

      {/* Related surfaces — not SIS Admin config, but useful jumps. */}
      <section className="space-y-3">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Related
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <AdminCard
            href="/records"
            icon={FolderCog}
            eyebrow="Operational + Analytics"
            title="Records"
            description="The consolidated Records dashboard — student profiles, family, stage pipeline, documents, and admissions analytics (conversion funnel, time-to-enroll, outdated applications, assessment outcomes, referral sources) in one surface."
            cta="Open Records"
            role={role}
            allowedRoles={['school_admin', 'admin', 'superadmin']}
          />
        </div>
      </section>
    </PageShell>
  );
}

function AdminCard({
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
