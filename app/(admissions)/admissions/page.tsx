import {
  Archive,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChartBar,
  FileCheck,
  FileStack,
  Handshake,
  History,
  Hourglass,
  Plane,
  Stethoscope,
  TrendingUp,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  DocumentCompletenessTable,
  type AdmissionsStatusFilter as AdmissionsChaseStatusFilter,
} from '@/components/shared/document-completeness-table';
import { ApplicationsByLevelCard } from '@/components/admissions/applications-by-level-card';
import { DocumentCompletionCard } from '@/components/admissions/document-completion-card';
import { AdmissionsDrillSheet } from '@/components/admissions/drills/admissions-drill-sheet';
import { DocumentChaseQueueStrip } from '@/components/sis/document-chase-queue-strip';
import { NewApplicationsPriority } from '@/components/admissions/new-applications-priority';
import {
  AssessmentDrillCard,
  PipelineDrillCard,
  ReferralDrillCard,
  TimeToEnrollDrillCard,
} from '@/components/admissions/drills/chart-drill-cards';
import { TrendChart } from '@/components/dashboard/charts/trend-chart';
import { ComparisonToolbar } from '@/components/dashboard/comparison-toolbar';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { InsightsPanel } from '@/components/dashboard/insights-panel';
import { MetricCard } from '@/components/dashboard/metric-card';
import { PriorityPanel } from '@/components/dashboard/priority-panel';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import {
  getCurrentAcademicYear,
  getUpcomingAcademicYear,
  listAyCodes as listAcademicAyCodes,
} from '@/lib/academic-year';
import { listStudents } from '@/lib/sis/queries';
import { UpcomingAyCard } from '@/components/admissions/upcoming-ay-card';
import {
  getAdmissionsCompletenessForChase,
  getAdmissionsKpisRange,
  getApplicationsByLevelRange,
  getApplicationsVelocityRange,
  getAssessmentOutcomes,
  getConversionFunnel,
  getDocumentCompletionByLevel,
  getOutdatedApplications,
  getReferralSourceBreakdown,
  getTimeToEnrollHistogram,
} from '@/lib/admissions/dashboard';
import { getAdmissionsPriority } from '@/lib/admissions/priority';
import { buildDrillRows } from '@/lib/admissions/drill';
import { STALENESS_FOLLOW_UP_VALUES } from '@/lib/admissions/staleness';
import {
  getAdmissionsFeedback,
  getPreCourseStats,
} from '@/lib/admissions/feedback';
import {
  admissionsChaseInsights,
  admissionsInsights,
} from '@/lib/dashboard/insights';
import {
  formatRangeLabel,
  resolveRange,
  FLEXIBLE_PRESETS,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import { getPipelineStageBreakdown } from '@/lib/sis/dashboard';
import { freshenAyDocuments } from '@/lib/p-files/freshen-document-statuses';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Sidebar Quicklink status filters that flip the page into a focused
// chase view (KD #64 mirrored for admissions). When `?status=` matches
// one of these, the page renders only DashboardHero + ComparisonToolbar +
// back-link + AdmissionsCompletenessTable + trust strip — KPIs / charts /
// chase strip / etc. are skipped because they always show AY-wide data
// and would mislead users who expected a focused list.
const FOCUSED_VIEW_STATUSES: ReadonlyArray<AdmissionsChaseStatusFilter> = [
  'to-follow',
  'rejected',
  'uploaded',
  'expired',
];

function parseChaseStatusFilter(
  raw: string | undefined
): AdmissionsChaseStatusFilter | undefined {
  if (!raw) return undefined;
  return (FOCUSED_VIEW_STATUSES as readonly string[]).includes(raw)
    ? (raw as AdmissionsChaseStatusFilter)
    : undefined;
}

const STATUS_VIEW_META: Record<
  Exclude<AdmissionsChaseStatusFilter, 'all'>,
  { eyebrow: string; title: string; description: string }
> = {
  'to-follow': {
    eyebrow: 'Admissions · To follow',
    title: 'Applicants with documents to follow',
    description:
      "Parents committed to upload but haven't sent the file yet. Use the bulk action to chase the entire list at once.",
  },
  rejected: {
    eyebrow: 'Admissions · Rejected documents',
    title: 'Applicants with rejected documents',
    description:
      'Documents bounced by the registrar — re-notify parents so they can re-upload before the funnel stalls.',
  },
  uploaded: {
    eyebrow: 'Admissions · Pending review',
    title: 'Applicants with documents pending review',
    description:
      'Parent uploads waiting for registrar validation. Validate from the applicant detail page or chase if a file is malformed.',
  },
  expired: {
    eyebrow: 'Admissions · Expired documents',
    title: 'Applicants with expired documents',
    description:
      'Un-enrolled applicants whose passport, pass, or guardian docs lapsed mid-pipeline. Chase parents to re-upload before enrollment can complete.',
  },
};

// Admissions-module dashboard: pre-enrolment funnel metrics only. Enrolled
// student analytics live on /records. This is the admissions team's home
// surface — they track conversion, time-to-enroll, outdated apps here.
export default async function AdmissionsDashboard({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams & { status?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'admissions' &&
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }
  // KD #51: admissions team owns the funnel; registrar joins on enrolled
  // hand-off. Both are operational here — they triage new applications,
  // chase documents, and validate uploads. school_admin/admin/superadmin
  // are oversight: same KPIs + analytics, no priority/chase top-of-fold.
  const isOperational =
    sessionUser.role === 'admissions' || sessionUser.role === 'registrar';

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) {
    return (
      <PageShell>
        <NoCurrentAyCard />
      </PageShell>
    );
  }

  const resolvedSearch = await searchParams;
  const ayParam =
    typeof resolvedSearch.ay === 'string' ? resolvedSearch.ay : undefined;
  const statusParam =
    typeof resolvedSearch.status === 'string'
      ? resolvedSearch.status
      : undefined;
  const ayCodes = await listAcademicAyCodes(service);
  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const isCurrentAy = selectedAy === currentAy.ay_code;
  const focusedStatus = parseChaseStatusFilter(statusParam);

  const windows = await getDashboardWindows(selectedAy);
  const rangeInput = resolveRange(
    resolvedSearch,
    windows,
    selectedAy,
    undefined,
    {
      defaultPreset: 'thisMonth',
    }
  );

  // Auto-flip runs in parallel with subsequent fetches instead of blocking
  // serially. Cached 60s, tag-invalidated by sis:${ayCode}, so most
  // navigations are a no-op anyway. We await later to guarantee the
  // audit-log entries land before render returns.
  const freshenPromise = freshenAyDocuments(selectedAy);

  // ──────────────────────────────────────────────────────────────────
  // Focused-view branch — when a sidebar Quicklink set ?status=to-follow
  // | rejected | uploaded, render a stripped-down operational list
  // (hero + AY/range toolbar + filtered table + back link). KPIs,
  // charts, and the rest of the analytical dashboard are dropped because
  // they would always show AY-wide data and would mislead users who
  // expected a focused list view.
  // ──────────────────────────────────────────────────────────────────
  if (focusedStatus && focusedStatus !== 'all') {
    const meta = STATUS_VIEW_META[focusedStatus];
    // freshen runs in parallel with the focused-view chase fetch.
    const [{ students, summary }] = await Promise.all([
      getAdmissionsCompletenessForChase(selectedAy, focusedStatus),
      freshenPromise,
    ]);

    return (
      <PageShell>
        <DashboardHero
          eyebrow={meta.eyebrow}
          title={meta.title}
          description={meta.description}
          badges={[
            { label: selectedAy },
            {
              label: isCurrentAy ? 'Current' : 'Historical',
              tone: isCurrentAy ? 'mint' : 'muted',
            },
          ]}
        />

        <ComparisonToolbar
          ayCode={selectedAy}
          ayCodes={ayCodes}
          range={{ from: rangeInput.from, to: rangeInput.to }}
          comparison={
            rangeInput.cmpFrom && rangeInput.cmpTo
              ? { from: rangeInput.cmpFrom, to: rangeInput.cmpTo }
              : null
          }
          termWindows={windows.term}
          ayWindows={windows.ay}
          presets={FLEXIBLE_PRESETS}
          trustStrip={
            <p className="text-[11px] text-muted-foreground">
              Filtering by{' '}
              <strong className="font-semibold text-foreground">
                application date
              </strong>{' '}
              · drills that count enrolments switch to enrollment date.
            </p>
          }
        />

        <Link
          href={`/admissions?ay=${encodeURIComponent(selectedAy)}`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to dashboard
        </Link>

        <DocumentCompletenessTable
          module="admissions"
          key={`${selectedAy}:${focusedStatus}`}
          students={students}
          ayCode={isCurrentAy ? undefined : selectedAy}
          initialStatusFilter={focusedStatus}
          bulkRemindEnabled={isOperational}
        />

        <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <FileStack className="size-3" strokeWidth={2.25} />
          <span>{selectedAy}</span>
          <span className="text-border">·</span>
          <span>
            {students.length.toLocaleString('en-SG')} of{' '}
            {summary.totalApplicants.toLocaleString('en-SG')} applicants
          </span>
          <span className="text-border">·</span>
          <span>Filter: {focusedStatus}</span>
        </div>
      </PageShell>
    );
  }

  const [
    pipelineStages,
    funnel,
    outdated,
    assessment,
    referral,
    kpisResult,
    velocity,
    histogram,
    appsByLevel,
    docCompletion,
    drillRows,
    chaseSummary,
    admissionsChasePriority,
    feedbackResult,
    preCourseStats,
  ] = await Promise.all([
    getPipelineStageBreakdown(selectedAy),
    getConversionFunnel(selectedAy),
    getOutdatedApplications(selectedAy),
    getAssessmentOutcomes(selectedAy),
    getReferralSourceBreakdown(selectedAy),
    getAdmissionsKpisRange(rangeInput),
    getApplicationsVelocityRange(rangeInput),
    getTimeToEnrollHistogram(selectedAy),
    getApplicationsByLevelRange(rangeInput),
    getDocumentCompletionByLevel(selectedAy),
    // withDocs:true here because the page-level pre-fetch seeds initialRows
    // for drills that render doc-completeness (applications, enrolled,
    // outdated, doc-completion, applications-by-level). Cheap at admissions
    // scale (~400 applicants).
    buildDrillRows(
      {
        ayCode: selectedAy,
        from: rangeInput.from,
        to: rangeInput.to,
      },
      { withDocs: true }
    ),
    // Workstream A — chase summary feeds the chase insights panel; the
    // priority panel + chase strip do their own internal fetch.
    getAdmissionsCompletenessForChase(selectedAy, 'all').then((r) => r.summary),
    getAdmissionsPriority({ ayCode: selectedAy }),
    getAdmissionsFeedback(selectedAy),
    getPreCourseStats(selectedAy),
  ]);

  // Freshen runs in parallel with the data fetches above; awaited here so
  // audit-log entries land before render returns.
  await freshenPromise;

  // KD #77 — surface early-bird volume on the current-AY view so registrars
  // notice activity without manually flipping the AY switcher. Only fetched
  // when the user is on the current AY (no point showing it when they're
  // already viewing a historical or upcoming AY).
  const upcomingAy = isCurrentAy ? await getUpcomingAcademicYear() : null;
  let upcomingAyCardData: {
    ayCode: string;
    ayLabel: string;
    applicationCount: number;
    byStage: {
      submitted: number;
      ongoingVerification: number;
      processing: number;
    };
  } | null = null;
  if (upcomingAy) {
    const ACTIVE_STAGES = new Set([
      'Submitted',
      'Ongoing Verification',
      'Processing',
    ]);
    const upcomingStudents = await listStudents(
      upcomingAy.ay_code,
      'created_at_desc'
    );
    const inFlight = upcomingStudents.filter((s) =>
      ACTIVE_STAGES.has((s.applicationStatus ?? '').trim())
    );
    upcomingAyCardData = {
      ayCode: upcomingAy.ay_code,
      ayLabel: upcomingAy.label,
      applicationCount: inFlight.length,
      byStage: {
        submitted: inFlight.filter((s) => s.applicationStatus === 'Submitted')
          .length,
        ongoingVerification: inFlight.filter(
          (s) => s.applicationStatus === 'Ongoing Verification'
        ).length,
        processing: inFlight.filter((s) => s.applicationStatus === 'Processing')
          .length,
      },
    };
  }

  const chaseInsights = admissionsChaseInsights({
    chaseToFollow: chaseSummary.withToFollow,
    chaseRejected: chaseSummary.withRejected,
    chaseUploaded: chaseSummary.withUploaded,
    chaseExpired: chaseSummary.withExpired,
    totalApplicants: chaseSummary.totalApplicants,
  });

  const comparisonLabel = kpisResult.comparisonRange
    ? `vs ${formatRangeLabel(kpisResult.comparisonRange)}`
    : undefined;

  // Build insights from already-fetched data — pure derivation, no extra DB calls.
  const topRef = referral[0];
  const totalRef = referral.reduce((s, r) => s + r.count, 0);
  const biggestDrop = funnel.reduce(
    (acc, stage) => (stage.dropOffPct > (acc?.dropOffPct ?? 0) ? stage : acc),
    funnel[0] ?? null
  );
  // The "needs follow-up" insight deep-links straight into the applications
  // table pre-filtered to the stale rows (Warning + Critical) — there's no
  // separate follow-up card anymore; the insight IS the entry point.
  const outdatedHref = `/admissions/applications?ay=${selectedAy}&students.staleness=${STALENESS_FOLLOW_UP_VALUES.join(',')}`;
  const insights = admissionsInsights({
    applications: kpisResult.current.applicationsInRange,
    enrolled: kpisResult.current.enrolledInRange,
    conversionPct: kpisResult.current.conversionPct,
    conversionPctPrior: kpisResult.comparison?.conversionPct,
    avgDaysToEnroll: kpisResult.current.avgDaysToEnroll,
    avgDaysToEnrollPrior: kpisResult.comparison?.avgDaysToEnroll,
    appsDelta: kpisResult.delta ?? undefined,
    outdatedCount: outdated.length,
    outdatedHref,
    topReferral: topRef
      ? { source: topRef.source, count: topRef.count, totalCount: totalRef }
      : undefined,
    funnelDropOff: biggestDrop
      ? { stage: biggestDrop.stage, dropOffPct: biggestDrop.dropOffPct }
      : undefined,
  });

  return (
    <PageShell>
      <DashboardHero
        eyebrow={
          isOperational
            ? 'Admissions · Pre-enrolment funnel'
            : 'Admissions · School-wide overview'
        }
        title={
          isOperational ? 'Admissions dashboard' : 'Admissions — oversight'
        }
        description={
          isOperational
            ? 'Inquiry → applied → interviewed → offered → accepted. Once enrolled, the permanent record lives in Records.'
            : 'Read-only oversight of the pre-enrolment funnel. Day-to-day triage, document chase, and validation are owned by the admissions team and registrar.'
        }
        badges={[
          { label: selectedAy },
          {
            label: isCurrentAy ? 'Current' : 'Historical',
            tone: isCurrentAy ? 'mint' : 'muted',
          },
        ]}
      />

      <ComparisonToolbar
        ayCode={selectedAy}
        ayCodes={ayCodes}
        range={{ from: rangeInput.from, to: rangeInput.to }}
        comparison={
          rangeInput.cmpFrom && rangeInput.cmpTo
            ? { from: rangeInput.cmpFrom, to: rangeInput.cmpTo }
            : null
        }
        termWindows={windows.term}
        ayWindows={windows.ay}
        presets={FLEXIBLE_PRESETS}
        trustStrip={
          <p className="text-[11px] text-muted-foreground">
            Filtering by{' '}
            <strong className="font-semibold text-foreground">
              application date
            </strong>{' '}
            · drills that count enrolments switch to enrollment date.
          </p>
        }
      />

      {/* ───────────────── ACT NOW ─────────────────
          Operational top-of-fold: early-bird signal, new-application triage,
          and the document-chase cluster. Gated to admissions/registrar;
          oversight roles skip this (they see the same counts via the NUMBERS
          grid + drill sheets below). */}
      {/* KD #77 — early-bird signal. Renders only when an upcoming AY is
          accepting applications AND the user is viewing the current AY
          (the card is a forward-looking signal, not a historical lens). */}
      {upcomingAyCardData && <UpcomingAyCard {...upcomingAyCardData} />}

      {/* New applications waiting on triage. */}
      {isOperational && <NewApplicationsPriority ayCode={selectedAy} />}

      {/* Chase strip + chase priority + chase narrative. */}
      {isOperational && (
        <>
          <DocumentChaseQueueStrip ayCode={selectedAy} lens="admissions" />
          <PriorityPanel payload={admissionsChasePriority} />
          <InsightsPanel insights={chaseInsights} />
        </>
      )}

      {/* ───────────────── NUMBERS ─────────────────
          Range-aware funnel KPIs, immediately followed by the funnel
          narrative insights so the headline numbers and their story sit
          together. */}
      <section className="grid gap-4 xl:grid-cols-4">
        <MetricCard
          label="Applications (range)"
          value={kpisResult.current.applicationsInRange}
          icon={FileStack}
          intent="default"
          delta={kpisResult.delta ?? undefined}
          deltaGoodWhen="up"
          comparisonLabel={comparisonLabel}
          sparkline={velocity.current.slice(-14)}
          drillSheet={() => (
            <AdmissionsDrillSheet
              target="applications"
              ayCode={selectedAy}
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
              initialRows={drillRows}
            />
          )}
        />
        <MetricCard
          label="Enrolled (range)"
          value={kpisResult.current.enrolledInRange}
          icon={UserPlus}
          intent="good"
          subtext={
            kpisResult.comparison
              ? `${kpisResult.comparison.enrolledInRange} prior`
              : undefined
          }
          drillSheet={() => (
            <AdmissionsDrillSheet
              target="enrolled"
              ayCode={selectedAy}
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
              initialRows={drillRows}
            />
          )}
        />
        <MetricCard
          label="Conversion rate"
          value={kpisResult.current.conversionPct}
          format="percent"
          icon={TrendingUp}
          intent="default"
          subtext={
            kpisResult.comparison
              ? `${kpisResult.comparison.conversionPct.toFixed(1)}% prior`
              : undefined
          }
          drillSheet={() => (
            <AdmissionsDrillSheet
              target="conversion"
              ayCode={selectedAy}
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
              initialRows={drillRows}
            />
          )}
        />
        <MetricCard
          label="Avg time to enroll"
          value={kpisResult.current.avgDaysToEnroll}
          format="days"
          icon={Hourglass}
          intent="default"
          subtext={
            kpisResult.comparison
              ? `n=${kpisResult.current.sampleSize} · ${kpisResult.comparison.avgDaysToEnroll}d prior`
              : `n=${kpisResult.current.sampleSize}`
          }
          deltaGoodWhen="down"
          drillSheet={() => (
            <AdmissionsDrillSheet
              target="avg-time"
              ayCode={selectedAy}
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
              initialRows={drillRows}
            />
          )}
        />
      </section>

      <InsightsPanel insights={insights} />

      {/* ───────────────── ANALYTICS ─────────────────
          Trend, distribution, and breakdown charts grouped under one zone.
          Bento row 1: intake velocity (full width). Follow-up is no longer a
          standalone card — the "needs follow-up" insight above deep-links into
          the staleness-filtered applications table instead. */}
      {velocity.current.length > 1 && (
        <Card>
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Applications per day
            </CardDescription>
            <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Intake velocity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart
              label="Applications"
              current={velocity.current}
              comparison={velocity.comparison}
            />
          </CardContent>
        </Card>
      )}

      {/* Bento row 2: pipeline stage (wide, current-state breakdown — the
          glance-level "where is our intake right now") + time-to-enroll
          histogram (narrow). The conversion-funnel cumulative chart was
          dropped because its cumulative-counting interpretation contradicted
          the at-a-glance "current status" purpose; the biggest drop-off
          survives as an `admissionsInsights` narrative below. */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PipelineDrillCard
            data={pipelineStages}
            ayCode={selectedAy}
            drillRows={drillRows}
          />
        </div>
        <div className="lg:col-span-1">
          <TimeToEnrollDrillCard
            data={histogram}
            ayCode={selectedAy}
            drillRows={drillRows}
          />
        </div>
      </section>

      {/* Bento row 3: assessment outcomes (full width — Pipeline graduated to
          row 2's wide slot above). */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-3">
          <AssessmentDrillCard
            data={assessment}
            ayCode={selectedAy}
            drillRows={drillRows}
          />
        </div>
      </section>

      {/* New cards: applications-by-level + document completion */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ApplicationsByLevelCard
          data={appsByLevel}
          ayCode={selectedAy}
          rangeFrom={rangeInput.from}
          rangeTo={rangeInput.to}
          drillRows={drillRows}
        />
        <DocumentCompletionCard
          data={docCompletion}
          ayCode={selectedAy}
          drillRows={drillRows}
        />
      </section>

      {/* Referral (narrow) + browse hub (wide, grid of quick-links) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <ReferralDrillCard
          data={referral}
          ayCode={selectedAy}
          drillRows={drillRows}
        />
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Browse
            </CardDescription>
            <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Jump to a surface
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <QuickLink
                href={`/admissions/applications?ay=${selectedAy}`}
                icon={FileStack}
                title="All applications"
                description="Every application in flight."
              />
              <QuickLink
                href={`/admissions/applications/closed?ay=${selectedAy}`}
                icon={Archive}
                title="Closed applications"
                description="Withdrawn & cancelled archive."
              />
              <QuickLink
                href={`/admissions/document-validation?ay=${selectedAy}`}
                icon={FileCheck}
                title="Document validation"
                description="Review parent uploads waiting on you."
              />
              <QuickLink
                href="/admissions/upcoming/applications"
                icon={CalendarClock}
                title="Upcoming applications"
                description="Early-bird intake for next year."
              />
              <QuickLink
                href={`/admissions/cohorts/stp?ay=${selectedAy}`}
                icon={Plane}
                title="Student Pass cohort"
                description="ICA Student Pass applicants."
              />
              <QuickLink
                href={`/admissions/cohorts/medical?ay=${selectedAy}`}
                icon={Stethoscope}
                title="Medical cohort"
                description="Health & special-needs notes."
              />
              <QuickLink
                href={`/admissions/cohorts/promised?ay=${selectedAy}`}
                icon={Handshake}
                title="Promised documents"
                description="Files parents committed to send."
              />
              <QuickLink
                href={`/admissions/audit-log?ay=${selectedAy}`}
                icon={History}
                title="Audit log"
                description="Recent admissions changes."
              />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ───────────────── SPOTLIGHT ─────────────────
          Pre-course + feedback spotlight cards. */}
      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2">
          <SummaryStat
            label="Pre-course counselling"
            value={
              preCourseStats.completionPct !== null
                ? `${preCourseStats.completionPct}%`
                : '—'
            }
            icon={TrendingUp}
            footnote={`${preCourseStats.complete} of ${preCourseStats.total} funnel applicants completed`}
            href={`/admissions/cohorts/pre-course?ay=${selectedAy}`}
          />
          <SummaryStat
            label="Avg application rating"
            value={
              feedbackResult.stats.avgRating !== null
                ? feedbackResult.stats.avgRating.toFixed(1)
                : '—'
            }
            icon={ChartBar}
            footnote={`out of 5 · ${feedbackResult.stats.ratingCount} response${feedbackResult.stats.ratingCount !== 1 ? 's' : ''}`}
            href={`/admissions/feedback?ay=${selectedAy}`}
          />
        </div>
      </section>

      {/* Footer trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <ChartBar className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>Pre-enrolment only</span>
        <span className="text-border">·</span>
        <span>Refreshes every 10 minutes</span>
      </div>
    </PageShell>
  );
}

function SummaryStat({
  label,
  value,
  icon: Icon,
  footnote,
  href,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  footnote: string;
  href?: string;
}) {
  const card = (
    <Card
      className={`@container/card${href ? ' transition-all hover:-translate-y-0.5 hover:shadow-sm hover:border-brand-indigo/40' : ''}`}
    >
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {typeof value === 'number' ? value.toLocaleString('en-SG') : value}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="text-xs text-muted-foreground">
        {footnote}
      </CardFooter>
    </Card>
  );
  if (href) return <Link href={href}>{card}</Link>;
  return card;
}

function QuickLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-4 rounded-xl border border-hairline bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-sm"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-serif text-base font-semibold text-foreground">
            {title}
          </h3>
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </Link>
  );
}
