import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  LayoutGrid,
  ListChecks,
  Settings2,
  Users,
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
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Admin Hub
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          SIS Admin · Activity
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Audit log.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          A history of every administrative change — sections created, teachers
          assigned, templates applied, approvers managed, school config edited,
          users added, and environment operations. Past entries are kept on the
          record.
        </p>
      </header>

      <Tabs value={view} className="w-full">
        <TabsList variant="segmented">
          <TabsTrigger value="overview" asChild>
            <Link href="/sis/audit-log?view=overview">Overview</Link>
          </TabsTrigger>
          <TabsTrigger value="log" asChild>
            <Link href="/sis/audit-log">Log</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === 'log' && logView ? (
        <>
          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
              <StatCard
                description="Entries loaded"
                value={logView.rows.length.toLocaleString('en-SG')}
                icon={ListChecks}
                footerTitle={
                  logView.count != null
                    ? `${logView.count.toLocaleString('en-SG')} total entries`
                    : `${logView.rows.length.toLocaleString('en-SG')} entries`
                }
                footerDetail={`Page ${logView.page} of ${logView.totalPages} · ${logView.pageSize} per page`}
              />
              <StatCard
                description="Unique actors"
                value={logView.uniqueActors.toLocaleString('en-SG')}
                icon={Users}
                footerTitle={
                  logView.uniqueActors === 1
                    ? '1 user'
                    : `${logView.uniqueActors} users`
                }
                footerDetail="Distinct accounts on this page"
              />
              <StatCard
                description="Config changes"
                value={logView.configChanges.toLocaleString('en-SG')}
                icon={Settings2}
                footerTitle={
                  logView.configChanges === 0
                    ? 'None on this page'
                    : 'High-impact operations'
                }
                footerDetail="School config, template applies, env switches"
              />
            </div>
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

function StatCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  footerTitle: string;
  footerDetail: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {description}
        </CardDescription>
        <CardTitle className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[34px]">
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
