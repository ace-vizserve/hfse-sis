import { AlertTriangle, ArrowLeft, Clock, FileStack, FolderKanban, TrendingUp } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ChartLegendChip } from "@/components/dashboard/chart-legend-chip";
import { ComparisonToolbar } from "@/components/dashboard/comparison-toolbar";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { InsightsPanel } from "@/components/dashboard/insights-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PriorityPanel } from "@/components/dashboard/priority-panel";
import { CompletenessTable, type StatusFilter } from "@/components/p-files/completeness-table";
import { DocumentChaseQueueStrip } from "@/components/sis/document-chase-queue-strip";
import {
  CompletenessCsvButton,
  CompletionByLevelDrillCard,
  SlotStatusDrillCard,
  TopMissingDrillCard,
} from "@/components/p-files/drills/chart-drill-cards";
import { PFilesDrillSheet } from "@/components/p-files/drills/pfiles-drill-sheet";
import { RevisionsHeatmapCard } from "@/components/p-files/revisions-heatmap-card";
import { RevisionsOverTimeChart } from "@/components/p-files/revisions-over-time-chart";
import { SummaryCards } from "@/components/p-files/summary-cards";
import { ExpiringDocumentsPanel } from "@/components/sis/expiring-documents-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { getCurrentAcademicYear, listAyCodes as listAcademicAyCodes } from "@/lib/academic-year";
import { pfilesInsights } from "@/lib/dashboard/insights";
import { formatRangeLabel, resolveRange, type DashboardSearchParams } from "@/lib/dashboard/range";
import { getDashboardWindows } from "@/lib/dashboard/windows";
import {
  getCompletionByLevel,
  getPFilesKpisRange,
  getPFilesPriority,
  getRevisionVelocityRange,
  getRevisionsHeatmap,
  getRevisionsOverTime,
  getSlotStatusMix,
} from "@/lib/p-files/dashboard";
import { getDocumentDashboardData } from "@/lib/p-files/queries";
import { freshenAyDocuments } from "@/lib/sis/freshen-document-statuses";
import { getDocumentValidationBacklog, getExpiringDocuments } from "@/lib/sis/dashboard";
import { getSessionUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Canonical set of status-filter values the sidebar Quicklinks use as
// `?status=...`. Keeps the validation + initial-filter computation honest.
const STATUS_FILTER_VALUES: readonly StatusFilter[] = ["all", "complete", "missing", "expired", "uploaded"];

function parseStatusFilter(raw: string | undefined): StatusFilter | undefined {
  if (!raw) return undefined;
  return (STATUS_FILTER_VALUES as readonly string[]).includes(raw) ? (raw as StatusFilter) : undefined;
}

// Per-status focused-view metadata. When a sidebar Quicklink sets `?status=`
// to a non-`all` value, the page renders a stripped-down "operational list"
// layout — no KPIs, no charts, just the table + filters at the top — using
// these strings for the hero title/description.
const STATUS_VIEW_META: Record<Exclude<StatusFilter, "all">, { eyebrow: string; title: string; description: string }> = {
  missing: {
    eyebrow: "P-Files · Missing documents",
    title: "Students missing documents",
    description: "Students with at least one document slot not yet uploaded. Filter further by AY, level, section, or search.",
  },
  expired: {
    eyebrow: "P-Files · Expired documents",
    title: "Students with expired documents",
    description: "Passport, pass, or guardian docs whose expiry date has passed. Filter further by AY, level, section, or search.",
  },
  uploaded: {
    eyebrow: "P-Files · Pending review",
    title: "Documents awaiting registrar review",
    description: "Parent uploaded — registrar to validate. Filter further by AY, level, section, or search.",
  },
  complete: {
    eyebrow: "P-Files · Fully validated",
    title: "Fully validated students",
    description: "Students whose required document slots are all validated and on file.",
  },
};

export default async function PFilesDashboard({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams & { status?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  if (sessionUser.role !== "p-file" && sessionUser.role !== "admin" && sessionUser.role !== "superadmin") redirect("/");

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">No current academic year configured.</div>
      </PageShell>
    );
  }

  const resolvedSearch = await searchParams;
  const ayParam = typeof resolvedSearch.ay === "string" ? resolvedSearch.ay : undefined;
  const statusParam = typeof resolvedSearch.status === "string" ? resolvedSearch.status : undefined;
  const ayCodes = await listAcademicAyCodes(service);
  const selectedAy = ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const isCurrentAy = selectedAy === currentAy.ay_code;
  const initialStatusFilter = parseStatusFilter(statusParam);

  const windows = await getDashboardWindows(selectedAy);
  const rangeInput = resolveRange(resolvedSearch, windows, selectedAy);

  // Auto-flip any expired-but-still-Valid doc statuses for this AY before
  // the dashboard reads the column. Cached 60s; existing PATCH routes
  // invalidate via the sis:${ayCode} tag.
  await freshenAyDocuments(selectedAy);

  // ──────────────────────────────────────────────────────────────────
  // Focused-view branch — when a sidebar Quicklink set ?status=missing |
  // expired | uploaded | complete, render a stripped-down operational
  // list (just hero + AY/range toolbar + the filtered table + trust
  // strip). KPIs, charts, chase strip, and heatmap are dropped because
  // they always show AY-wide data and would mislead users who expected
  // a focused list view.
  // ──────────────────────────────────────────────────────────────────
  if (initialStatusFilter && initialStatusFilter !== "all") {
    const meta = STATUS_VIEW_META[initialStatusFilter];
    const { students, summary } = await getDocumentDashboardData(selectedAy);

    return (
      <PageShell>
        <DashboardHero
          eyebrow={meta.eyebrow}
          title={meta.title}
          description={meta.description}
          badges={[
            { label: selectedAy },
            { label: isCurrentAy ? "Current" : "Historical", tone: isCurrentAy ? "mint" : "muted" },
          ]}
        />

        <ComparisonToolbar
          ayCode={selectedAy}
          ayCodes={ayCodes}
          range={{ from: rangeInput.from, to: rangeInput.to }}
          comparison={{ from: rangeInput.cmpFrom, to: rangeInput.cmpTo }}
          termWindows={windows.term}
          ayWindows={windows.ay}
        />

        {/* Escape hatch back to the full dashboard. The AY param is preserved
            so the user doesn't lose their AY selection. */}
        <Link
          href={`/p-files?ay=${encodeURIComponent(selectedAy)}`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to dashboard
        </Link>

        <CompletenessCsvButton ayCode={selectedAy} />
        <CompletenessTable
          key={`${selectedAy}:${initialStatusFilter}`}
          students={students}
          ayCode={isCurrentAy ? undefined : selectedAy}
          initialStatusFilter={initialStatusFilter}
        />

        <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <FolderKanban className="size-3" strokeWidth={2.25} />
          <span>{selectedAy}</span>
          <span className="text-border">·</span>
          <span>{summary.totalStudents.toLocaleString("en-SG")} students total</span>
          <span className="text-border">·</span>
          <span>Filter: {initialStatusFilter}</span>
          <span className="text-border">·</span>
          <span>Audit-logged</span>
        </div>
      </PageShell>
    );
  }

  const [
    { students, summary },
    byLevel,
    backlog,
    expiring,
    revisions,
    kpisResult,
    velocity,
    slotMix,
    revisionsHeatmap,
    priority,
  ] = await Promise.all([
    getDocumentDashboardData(selectedAy),
    getCompletionByLevel(selectedAy),
    getDocumentValidationBacklog(selectedAy),
    getExpiringDocuments(selectedAy, 60, 6),
    getRevisionsOverTime(selectedAy, 12),
    getPFilesKpisRange(rangeInput),
    getRevisionVelocityRange(rangeInput),
    getSlotStatusMix(selectedAy),
    getRevisionsHeatmap(selectedAy, 12),
    getPFilesPriority({ ayCode: selectedAy }),
  ]);

  const comparisonLabel = `vs ${formatRangeLabel({ from: rangeInput.cmpFrom, to: rangeInput.cmpTo })}`;

  const insights = pfilesInsights({
    revisionsInRange: kpisResult.current.revisionsInRange,
    revisionsInRangePrior: kpisResult.comparison.revisionsInRange,
    expiringSoon: kpisResult.current.expiringSoon,
    pendingReview: kpisResult.current.pendingReview,
    totalDocuments: kpisResult.current.totalDocuments,
    revisionsDelta: kpisResult.delta,
  });

  const donutSlices = [
    { name: "On file", value: slotMix.valid },
    { name: "Pending", value: slotMix.pending },
    { name: "Rejected", value: slotMix.rejected },
    { name: "Missing/Expired", value: slotMix.missing },
  ];

  return (
    <PageShell>
      <DashboardHero
        eyebrow="P-Files · Document tracking"
        title="Student document completeness"
        description="Retrieve validated student, parent, and guardian documents. Prior versions preserved in revision history."
        badges={[
          { label: selectedAy },
          { label: isCurrentAy ? "Current" : "Historical", tone: isCurrentAy ? "mint" : "muted" },
        ]}
      />

      <ComparisonToolbar
        ayCode={selectedAy}
        ayCodes={ayCodes}
        range={{ from: rangeInput.from, to: rangeInput.to }}
        comparison={{ from: rangeInput.cmpFrom, to: rangeInput.cmpTo }}
        termWindows={windows.term}
        ayWindows={windows.ay}
      />

      <PriorityPanel payload={priority} />

      {/* Document chase queue (spec 2026-04-28) — sibling to the expiring-docs
          PriorityPanel. Together they form "Documents needing attention". */}
      <DocumentChaseQueueStrip ayCode={selectedAy} />

      <InsightsPanel insights={insights} />

      {/* Range-aware KPIs */}
      <section className="grid gap-4 xl:grid-cols-4">
        <MetricCard
          label="Revisions (range)"
          value={kpisResult.current.revisionsInRange}
          icon={FileStack}
          intent="default"
          delta={kpisResult.delta}
          deltaGoodWhen="up"
          comparisonLabel={comparisonLabel}
          sparkline={velocity.current.slice(-14)}
          drillSheet={
            <PFilesDrillSheet
              target="all-docs"
              ayCode={selectedAy}
              initialScope="ay"
            />
          }
        />
        <MetricCard
          label="Expiring ≤60d"
          value={kpisResult.current.expiringSoon}
          icon={AlertTriangle}
          intent={kpisResult.current.expiringSoon > 0 ? "warning" : "good"}
          subtext="From end of range"
          drillSheet={
            <PFilesDrillSheet
              target="expired-docs"
              ayCode={selectedAy}
              initialScope="ay"
            />
          }
        />
        <MetricCard
          label="Pending review"
          value={kpisResult.current.pendingReview}
          icon={Clock}
          intent={kpisResult.current.pendingReview > 0 ? "warning" : "good"}
          subtext={`${kpisResult.comparison.pendingReview} prior`}
          drillSheet={
            <PFilesDrillSheet
              target="slot-by-status"
              segment="Pending review"
              ayCode={selectedAy}
              initialScope="ay"
            />
          }
        />
        <MetricCard
          label="Total docs tracked"
          value={kpisResult.current.totalDocuments}
          icon={TrendingUp}
          intent="default"
          subtext="All slots · all levels"
          drillSheet={
            <PFilesDrillSheet
              target="all-docs"
              ayCode={selectedAy}
              initialScope="ay"
            />
          }
        />
      </section>

      <SummaryCards summary={summary} />

      {/* Row 6 — wide revision trend + heatmap (12-week reference) */}
      <section className="grid gap-4 lg:grid-cols-2">
        <RevisionsOverTimeChart data={revisions} />
        <RevisionsHeatmapCard data={revisionsHeatmap} ayCode={selectedAy} weeks={12} />
      </section>

      {/* Row 7 — completion by level (2/3) + slot status mix (1/3) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CompletionByLevelDrillCard data={byLevel} ayCode={selectedAy} />
        </div>
        <div className="lg:col-span-1">
          <SlotStatusDrillCard slotMix={slotMix} ayCode={selectedAy} />
        </div>
      </section>

      {/* Row 8 — top missing (1/2) + expiring docs (1/2) */}
      <section className="grid gap-4 lg:grid-cols-2">
        <TopMissingDrillCard data={backlog} ayCode={selectedAy} />
        <Card>
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Expiring documents
            </CardDescription>
            <CardTitle className="font-serif text-xl">Next 60 days</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpiringDocumentsPanel
              rows={expiring}
              ayCode={selectedAy}
              windowDays={60}
              studentHrefBase="/p-files"
              viewAllHref={`/p-files?ay=${selectedAy}`}
            />
          </CardContent>
        </Card>
      </section>

      {/* Legend — placed immediately above the table it documents */}
      <section className="rounded-xl border border-hairline bg-background p-4">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Document Status Legend
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ChartLegendChip color="fresh" label="On file" />
          <ChartLegendChip color="stale" label="Pending review" />
          <ChartLegendChip color="very-stale" label="Expired" />
          <ChartLegendChip color="chart-2" label="Missing" />
        </div>
      </section>

      <CompletenessCsvButton ayCode={selectedAy} />
      {/* `key` forces a fresh mount when the sidebar Quicklink flips
          `?status=...` so the table's local statusFilter state actually
          re-initialises from the new initialStatusFilter prop. Without
          the key, useState only consumes the prop on first mount and
          ignores subsequent URL changes. */}
      <CompletenessTable
        key={`${selectedAy}:${initialStatusFilter ?? 'all'}`}
        students={students}
        ayCode={isCurrentAy ? undefined : selectedAy}
        initialStatusFilter={initialStatusFilter}
      />

      {/* Trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <FolderKanban className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>{summary.totalStudents.toLocaleString("en-SG")} students</span>
        <span className="text-border">·</span>
        <span>Cache 10m</span>
        <span className="text-border">·</span>
        <span>Audit-logged</span>
      </div>
    </PageShell>
  );
}
