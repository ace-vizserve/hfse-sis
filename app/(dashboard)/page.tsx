import {
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  FileText,
  Lock,
  Settings,
  Unlock,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

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
import { getCurrentAcademicYear } from "@/lib/academic-year";
import { getUserRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export default async function DashboardHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = getUserRole(user);

  const canSeeAdmin = role === "registrar" || role === "admin" || role === "superadmin";
  const canSeeGrading = role === "teacher" || role === "registrar" || role === "superadmin";
  const canSeeReportCards = role === "registrar" || role === "admin" || role === "superadmin";
  const primaryPathIsAdmin = role === "registrar" || role === "admin" || role === "superadmin";

  // Fetch current-AY stats. Service client bypasses RLS so the counts are
  // the *whole school* view — teachers see the same school-wide numbers
  // here; their scoped work lives on /grading.
  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  const stats = currentAy ? await loadStats(service, currentAy.id) : null;

  return (
    <PageShell>
      {/* Hero header */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Faculty Portal
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Welcome back.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">{user?.email}</span>. Here&apos;s where
            HFSE stands today.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {currentAy && (
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {currentAy.ay_code}
            </Badge>
          )}
          <Badge
            variant="outline"
            className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            {role ?? "no role"}
          </Badge>
        </div>
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

      {/* Quick links */}
      <div>
        <p className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Jump back in
        </p>
        <div className="@container/main">
          <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-3">
            {canSeeGrading && (
              <QuickLinkCard
                icon={ClipboardList}
                eyebrow="Grading"
                title="Grading Sheets"
                description="Enter and review quarterly grades for your sections."
                href="/grading"
                cta="Open grading"
                primary={!primaryPathIsAdmin}
              />
            )}
            {canSeeReportCards && (
              <QuickLinkCard
                icon={FileText}
                eyebrow="Report Cards"
                title="Report Cards"
                description="Preview, print, and publish report cards for the current academic year."
                href="/report-cards"
                cta="Browse report cards"
              />
            )}
            {canSeeAdmin && (
              <QuickLinkCard
                icon={Settings}
                eyebrow="Administration"
                title="Admin"
                description="Sync students, manage sections, and review the audit log."
                href="/admin"
                cta="Open admin"
                primary={primaryPathIsAdmin}
              />
            )}
          </div>
        </div>
      </div>

      <TrustStrip ayLabel={currentAy?.ay_code ?? "—"} />
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

async function loadStats(
  service: ReturnType<typeof createServiceClient>,
  academicYearId: string,
): Promise<Stats> {
  // Sections for current AY.
  const { count: sectionsActive } = await service
    .from("sections")
    .select("*", { count: "exact", head: true })
    .eq("academic_year_id", academicYearId);

  // Section IDs for current AY (used by two further queries).
  const { data: sectionRows } = await service
    .from("sections")
    .select("id")
    .eq("academic_year_id", academicYearId);
  const sectionIds = (sectionRows ?? []).map((r) => r.id as string);

  // Students currently enrolled in a current-AY section.
  let studentsActive = 0;
  if (sectionIds.length > 0) {
    const { count } = await service
      .from("section_students")
      .select("*", { count: "exact", head: true })
      .eq("enrollment_status", "active")
      .in("section_id", sectionIds);
    studentsActive = count ?? 0;
  }

  // Grading sheets need to be filtered via terms in current AY.
  const { data: termRows } = await service
    .from("terms")
    .select("id")
    .eq("academic_year_id", academicYearId);
  const termIds = (termRows ?? []).map((r) => r.id as string);

  let sheetsOpen = 0;
  let sheetsLocked = 0;
  if (termIds.length > 0) {
    const [{ count: openCount }, { count: lockedCount }] = await Promise.all([
      service
        .from("grading_sheets")
        .select("*", { count: "exact", head: true })
        .eq("is_locked", false)
        .in("term_id", termIds),
      service
        .from("grading_sheets")
        .select("*", { count: "exact", head: true })
        .eq("is_locked", true)
        .in("term_id", termIds),
    ]);
    sheetsOpen = openCount ?? 0;
    sheetsLocked = lockedCount ?? 0;
  }

  // Publications: active (now between from/until) vs scheduled (now < from).
  let publicationsActive = 0;
  let publicationsScheduled = 0;
  if (sectionIds.length > 0) {
    const nowIso = new Date().toISOString();
    const [{ count: active }, { count: scheduled }] = await Promise.all([
      service
        .from("report_card_publications")
        .select("*", { count: "exact", head: true })
        .in("section_id", sectionIds)
        .lte("publish_from", nowIso)
        .gte("publish_until", nowIso),
      service
        .from("report_card_publications")
        .select("*", { count: "exact", head: true })
        .in("section_id", sectionIds)
        .gt("publish_from", nowIso),
    ]);
    publicationsActive = active ?? 0;
    publicationsScheduled = scheduled ?? 0;
  }

  return {
    studentsActive,
    sectionsActive: sectionsActive ?? 0,
    sheetsOpen,
    sheetsLocked,
    publicationsActive,
    publicationsScheduled,
  };
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

function TrustStrip({ ayLabel }: { ayLabel: string }) {
  return (
    <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
      <Unlock className="size-3" strokeWidth={2.25} />
      <span>{ayLabel}</span>
      <span className="text-border">·</span>
      <span>Supabase Auth</span>
      <span className="text-border">·</span>
      <span>Audit-logged</span>
    </div>
  );
}
