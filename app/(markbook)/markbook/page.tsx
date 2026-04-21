import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  Lock,
  RefreshCw,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { unstable_cache } from "next/cache";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { ChangeRequestPanel } from "@/components/markbook/change-request-panel";
import { GradeDistributionChart } from "@/components/markbook/grade-distribution-chart";
import { PublicationCoverageChart } from "@/components/markbook/publication-coverage-chart";
import { RecentMarkbookActivity } from "@/components/markbook/recent-markbook-activity";
import { SheetProgressChart } from "@/components/markbook/sheet-progress-chart";
import {
  getChangeRequestSummary,
  getGradeDistribution,
  getPublicationCoverage,
  getRecentMarkbookActivity,
  getSheetLockProgressByTerm,
} from "@/lib/markbook/dashboard";
import { getCurrentAcademicYear } from "@/lib/academic-year";
import { getRoleFromClaims } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type Tool = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  icon: LucideIcon;
};

const ADMIN_TOOLS: Tool[] = [
  {
    icon: RefreshCw,
    eyebrow: "Admissions",
    title: "Sync Students",
    description:
      "Pull new, updated, and withdrawn students from the admissions tables for the current academic year.",
    href: "/markbook/sync-students",
    cta: "Open sync",
  },
  {
    icon: Users,
    eyebrow: "Rosters",
    title: "Sections & Advisers",
    description:
      "View every section for the current AY and manage enrolment, class advisers, and comments.",
    href: "/markbook/sections",
    cta: "Open sections",
  },
  {
    icon: History,
    eyebrow: "Compliance",
    title: "Audit Log",
    description:
      "Append-only record of every post-lock grade change, with field diffs and approval references.",
    href: "/markbook/audit-log",
    cta: "Open audit log",
  },
];

export default async function MarkbookHome() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;
  const email = (claims?.email as string | undefined) ?? undefined;
  const role = getRoleFromClaims(claims);

  // NOTE: The superadmin-to-/sis redirect lives on `/` (the default landing),
  // not here. Once a user explicitly navigates INTO Markbook via the module
  // switcher, they should land on this page regardless of role.
  const canSeeAdmin =
    role === "registrar" || role === "school_admin" || role === "admin" || role === "superadmin";
  const canSeeGrading = role === "teacher" || role === "registrar" || role === "superadmin";
  const canSeeReportCards =
    role === "registrar" || role === "school_admin" || role === "admin" || role === "superadmin";

  // Service client bypasses RLS so stats are the school-wide view — teachers
  // see the same numbers; their scoped work lives on /markbook/grading.
  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  const ayId = currentAy?.id ?? null;

  // Module-specific analytics: grading distributions, lock progress, change
  // requests, publication coverage, recent activity. Admissions analytics
  // live under `/admin/admissions` + `/records` — do not reach for them here.
  const [stats, gradeDist, sheetProgress, changeRequests, pubCoverage, activity, currentTerm] =
    await Promise.all([
      ayId ? loadStats(ayId) : Promise.resolve(null),
      canSeeAdmin && ayId ? getGradeDistribution(ayId) : Promise.resolve(null),
      canSeeAdmin && ayId ? getSheetLockProgressByTerm(ayId) : Promise.resolve(null),
      canSeeAdmin ? getChangeRequestSummary(30) : Promise.resolve(null),
      canSeeAdmin && ayId ? getPublicationCoverage(ayId) : Promise.resolve(null),
      canSeeAdmin ? getRecentMarkbookActivity(8) : Promise.resolve(null),
      ayId
        ? service
            .from("terms")
            .select("term_number")
            .eq("academic_year_id", ayId)
            .order("term_number", { ascending: false })
            .limit(1)
            .maybeSingle()
            .then((r) => (r.data?.term_number as number | undefined) ?? null)
        : Promise.resolve(null),
    ]);

  return (
    <PageShell>
      {/* Hero — canonical pattern. Markbook is current-AY only (see plan) so
          the right column shows the chip + Current badge without a switcher. */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Markbook · Dashboard
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Welcome back.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">{email}</span>. Here&apos;s where
            HFSE stands today.
          </p>
        </div>
        {currentAy && (
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {currentAy.ay_code}
            </Badge>
            <Badge className="h-7 border-brand-mint bg-brand-mint/30 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink">
              Current
            </Badge>
          </div>
        )}
      </header>

      {/* Stats — dashboard-01 SectionCards pattern */}
      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          <StatCard
            description="Students enrolled"
            value={stats ? formatNumber(stats.studentsActive) : "—"}
            icon={Users}
            footerTitle={stats ? `${formatNumber(stats.sectionsActive)} active sections` : "No data"}
            footerDetail={currentAy?.label ?? "—"}
          />
          <StatCard
            description="Grading sheets"
            value={stats ? formatNumber(stats.sheetsOpen + stats.sheetsLocked) : "—"}
            icon={ClipboardList}
            footerTitle={
              stats
                ? `${formatNumber(stats.sheetsOpen)} open · ${formatNumber(stats.sheetsLocked)} locked`
                : "No data"
            }
            footerDetail="Across all terms"
          />
          <StatCard
            description="Sheets locked"
            value={stats ? formatPercent(stats.sheetsLocked, stats.sheetsOpen + stats.sheetsLocked) : "—"}
            icon={Lock}
            footerTitle={
              stats && stats.sheetsOpen + stats.sheetsLocked > 0
                ? `${stats.sheetsLocked} of ${stats.sheetsOpen + stats.sheetsLocked} sheets`
                : "No sheets yet"
            }
            footerDetail="Locked = finalized for parents"
          />
          <StatCard
            description="Publications live"
            value={stats ? formatNumber(stats.publicationsActive) : "—"}
            icon={CheckCircle2}
            footerTitle={
              stats && stats.publicationsScheduled > 0
                ? `${stats.publicationsScheduled} scheduled next`
                : "No upcoming windows"
            }
            footerDetail="Report cards visible to parents"
          />
        </div>
      </div>

      {/* Grade distribution + Sheet progress — privileged roles only */}
      {canSeeAdmin && (gradeDist || sheetProgress) && (
        <section className="grid gap-4 lg:grid-cols-3">
          {gradeDist && (
            <div className="lg:col-span-2">
              <GradeDistributionChart
                data={gradeDist}
                termLabel={currentTerm != null ? `Term ${currentTerm}` : "Current term"}
              />
            </div>
          )}
          {sheetProgress && (
            <div className="lg:col-span-1">
              <SheetProgressChart data={sheetProgress} />
            </div>
          )}
        </section>
      )}

      {/* Change requests + Publication coverage — privileged roles only */}
      {canSeeAdmin && (changeRequests || pubCoverage) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {changeRequests && <ChangeRequestPanel summary={changeRequests} />}
          {pubCoverage && <PublicationCoverageChart data={pubCoverage} />}
        </section>
      )}

      {/* Recent Markbook activity — privileged roles only */}
      {canSeeAdmin && activity && <RecentMarkbookActivity rows={activity} />}

      {/* Admin tools — privileged roles only */}
      {canSeeAdmin && (
        <section className="space-y-4">
          <div className="space-y-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Tools
            </p>
            <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
              Administrator tools
            </h2>
          </div>
          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-3">
              {ADMIN_TOOLS.map((t) => (
                <QuickLinkCard
                  key={t.href}
                  icon={t.icon}
                  eyebrow={t.eyebrow}
                  title={t.title}
                  description={t.description}
                  href={t.href}
                  cta={t.cta}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Quick links — grading + report cards */}
      {(canSeeGrading || canSeeReportCards) && (
        <div>
          <p className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Jump back in
          </p>
          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2">
              {canSeeGrading && (
                <QuickLinkCard
                  icon={ClipboardList}
                  eyebrow="Grading"
                  title="Grading Sheets"
                  description="Enter and review quarterly grades for your sections."
                  href="/markbook/grading"
                  cta="Open grading"
                  primary={!canSeeAdmin}
                />
              )}
              {canSeeReportCards && (
                <QuickLinkCard
                  icon={FileText}
                  eyebrow="Report Cards"
                  title="Report Cards"
                  description="Preview, print, and publish report cards for the current academic year."
                  href="/markbook/report-cards"
                  cta="Browse report cards"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Trust strip — canonical shape (matches /records, /p-files) */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <BarChart3 className="size-3" strokeWidth={2.25} />
        <span>{currentAy?.ay_code ?? "—"}</span>
        <span className="text-border">·</span>
        <span>Supabase Auth</span>
        <span className="text-border">·</span>
        <span>Audit-logged</span>
      </div>
    </PageShell>
  );
}

type Stats = {
  studentsActive: number;
  sectionsActive: number;
  sheetsOpen: number;
  sheetsLocked: number;
  publicationsActive: number;
  publicationsScheduled: number;
};

async function loadStatsUncached(academicYearId: string): Promise<Stats> {
  const service = createServiceClient();

  const [sectionsRes, termsRes] = await Promise.all([
    service
      .from("sections")
      .select("id", { count: "exact" })
      .eq("academic_year_id", academicYearId),
    service
      .from("terms")
      .select("id")
      .eq("academic_year_id", academicYearId),
  ]);

  const sectionIds = (sectionsRes.data ?? []).map((r) => r.id as string);
  const sectionsActive = sectionsRes.count ?? 0;
  const termIds = (termsRes.data ?? []).map((r) => r.id as string);

  const nowIso = new Date().toISOString();
  type CountRes = { count: number | null };
  const zero: Promise<CountRes> = Promise.resolve({ count: 0 });

  const [studentsRes, sheetsOpenRes, sheetsLockedRes, pubActiveRes, pubScheduledRes] =
    await Promise.all([
      sectionIds.length > 0
        ? service
            .from("section_students")
            .select("*", { count: "exact", head: true })
            .eq("enrollment_status", "active")
            .in("section_id", sectionIds)
        : zero,
      termIds.length > 0
        ? service
            .from("grading_sheets")
            .select("*", { count: "exact", head: true })
            .eq("is_locked", false)
            .in("term_id", termIds)
        : zero,
      termIds.length > 0
        ? service
            .from("grading_sheets")
            .select("*", { count: "exact", head: true })
            .eq("is_locked", true)
            .in("term_id", termIds)
        : zero,
      sectionIds.length > 0
        ? service
            .from("report_card_publications")
            .select("*", { count: "exact", head: true })
            .in("section_id", sectionIds)
            .lte("publish_from", nowIso)
            .gte("publish_until", nowIso)
        : zero,
      sectionIds.length > 0
        ? service
            .from("report_card_publications")
            .select("*", { count: "exact", head: true })
            .in("section_id", sectionIds)
            .gt("publish_from", nowIso)
        : zero,
    ]);

  return {
    studentsActive: studentsRes.count ?? 0,
    sectionsActive,
    sheetsOpen: sheetsOpenRes.count ?? 0,
    sheetsLocked: sheetsLockedRes.count ?? 0,
    publicationsActive: pubActiveRes.count ?? 0,
    publicationsScheduled: pubScheduledRes.count ?? 0,
  };
}

const loadStats = unstable_cache(
  loadStatsUncached,
  ["dashboard-stats"],
  { revalidate: 60, tags: ["dashboard-stats"] },
);

function formatNumber(n: number): string {
  return n.toLocaleString("en-SG");
}

function formatPercent(num: number, den: number): string {
  if (den === 0) return "—";
  const pct = Math.round((num / den) * 100);
  return `${pct}%`;
}

function StatCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: string;
  icon: LucideIcon;
  footerTitle: string;
  footerDetail: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {description}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {value}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  );
}

function QuickLinkCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  href,
  cta,
  primary = false,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  primary?: boolean;
}) {
  return (
    <Card
      className={
        "@container/card group relative transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md" +
        (primary ? " ring-1 ring-primary/20" : "")
      }
    >
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold leading-snug tracking-tight text-foreground @[260px]/card:text-[22px]">
          {title}
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-4 text-sm">
        <p className="leading-relaxed text-muted-foreground">{description}</p>
        <Button asChild size="sm">
          <Link href={href}>
            {cta}
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

