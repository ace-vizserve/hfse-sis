import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  History,
  Lock,
  RefreshCw,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { unstable_cache } from "next/cache";
import Link from "next/link";

import { TrendChart } from "@/components/dashboard/charts/trend-chart";
import { ComparisonToolbar } from "@/components/dashboard/comparison-toolbar";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { InsightsPanel } from "@/components/dashboard/insights-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PriorityPanel } from "@/components/dashboard/priority-panel";
import { ChangeRequestPanel } from "@/components/markbook/change-request-panel";
import {
  GradeDistributionDrillCard,
  PublicationCoverageDrillCard,
  SheetProgressDrillCard,
} from "@/components/markbook/drills/chart-drill-cards";
import { MarkbookDrillSheet } from "@/components/markbook/drills/markbook-drill-sheet";
import { SheetReadinessCard } from "@/components/markbook/drills/sheet-readiness-card";
import { TeacherEntryVelocityCard } from "@/components/markbook/drills/teacher-entry-velocity-card";
import { RecentMarkbookActivity } from "@/components/markbook/recent-markbook-activity";
import { Button } from "@/components/ui/button";
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
import { getCurrentAcademicYear, listAyCodes } from "@/lib/academic-year";
import { getRoleFromClaims } from "@/lib/auth/roles";
import { markbookInsights } from "@/lib/dashboard/insights";
import { formatRangeLabel, resolveRange, type DashboardSearchParams } from "@/lib/dashboard/range";
import { getDashboardWindows } from "@/lib/dashboard/windows";
import {
  getChangeRequestSummary,
  getChangeRequestVelocityRange,
  getGradeDistribution,
  getGradeEntryVelocityRange,
  getMarkbookKpisRange,
  getMarkbookRegistrarPriority,
  getMarkbookTeacherPriority,
  getPublicationCoverage,
  getRecentMarkbookActivity,
  getSheetLockProgressByTerm,
} from "@/lib/markbook/dashboard";
import { buildAllRowSets, getTeacherEntryVelocity } from "@/lib/markbook/drill";
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
    description: "Pull new, updated, and withdrawn students from the admissions tables. Lives in SIS Admin (KD #48) — opens the canonical surface.",
    href: "/sis/sync-students",
    cta: "Open sync",
  },
  {
    icon: Users,
    eyebrow: "Rosters",
    title: "Browse sections",
    description: "Read-only roster launcher into per-section grading sheets, attendance, and report cards. Section + adviser config lives in SIS Admin (KD #48).",
    href: "/markbook/sections",
    cta: "Open roster",
  },
  {
    icon: History,
    eyebrow: "Compliance",
    title: "Audit Log",
    description: "A history of every grade change made after a sheet is locked, including which fields changed and the approval reference.",
    href: "/markbook/audit-log",
    cta: "Open audit log",
  },
];

export default async function MarkbookHome({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;
  const email = (claims?.email as string | undefined) ?? undefined;
  const role = getRoleFromClaims(claims);

  const canSeeAdmin = role === "registrar" || role === "school_admin" || role === "superadmin";
  const canSeeGrading = role === "teacher" || role === "registrar" || role === "superadmin";
  const canSeeReportCards =
    role === "registrar" || role === "school_admin" || role === "superadmin";

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  const ayId = currentAy?.id ?? null;
  const ayCode = currentAy?.ay_code ?? "";

  const [windows, ayCodes] = await Promise.all([
    ayCode
      ? getDashboardWindows(ayCode)
      : Promise.resolve({ term: { thisTerm: null, lastTerm: null }, ay: { thisAY: null, lastAY: null } }),
    listAyCodes(service),
  ]);
  const rangeInput = resolveRange(resolvedSearchParams, windows, ayCode);

  const [
    stats,
    kpisResult,
    velocity,
    crVelocity,
    gradeDist,
    sheetProgress,
    changeRequests,
    pubCoverage,
    activity,
    currentTerm,
    drillRowSets,
    teacherVelocity,
  ] = await Promise.all([
    ayId ? loadStats(ayId, ayCode) : Promise.resolve(null),
    canSeeAdmin ? getMarkbookKpisRange(rangeInput) : Promise.resolve(null),
    canSeeAdmin ? getGradeEntryVelocityRange(rangeInput) : Promise.resolve(null),
    canSeeAdmin ? getChangeRequestVelocityRange(rangeInput) : Promise.resolve(null),
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
    canSeeAdmin && ayCode
      ? buildAllRowSets({ ayCode, scope: "range", from: rangeInput.from, to: rangeInput.to })
      : Promise.resolve(null),
    // Teacher velocity is registrar+ only (gated by canSeeAdmin); the rollup
    // uses the same loadEntryRows cache as the entry-kind drills.
    canSeeAdmin && ayCode
      ? getTeacherEntryVelocity(ayCode)
      : Promise.resolve(null),
  ]);

  const comparisonLabel = kpisResult?.comparisonRange
    ? `vs ${formatRangeLabel(kpisResult.comparisonRange)}`
    : undefined;

  // Role-aware PriorityPanel payload — teacher gets "your open subject sheets",
  // registrar gets "decisions queued + per-term unlocked sheets".
  const userId = (claims?.sub as string | undefined) ?? null;
  const isTeacher = role === "teacher";
  const teacherPriority =
    isTeacher && userId && ayCode
      ? await getMarkbookTeacherPriority({ ayCode, teacherUserId: userId })
      : null;
  const registrarPriority =
    canSeeAdmin && ayCode && kpisResult
      ? await getMarkbookRegistrarPriority({
          ayCode,
          changeRequestsPending: kpisResult.current.changeRequestsPending,
        })
      : null;

  const insights = kpisResult
    ? markbookInsights({
        gradesEntered: kpisResult.current.gradesEntered,
        gradesDelta: kpisResult.delta ?? undefined,
        sheetsLocked: kpisResult.current.sheetsLocked,
        sheetsTotal: kpisResult.current.sheetsTotal,
        lockedPct: kpisResult.current.lockedPct,
        changeRequestsPending: kpisResult.current.changeRequestsPending,
        avgDecisionHours: kpisResult.current.avgDecisionHours,
      })
    : [];

  return (
    <PageShell>
      <DashboardHero
        eyebrow="Markbook · Dashboard"
        title={`Welcome back${email ? `, ${email.split("@")[0]}` : ""}`}
        description="Grading sheets, change requests, publications, and recent module activity."
        badges={currentAy ? [{ label: currentAy.ay_code }, { label: "Current", tone: "mint" }] : []}
      />

      {teacherPriority && <PriorityPanel payload={teacherPriority} />}

      {canSeeAdmin && ayCode && (
        <ComparisonToolbar
          ayCode={ayCode}
          ayCodes={ayCodes}
          range={{ from: rangeInput.from, to: rangeInput.to }}
          comparison={
            rangeInput.cmpFrom && rangeInput.cmpTo
              ? { from: rangeInput.cmpFrom, to: rangeInput.cmpTo }
              : null
          }
          termWindows={windows.term}
          ayWindows={windows.ay}
          showAySwitcher={false}
        />
      )}

      {registrarPriority && <PriorityPanel payload={registrarPriority} />}

      {canSeeAdmin && insights.length > 0 && <InsightsPanel insights={insights} />}

      {/* Range-aware KPIs — new MetricCards driven by ComparisonToolbar */}
      {canSeeAdmin && kpisResult && ayCode && (
        <section className="grid gap-4 xl:grid-cols-4">
          <MetricCard
            label="Grades entered"
            value={kpisResult.current.gradesEntered}
            icon={ClipboardList}
            intent="default"
            delta={kpisResult.delta ?? undefined}
            deltaGoodWhen="up"
            comparisonLabel={comparisonLabel}
            sparkline={velocity?.current.slice(-14)}
            drillSheet={
              <MarkbookDrillSheet
                target="grade-entries"
                ayCode={ayCode}
                initialScope="range"
                initialFrom={rangeInput.from}
                initialTo={rangeInput.to}
              />
            }
          />
          <MetricCard
            label="Sheets locked (range)"
            value={kpisResult.current.sheetsLocked}
            icon={Lock}
            intent="good"
            comparisonLabel={`${kpisResult.current.lockedPct.toFixed(0)}% of ${kpisResult.current.sheetsTotal}`}
            drillSheet={
              <MarkbookDrillSheet
                target="sheets-locked"
                ayCode={ayCode}
                initialScope="range"
                initialFrom={rangeInput.from}
                initialTo={rangeInput.to}
                initialSheets={drillRowSets?.sheets}
              />
            }
          />
          <MetricCard
            label="Change requests pending"
            value={kpisResult.current.changeRequestsPending}
            icon={TrendingUp}
            intent={kpisResult.current.changeRequestsPending > 0 ? "warning" : "good"}
            subtext={
              kpisResult.comparison
                ? `${kpisResult.comparison.changeRequestsPending} in prior period`
                : undefined
            }
            drillSheet={
              <MarkbookDrillSheet
                target="change-requests"
                ayCode={ayCode}
                initialScope="range"
                initialFrom={rangeInput.from}
                initialTo={rangeInput.to}
                initialChangeRequests={drillRowSets?.changeRequests}
              />
            }
          />
          <MetricCard
            label="Avg decision time"
            value={kpisResult.current.avgDecisionHours ?? "—"}
            format="days"
            icon={Clock}
            intent="default"
            subtext={
              kpisResult.comparison?.avgDecisionHours != null
                ? `${kpisResult.comparison.avgDecisionHours.toFixed(1)}d prior`
                : kpisResult.comparison
                  ? "No prior decisions"
                  : undefined
            }
            drillSheet={
              <MarkbookDrillSheet
                target="change-requests"
                ayCode={ayCode}
                initialScope="range"
                initialFrom={rangeInput.from}
                initialTo={rangeInput.to}
                initialChangeRequests={drillRowSets?.changeRequests}
              />
            }
          />
        </section>
      )}

      {/* Row 4 — velocity trends side-by-side (grade entry + change requests) */}
      {canSeeAdmin && ((velocity && velocity.current.length > 1) || (crVelocity && crVelocity.current.length > 1)) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {velocity && velocity.current.length > 1 && (
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Grade entry velocity
                </CardDescription>
                <CardTitle className="font-serif text-xl">Entries per day</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart label="Entries" current={velocity.current} comparison={velocity.comparison} />
              </CardContent>
            </Card>
          )}
          {crVelocity && crVelocity.current.length > 1 && (
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Change requests
                </CardDescription>
                <CardTitle className="font-serif text-xl">Requests per day</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart label="Requests" current={crVelocity.current} comparison={crVelocity.comparison} />
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* Static school-wide counters (AY-scoped, not range-scoped) */}
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
              stats ? `${formatNumber(stats.sheetsOpen)} open · ${formatNumber(stats.sheetsLocked)} locked` : "No data"
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

      {canSeeAdmin && ayCode && (gradeDist || sheetProgress) && (
        <section className="grid gap-4 lg:grid-cols-3">
          {gradeDist && (
            <div className="lg:col-span-2">
              <GradeDistributionDrillCard
                data={gradeDist}
                termLabel={currentTerm != null ? `Term ${currentTerm}` : "Current term"}
                ayCode={ayCode}
                rangeFrom={rangeInput.from}
                rangeTo={rangeInput.to}
              />
            </div>
          )}
          {sheetProgress && (
            <div className="lg:col-span-1">
              <SheetProgressDrillCard
                data={sheetProgress}
                ayCode={ayCode}
                initialSheets={drillRowSets?.sheets}
              />
            </div>
          )}
        </section>
      )}

      {canSeeAdmin && ayCode && (changeRequests || pubCoverage) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {changeRequests && <ChangeRequestPanel summary={changeRequests} />}
          {pubCoverage && (
            <PublicationCoverageDrillCard
              data={pubCoverage}
              ayCode={ayCode}
              initialSheets={drillRowSets?.sheets}
            />
          )}
        </section>
      )}

      {canSeeAdmin && ayCode && drillRowSets && (
        <section className="grid gap-4 lg:grid-cols-2">
          <SheetReadinessCard sheets={drillRowSets.sheets} ayCode={ayCode} />
          {teacherVelocity && (
            <TeacherEntryVelocityCard data={teacherVelocity} ayCode={ayCode} />
          )}
        </section>
      )}

      {canSeeAdmin && activity && <RecentMarkbookActivity rows={activity} />}

      {canSeeAdmin && (
        <section className="space-y-4">
          <div className="space-y-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Tools
            </p>
            <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">Administrator tools</h2>
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

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <BarChart3 className="size-3" strokeWidth={2.25} />
        <span>{currentAy?.ay_code ?? "—"}</span>
        <span className="text-border">·</span>
        <span>Secure sign-in</span>
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
    service.from("sections").select("id", { count: "exact" }).eq("academic_year_id", academicYearId),
    service.from("terms").select("id").eq("academic_year_id", academicYearId),
  ]);

  const sectionIds = (sectionsRes.data ?? []).map((r) => r.id as string);
  const sectionsActive = sectionsRes.count ?? 0;
  const termIds = (termsRes.data ?? []).map((r) => r.id as string);

  const nowIso = new Date().toISOString();
  type CountRes = { count: number | null };
  const zero: Promise<CountRes> = Promise.resolve({ count: 0 });

  const [studentsRes, sheetsOpenRes, sheetsLockedRes, pubActiveRes, pubScheduledRes] = await Promise.all([
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

// AY-keyed cache wrapper (KD #46). The previous tuple `["dashboard-stats"]`
// shared a single cache slot across every AY, so two users on different
// AYs saw each other's stats and a single user switching AYs got stale
// numbers for up to 60 seconds. Per-AY tag invalidation already exists
// elsewhere via `markbook:${ayCode}` — wire it through here too.
function loadStats(academicYearId: string, ayCode: string): Promise<Stats> {
  return unstable_cache(
    () => loadStatsUncached(academicYearId),
    ["dashboard-stats", academicYearId],
    { revalidate: 60, tags: ["dashboard-stats", `markbook:${ayCode}`] },
  )();
}

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
      }>
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
