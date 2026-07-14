import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  History,
  LayoutGrid,
  ListChecks,
  Settings2,
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
import { HubStat } from '@/components/sis/hub-stat';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { StructuralChangesFeedCard } from '@/components/sis/structural-changes-feed-card';
import { Card, CardContent } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  AuditLogDataTable,
  type MergedRow,
} from '@/app/(markbook)/markbook/audit-log/audit-log-data-table';

// Section divider for the Overview tab's flat stack (Miller's-Law grouping,
// layout redesign pass, Phase 8). A bare text-only version of this read as
// a stray flat box next to real Cards on the same page — gives it the
// app's actual size-7 inline gradient-tile recipe (template-manager-client
// .tsx's SectionPill, sidebar-header.tsx) instead. Neutral indigo/navy tile
// throughout: these are organisational groupings, not semantic states, and
// there's no precedent anywhere in this app for varying a tile's hue across
// non-semantic groupings (same rule hub-quick-actions.tsx documents).
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

// Config-axis actions owned by SIS Admin. Student-record-axis actions
// (sis.profile.update, student.section.transfer, ay.*, pfile.*, etc.)
// live on /records/audit-log — this page covers the structural admin tier.
// user.login + parent.session.* included here for session-issuance visibility.
const SIS_AUDIT_ALLOWLIST = [
  // Approver assignments (KD #41)
  'approver.assign',
  'approver.revoke',
  // Subject catalog (KD #72)
  'subject.create',
  'subject_config.update',
  // Master class template (KD #66, #72)
  'template.section.create',
  'template.section.update',
  'template.section.delete',
  'template.subject_config.create',
  'template.subject_config.update',
  'template.subject_config.delete',
  'template.subject_config.bulk_delete',
  'template.apply',
  // Sections + teacher assignments
  'section.create',
  'section.rename',
  'section.realphabetize',
  'section.subject.assign',
  'section.subject.remove',
  'section.subjects.load_defaults',
  'assignment.create',
  'assignment.delete',
  // Grade levels & progression (migration 078)
  'level.create',
  'level.update',
  'level.delete',
  'level.offering.toggle',
  // School calendar (/sis/calendar) — full trail incl. events + auto-seed
  'attendance.calendar.upsert',
  'attendance.calendar.delete',
  'attendance.calendar.autoseed',
  'attendance.calendar.copy_from_prior_ay',
  'attendance.event.create',
  'attendance.event.update',
  'attendance.event.delete',
  // Term dates / virtue / grading lock (/sis/ay-setup)
  'ay.term_dates.update',
  'ay.term_virtue.update',
  'ay.term_grading_lock.update',
  // School config
  'school_config.update',
  // User provisioning (KD #87)
  'user.invite',
  'user.create',
  'user.role.update',
  'user.disable',
  'user.enable',
  // Environment + seeder (KD #52)
  'environment.switch',
  'environment.seed',
  'environment.topup',
  // Session issuance (Phase 7 — visibility for security review)
  'user.login',
  'parent.session.issued',
  'parent.session.cleared',
] as const;

type SisAuditLogSearchParams = DashboardSearchParams & {
  view?: string;
  page?: string;
  pageSize?: string;
};

export default async function SisAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SisAuditLogSearchParams>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const params = await searchParams;
  const view = (params.view === 'overview' ? 'overview' : 'log') as
    | 'log'
    | 'overview';

  // ───────────────────────────────────────────────────────────────────────
  // Log-view fetches — the paginated allowlisted table. Only run on Log so
  // the Overview tab's heavier BI queries below never fire on this branch.
  // ───────────────────────────────────────────────────────────────────────
  let logView: {
    rows: MergedRow[];
    count: number | null;
    error: { message: string } | null;
    page: number;
    pageSize: number;
    totalPages: number;
    uniqueActors: number;
    configChanges: number;
  } | null = null;

  if (view === 'log') {
    const PAGE_SIZE = Math.min(Number(params.pageSize ?? 50), 200);
    const page = Math.max(Number(params.page ?? 1), 1);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const supabase = await createClient();

    const { data, count, error } = await supabase
      .from('audit_log')
      .select(
        'id, actor_email, action, entity_type, entity_id, context, created_at',
        { count: 'exact' }
      )
      .in('action', SIS_AUDIT_ALLOWLIST)
      .order('created_at', { ascending: false })
      .range(from, to);

    const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1;

    const rows: MergedRow[] = (
      (data ?? []) as Array<{
        id: string;
        actor_email: string;
        action: string;
        entity_type: string;
        entity_id: string | null;
        context: Record<string, unknown>;
        created_at: string;
      }>
    ).map(
      (r): MergedRow => ({
        id: `new-${r.id}`,
        at: r.created_at,
        actor: r.actor_email,
        action: r.action,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        context: r.context ?? {},
        sheet_id: null,
        source: 'audit_log',
      })
    );

    const uniqueActors = new Set(rows.map((r) => r.actor)).size;
    const configChanges = rows.filter(
      (r) =>
        r.action === 'school_config.update' ||
        r.action === 'template.apply' ||
        r.action === 'environment.switch'
    ).length;

    logView = {
      rows,
      count,
      error,
      page,
      pageSize: PAGE_SIZE,
      totalPages,
      uniqueActors,
      configChanges,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Overview-view fetches — the BI dashboard relocated from the old SIS
  // Admin hub's `?view=audit` tab (KD #154 / SIS Admin IA Phase 3). Loaders
  // + derived values are transplanted verbatim; only fires on Overview.
  // ───────────────────────────────────────────────────────────────────────
  let overview: {
    ayCode: string;
    ayCodes: string[];
    windows: Awaited<ReturnType<typeof getDashboardWindows>>;
    rangeInput: ReturnType<typeof resolveRange> | null;
    auditResult: Awaited<ReturnType<typeof getAuditActivityByModule>> | null;
    actorActivity: Awaited<ReturnType<typeof getActivityByActor>>;
    auditDailyTrend: Awaited<ReturnType<typeof getAuditDailyTrend>> | null;
    gradeChangePipeline: Awaited<
      ReturnType<typeof getGradeChangePipeline>
    > | null;
    topAuditActions: { action: string; count: number }[];
    authEventCounts: Awaited<ReturnType<typeof getAuthEventCounts>> | null;
    structuralChangeFeed: Awaited<ReturnType<typeof getStructuralChangeFeed>>;
  } | null = null;

  if (view === 'overview') {
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

    // Audit-activity fetches. Audit-activity queries can be slow on large
    // audit_log tables; guard each call so a transient DB error never tanks
    // the whole page.
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

    overview = {
      ayCode,
      ayCodes,
      windows,
      rangeInput,
      auditResult,
      actorActivity,
      auditDailyTrend,
      gradeChangePipeline,
      topAuditActions,
      authEventCounts,
      structuralChangeFeed,
    };
  }

  // Precompute derived values so JSX stays pure (no in-place .sort() mutating
  // the same array multiple times — that was misaligning the comparison
  // chart and triggering React 19's profiler "negative timestamp" warning).
  const auditResult = overview?.auditResult ?? null;
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

  return (
    <PageShell>
      <SisPageHeader
        group="Access & system"
        title="Audit log."
        description="A history of every administrative change — sections created, teachers assigned, templates applied, approvers managed, school config edited, users added, and environment operations. Past entries are kept on the record."
      />

      {/* Log first — it's the actual default view (Serial Position Effect:
          tab order should match visit frequency, not alphabetical/build
          order). Overview is the deliberate second stop for BI review. */}
      <Tabs value={view} className="w-full">
        <TabsList variant="segmented">
          <TabsTrigger value="log" asChild>
            <Link href="/sis/audit-log">Log</Link>
          </TabsTrigger>
          <TabsTrigger value="overview" asChild>
            <Link href="/sis/audit-log?view=overview">Overview</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === 'log' && logView ? (
        <>
          {/* HubStat here (vs. MetricCard on Overview below) is a deliberate,
              documented split, not a silent inconsistency: this is a live
              paginated-page glance with no delta/comparison need, the exact
              case HubStat was built for; Overview's KPIs carry a real
              period-over-period delta chip, which only MetricCard supports. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <HubStat
              label="Entries loaded"
              value={logView.rows.length}
              icon={ListChecks}
              tone="brand"
              subtext={
                logView.count != null
                  ? `${logView.count.toLocaleString('en-SG')} total · page ${logView.page}/${logView.totalPages}`
                  : `Page ${logView.page} of ${logView.totalPages}`
              }
            />
            <HubStat
              label="Unique actors"
              value={logView.uniqueActors}
              icon={Users}
              tone="sky"
              subtext="Distinct accounts on this page"
            />
            <HubStat
              label="Config changes"
              value={logView.configChanges}
              icon={Settings2}
              tone={logView.configChanges > 0 ? 'amber' : 'muted'}
              subtext="School config, template applies, env switches"
            />
          </div>

          {logView.error && (
            <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
                <AlertTriangle className="size-4" />
              </div>
              <div className="flex-1 space-y-1.5">
                <p className="font-serif text-base font-semibold leading-tight text-foreground">
                  Could not load audit entries
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {logView.error.message}
                </p>
              </div>
            </div>
          )}

          <AuditLogDataTable
            rows={logView.rows}
            canExport={sessionUser.role === 'superadmin'}
            pagination={{
              page: logView.page,
              pageSize: logView.pageSize,
              totalPages: logView.totalPages,
              total: logView.count ?? 0,
            }}
          />
        </>
      ) : null}

      {view === 'overview' && overview ? (
        <>
          {overview.rangeInput && overview.auditResult ? (
            <>
              <OverviewSectionDivider label="Volume" icon={Activity} />
              <ComparisonToolbar
                ayCode={overview.ayCode}
                ayCodes={overview.ayCodes}
                range={{
                  from: overview.rangeInput.from,
                  to: overview.rangeInput.to,
                }}
                comparison={
                  overview.rangeInput.cmpFrom && overview.rangeInput.cmpTo
                    ? {
                        from: overview.rangeInput.cmpFrom,
                        to: overview.rangeInput.cmpTo,
                      }
                    : null
                }
                termWindows={overview.windows.term}
                ayWindows={overview.windows.ay}
                showAySwitcher={false}
              />

              {insights.length > 0 && <InsightsPanel insights={insights} />}

              <section
                className={`grid gap-4 ${overview.auditResult.comparison ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}
              >
                <MetricCard
                  label="Audit events"
                  value={currentTotal}
                  icon={Activity}
                  intent="default"
                  delta={overview.auditResult.delta ?? undefined}
                  deltaGoodWhen="up"
                  comparisonLabel={comparisonLabel}
                />
                {overview.auditResult.comparison && (
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

              {overview.auditDailyTrend && (
                <AuditDailyTrendCard
                  current={overview.auditDailyTrend.current}
                  comparison={overview.auditDailyTrend.comparison}
                />
              )}

              <OverviewSectionDivider label="Who" icon={Users} />
              <section className="grid gap-4 lg:grid-cols-2">
                <AuditByModuleDrillCard
                  data={chartData}
                  rangeFrom={overview.rangeInput.from}
                  rangeTo={overview.rangeInput.to}
                />
                <ActivityByActorCard
                  data={overview.actorActivity}
                  rangeFrom={overview.rangeInput.from}
                  rangeTo={overview.rangeInput.to}
                />
              </section>

              <OverviewSectionDivider label="What changed" icon={History} />
              <section className="grid gap-4 lg:grid-cols-2">
                {overview.gradeChangePipeline && (
                  <GradeChangePipelineCard
                    pipeline={overview.gradeChangePipeline}
                  />
                )}
                <AuditTopActionsCard actions={overview.topAuditActions} />
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                {overview.authEventCounts && (
                  <AuditAuthEventsCard counts={overview.authEventCounts} />
                )}
                <StructuralChangesFeedCard
                  rows={overview.structuralChangeFeed}
                />
              </section>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Audit data unavailable for this range. Try a different range or
                revisit later.
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </PageShell>
  );
}
