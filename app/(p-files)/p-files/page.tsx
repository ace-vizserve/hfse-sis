import { AlertTriangle, Clock, FileStack, FolderKanban, TrendingUp } from "lucide-react";
import { redirect } from "next/navigation";

import { ActionList, type ActionItem } from "@/components/dashboard/action-list";
import { ChartLegendChip } from "@/components/dashboard/chart-legend-chip";
import { ComparisonToolbar } from "@/components/dashboard/comparison-toolbar";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { InsightsPanel } from "@/components/dashboard/insights-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { CompletenessTable, type StatusFilter } from "@/components/p-files/completeness-table";
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
  getRevisionVelocityRange,
  getRevisionsHeatmap,
  getRevisionsOverTime,
  getSlotStatusMix,
} from "@/lib/p-files/dashboard";
import { getDocumentDashboardData } from "@/lib/p-files/queries";
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

  // Docs-to-collect action list from the expiring panel.
  const expiringItems: ActionItem[] = expiring.slice(0, 6).map((row) => ({
    label: row.studentName,
    sublabel: row.slotLabel,
    meta: row.daysUntilExpiry < 0 ? `${Math.abs(row.daysUntilExpiry)}d overdue` : `${row.daysUntilExpiry}d left`,
    severity: row.daysUntilExpiry < 0 ? "bad" : row.daysUntilExpiry <= 14 ? "warn" : "info",
    href: `/p-files/${row.enroleeNumber}`,
  }));

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

      <ActionList
        title="Documents to collect"
        description="Students with documents expiring or overdue — contact families to renew."
        items={expiringItems}
        emptyLabel="No outstanding documents. Everything on file."
        viewAllHref={`/p-files?ay=${selectedAy}&status=expired`}
      />

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
      <CompletenessTable
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
