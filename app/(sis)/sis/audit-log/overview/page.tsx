import {
  Activity,
  History,
  LayoutGrid,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { ComparisonToolbar } from '@/components/dashboard/comparison-toolbar';
import { InsightsPanel } from '@/components/dashboard/insights-panel';
import { MetricCard } from '@/components/dashboard/metric-card';
import { ActivityByActorCard } from '@/components/sis/activity-by-actor-card';
import { AuditAuthEventsCard } from '@/components/sis/audit-auth-events-card';
import { AuditDailyTrendCard } from '@/components/sis/audit-daily-trend-card';
import { AuditTopActionsCard } from '@/components/sis/audit-top-actions-card';
import { AuditByModuleDrillCard } from '@/components/sis/drills/audit-by-module-drill-card';
import { GradeChangePipelineCard } from '@/components/sis/grade-change-pipeline-card';
import { StructuralChangesFeedCard } from '@/components/sis/structural-changes-feed-card';
import { Card, CardContent } from '@/components/ui/card';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { sisInsights } from '@/lib/dashboard/insights';
import {
  formatRangeLabel,
  resolveRange,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import {
  getActivityByActor,
  getAuditActivityByModule,
  getAuditDailyTrend,
  getAuthEventCounts,
  getGradeChangePipeline,
  getStructuralChangeFeed,
  getTopAuditActions,
} from '@/lib/sis/dashboard';
import { createServiceClient } from '@/lib/supabase/service';

// Section divider for this page's flat stack (Miller's-Law grouping). A bare
// text-only version read as a stray flat box next to real Cards on the same
// page — this uses the app's actual size-7 inline gradient-tile recipe
// (template-manager-client.tsx's SectionPill, sidebar-header.tsx) instead.
// Neutral indigo/navy tile throughout: these are organisational groupings, not
// semantic states, and there is no precedent in this app for varying a tile's
// hue across non-semantic groupings (same rule hub-quick-actions.tsx documents).
function OverviewSectionDivider({
  label,
  icon: Icon,
}: {
  label: string;
  icon: LucideIcon;
}) {
  return (
    <div role="presentation" className="flex items-center gap-2.5 pt-2">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <Icon className="size-3.5" />
      </div>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

// The Overview cut — the BI dashboard relocated from the old SIS Admin hub's
// `?view=audit` tab (KD #154 / SIS Admin IA Phase 3). Session and role are
// guarded by the layout, which runs for this route too.
export default async function SisAuditLogOverviewPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const params = await searchParams;

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  const ayCode = currentAy?.ay_code ?? '';

  const [windows, ayCodes] = await Promise.all([
    ayCode
      ? getDashboardWindows(ayCode)
      : Promise.resolve({
          term: {
            thisTerm: null,
            lastTerm: null,
            byNumber: { 1: null, 2: null, 3: null, 4: null },
          },
          ay: { thisAY: null, lastAY: null },
          activeTermFallback: false,
        }),
    listAyCodes(service),
  ]);
  const rangeInput = ayCode ? resolveRange(params, windows, ayCode) : null;

  // Audit-activity queries can be slow on large audit_log tables; each call is
  // guarded so a transient DB error never tanks the whole page.
  const [
    auditResult,
    actorActivity,
    auditDailyTrend,
    gradeChangePipeline,
    topAuditActions,
    authEventCounts,
    structuralChangeFeed,
  ] = rangeInput
    ? await Promise.all([
        getAuditActivityByModule(rangeInput).catch((err) => {
          console.error('[sis] getAuditActivityByModule failed:', err);
          return null;
        }),
        getActivityByActor({
          from: rangeInput.from,
          to: rangeInput.to,
        }).catch((err) => {
          console.error('[sis] getActivityByActor failed:', err);
          return [];
        }),
        getAuditDailyTrend(rangeInput).catch(() => null),
        getGradeChangePipeline(rangeInput).catch(() => null),
        getTopAuditActions(rangeInput).catch(
          () => [] as { action: string; count: number }[]
        ),
        getAuthEventCounts(rangeInput).catch(() => null),
        getStructuralChangeFeed().catch(
          () => [] as Awaited<ReturnType<typeof getStructuralChangeFeed>>
        ),
      ])
    : [
        null,
        [],
        null,
        null,
        [] as { action: string; count: number }[],
        null,
        [] as Awaited<ReturnType<typeof getStructuralChangeFeed>>,
      ];

  // Derived values precomputed so the JSX stays pure — an in-place .sort()
  // running twice on the same array was misaligning the comparison chart and
  // triggering React 19's profiler "negative timestamp" warning.
  const comparisonLabel = auditResult?.comparisonRange
    ? `vs ${formatRangeLabel(auditResult.comparisonRange)}`
    : undefined;
  const currentTotal =
    auditResult?.current.reduce((s, p) => s + p.count, 0) ?? 0;
  const comparisonTotal =
    auditResult?.comparison?.reduce((s, p) => s + p.count, 0) ?? 0;
  const activeModules =
    auditResult?.current.filter((p) => p.count > 0).length ?? 0;
  const trackedModules = auditResult?.current.length ?? 0;
  const ranked = auditResult
    ? [...auditResult.current].sort((a, b) => b.count - a.count)
    : [];
  const topModule = ranked[0]?.module ?? '—';
  const topModuleCount = ranked[0]?.count ?? 0;
  const chartData = auditResult
    ? auditResult.current.map((row, i) => ({
        category: row.module,
        current: row.count,
        ...(auditResult.comparison
          ? { comparison: auditResult.comparison[i]?.count ?? 0 }
          : {}),
      }))
    : [];

  const insights = auditResult
    ? sisInsights({
        auditEventsCurrent: currentTotal,
        auditEventsComparison: auditResult.comparison
          ? comparisonTotal
          : undefined,
        auditDelta: auditResult.delta ?? undefined,
        topModule: ranked[0],
        activeModules,
        trackedModules,
      })
    : [];

  if (!rangeInput || !auditResult) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Audit data unavailable for this range. Try a different range or
          revisit later.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <OverviewSectionDivider label="Volume" icon={Activity} />
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

      {insights.length > 0 && <InsightsPanel insights={insights} />}

      <section
        className={`grid gap-4 ${auditResult.comparison ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}
      >
        <MetricCard
          label="Audit events"
          value={currentTotal}
          icon={Activity}
          intent="default"
          delta={auditResult.delta ?? undefined}
          deltaGoodWhen="up"
          comparisonLabel={comparisonLabel}
        />
        {auditResult.comparison && (
          <MetricCard
            label="Prior period total"
            value={comparisonTotal}
            icon={Activity}
            intent="default"
            subtext="For comparison"
          />
        )}
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

      {auditDailyTrend && (
        <AuditDailyTrendCard
          current={auditDailyTrend.current}
          comparison={auditDailyTrend.comparison}
        />
      )}

      <OverviewSectionDivider label="Who" icon={Users} />
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

      <OverviewSectionDivider label="What changed" icon={History} />
      <section className="grid gap-4 lg:grid-cols-2">
        {gradeChangePipeline && (
          <GradeChangePipelineCard pipeline={gradeChangePipeline} />
        )}
        <AuditTopActionsCard actions={topAuditActions} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {authEventCounts && <AuditAuthEventsCard counts={authEventCounts} />}
        <StructuralChangesFeedCard rows={structuralChangeFeed} />
      </section>
    </>
  );
}
