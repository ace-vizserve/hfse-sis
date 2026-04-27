import {
  Activity,
  ArrowUpRight,
  Building2,
  CalendarCog,
  CalendarDays,
  Database,
  FolderCog,
  LayoutGrid,
  Settings2,
  ShieldCheck,
  Tag,
  UserCog,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ComparisonToolbar } from "@/components/dashboard/comparison-toolbar";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { InsightsPanel } from "@/components/dashboard/insights-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ActivityByActorCard } from "@/components/sis/activity-by-actor-card";
import { AuditByModuleDrillCard } from "@/components/sis/drills/audit-by-module-drill-card";
import { LifecycleAggregateCard } from "@/components/sis/lifecycle-aggregate-card";
import { SystemHealthStrip } from "@/components/sis/system-health-strip";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCurrentAcademicYear, listAyCodes } from "@/lib/academic-year";
import type { Role } from "@/lib/auth/roles";
import { sisInsights } from "@/lib/dashboard/insights";
import { formatRangeLabel, resolveRange, type DashboardSearchParams } from "@/lib/dashboard/range";
import { getDashboardWindows } from "@/lib/dashboard/windows";
import { getActivityByActor, getAuditActivityByModule } from "@/lib/sis/dashboard";
import { getSystemHealth } from "@/lib/sis/health";
import { getLifecycleAggregate } from "@/lib/sis/process";
import { getSessionUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type SisAdminHubSearchParams = DashboardSearchParams & { view?: string };

export default async function SisAdminHub({
  searchParams,
}: {
  searchParams: Promise<SisAdminHubSearchParams>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  const role = sessionUser.role;
  if (role !== "school_admin" && role !== "admin" && role !== "superadmin") {
    redirect("/");
  }

  const resolvedSearch = await searchParams;
  const view = (resolvedSearch.view === "audit" ? "audit" : "hub") as "hub" | "audit";
  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  const ayCode = currentAy?.ay_code ?? "";

  // System-health strip is superadmin-only (approver counts are sensitive to
  // their operational awareness). school_admin/admin see the hub without it.
  const [health, windows, ayCodes, lifecycleBuckets] = await Promise.all([
    role === "superadmin" ? getSystemHealth() : Promise.resolve(null),
    ayCode
      ? getDashboardWindows(ayCode)
      : Promise.resolve({ term: { thisTerm: null, lastTerm: null }, ay: { thisAY: null, lastAY: null } }),
    listAyCodes(service),
    ayCode ? getLifecycleAggregate(ayCode) : Promise.resolve([]),
  ]);
  const rangeInput = ayCode ? resolveRange(resolvedSearch, windows, ayCode) : null;

  // Audit-activity fetches only fire on the audit view — saves DB work on hub
  // loads. Audit-activity query can be slow on large audit_log tables; guard
  // so a transient DB error never tanks the admin hub.
  const [auditResult, actorActivity] =
    view === "audit" && rangeInput
      ? await Promise.all([
          getAuditActivityByModule(rangeInput).catch((err) => {
            console.error("[sis] getAuditActivityByModule failed:", err);
            return null;
          }),
          getActivityByActor({ from: rangeInput.from, to: rangeInput.to }).catch((err) => {
            console.error("[sis] getActivityByActor failed:", err);
            return [];
          }),
        ])
      : [null, []];
  const comparisonLabel = rangeInput
    ? `vs ${formatRangeLabel({ from: rangeInput.cmpFrom, to: rangeInput.cmpTo })}`
    : "";

  // Precompute derived values so JSX stays pure (no in-place .sort() mutating
  // the same array multiple times — that was misaligning the comparison chart
  // and triggering React 19's profiler "negative timestamp" warning).
  const currentTotal = auditResult?.current.reduce((s, p) => s + p.count, 0) ?? 0;
  const comparisonTotal = auditResult?.comparison.reduce((s, p) => s + p.count, 0) ?? 0;
  const activeModules = auditResult?.current.filter((p) => p.count > 0).length ?? 0;
  const trackedModules = auditResult?.current.length ?? 0;
  const ranked = auditResult ? [...auditResult.current].sort((a, b) => b.count - a.count) : [];
  const topModule = ranked[0]?.module ?? "—";
  const topModuleCount = ranked[0]?.count ?? 0;
  const chartData = auditResult
    ? auditResult.current.map((row, i) => ({
        category: row.module,
        current: row.count,
        comparison: auditResult.comparison[i]?.count ?? 0,
      }))
    : [];

  const insights = auditResult
    ? sisInsights({
        auditEventsCurrent: currentTotal,
        auditEventsComparison: comparisonTotal,
        auditDelta: auditResult.delta,
        topModule: ranked[0],
        activeModules,
        trackedModules,
      })
    : [];

  return (
    <PageShell>
      <DashboardHero
        eyebrow="SIS · Admin hub"
        title="System administration"
        description="Structural + system-level controls. Day-to-day operational work lives in Records; this page is for AY rollovers, approver management, and cross-module setup."
        badges={ayCode ? [{ label: ayCode }] : []}
      />

      {health && <SystemHealthStrip health={health} />}

      <Tabs value={view} className="w-full">
        <TabsList variant="segmented">
          <TabsTrigger value="hub" asChild>
            <Link href="/sis">Hub</Link>
          </TabsTrigger>
          <TabsTrigger value="audit" asChild>
            <Link href="/sis?view=audit">Audit overview</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "hub" ? (
        <>
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
                allowedRoles={["school_admin", "admin", "superadmin"]}
              />
              <AdminCard
                href="/sis/calendar"
                icon={CalendarDays}
                eyebrow="Academic calendar"
                title="School Calendar"
                description="Define school days, holidays, and important dates per term. Every weekday is a school day by default; registrars mark holidays and overlay event labels (Math Week, Staff Dev). The attendance grid and parent portal consume this."
                cta="Open school calendar"
                role={role}
                allowedRoles={["school_admin", "admin", "superadmin"]}
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
                allowedRoles={["school_admin", "admin", "superadmin"]}
              />
              <AdminCard
                href="/sis/admin/discount-codes"
                icon={Tag}
                eyebrow="Admissions catalogue"
                title="Discount Codes"
                description="Time-bound enrolment discount codes for the current academic year. Per-student grants are written by the enrolment portal directly; this is the catalogue that the portal reads."
                cta="Manage codes"
                role={role}
                allowedRoles={["school_admin", "admin", "superadmin"]}
              />
              <AdminCard
                href="/sis/sync-students"
                icon={Database}
                eyebrow="Admissions ingest"
                title="Sync from Admissions"
                description="Preview then commit a bulk sync of students, enrolments, withdrawals, and reactivations from the admissions database. Individual students sync automatically on stage→Assigned; this tool handles the catch-up pass."
                cta="Open sync tool"
                role={role}
                allowedRoles={["registrar", "school_admin", "admin", "superadmin"]}
              />
            </div>
          </section>

          {/* Lifecycle blockers — top-of-fold "what's blocking the funnel". */}
          {lifecycleBuckets.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Lifecycle
              </h2>
              <LifecycleAggregateCard buckets={lifecycleBuckets} />
            </section>
          )}

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
                allowedRoles={["superadmin"]}
              />
              <AdminCard
                href="/sis/admin/school-config"
                icon={Building2}
                eyebrow="School-wide"
                title="School Config"
                description="Principal + Founder/CEO signature names, PEI registration number, default publication window. Singleton — renders on every report card."
                cta="Edit settings"
                role={role}
                allowedRoles={["superadmin"]}
              />
              <AdminCard
                href="/sis/admin/users"
                icon={UserCog}
                eyebrow="Access"
                title="Users"
                description="Invite staff, change roles, enable/disable accounts. Parent accounts are created by the enrolment portal and aren't shown here."
                cta="Manage users"
                role={role}
                allowedRoles={["superadmin"]}
              />
              <AdminCard
                href="/sis/admin/settings"
                icon={Settings2}
                eyebrow="System"
                title="Settings"
                description="System-level toggles including the Production / Test environment switcher. Switching to Test auto-provisions a disposable academic year and seeds fake students for UAT."
                cta="Open settings"
                role={role}
                allowedRoles={["superadmin"]}
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
                allowedRoles={["school_admin", "admin", "superadmin"]}
              />
            </div>
          </section>
        </>
      ) : (
        <>
          {rangeInput && auditResult ? (
            <>
              <ComparisonToolbar
                ayCode={ayCode}
                ayCodes={ayCodes}
                range={{ from: rangeInput.from, to: rangeInput.to }}
                comparison={{ from: rangeInput.cmpFrom, to: rangeInput.cmpTo }}
                termWindows={windows.term}
                ayWindows={windows.ay}
                showAySwitcher={false}
              />

              {insights.length > 0 && <InsightsPanel insights={insights} />}

              <section className="grid gap-4 xl:grid-cols-4">
                <MetricCard
                  label="Audit events"
                  value={currentTotal}
                  icon={Activity}
                  intent="default"
                  delta={auditResult.delta}
                  deltaGoodWhen="up"
                  comparisonLabel={comparisonLabel}
                />
                <MetricCard
                  label="Prior period total"
                  value={comparisonTotal}
                  icon={Activity}
                  intent="default"
                  subtext="For comparison"
                />
                <MetricCard
                  label="Active modules"
                  value={activeModules}
                  icon={LayoutGrid}
                  intent="default"
                  subtext={`of ${trackedModules} tracked`}
                />
                <MetricCard
                  label="Most-active module"
                  value={topModule}
                  format="raw"
                  icon={Activity}
                  intent="default"
                  subtext={`${topModuleCount} events`}
                />
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <AuditByModuleDrillCard
                  data={chartData}
                  rangeFrom={rangeInput.from}
                  rangeTo={rangeInput.to}
                />
                <ActivityByActorCard
                  data={actorActivity}
                  rangeFrom={rangeInput.from}
                  rangeTo={rangeInput.to}
                />
              </section>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Audit data unavailable for this range. Try a different range or revisit later.
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Activity className="size-3" strokeWidth={2.25} />
        <span>{ayCode || "—"}</span>
        <span className="text-border">·</span>
        <span>{currentTotal.toLocaleString("en-SG")} audit events</span>
        <span className="text-border">·</span>
        <span>Cache 2m</span>
        <span className="text-border">·</span>
        <span>Audit-logged</span>
      </div>
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
        enabled
          ? "hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md"
          : "cursor-not-allowed opacity-60"
      }`}>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">{title}</CardTitle>
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
          {enabled ? cta : "Requires higher role"}
          {enabled && <ArrowUpRight className="size-3.5" />}
        </span>
      </CardFooter>
    </Card>
  );

  return enabled ? <Link href={href}>{Inner}</Link> : Inner;
}
