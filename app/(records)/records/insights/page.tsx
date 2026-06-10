import {
  ArrowLeft,
  ArrowRightLeft,
  CalendarClock,
  RotateCcw,
  Users,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DonutChart } from '@/components/dashboard/charts/donut-chart';
import { TrendChart } from '@/components/dashboard/charts/trend-chart';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { BuildingHistoryCard } from '@/components/dashboard/insights/building-history-card';
import { InsightsSection } from '@/components/dashboard/insights/insights-section';
import { MetricCard } from '@/components/dashboard/metric-card';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import {
  resolveRange,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import {
  getEnrollmentVelocityRange,
  getWithdrawalVelocityRange,
} from '@/lib/sis/dashboard';
import { getMovementEvents } from '@/lib/sis/movements';
import {
  getRecordsHeadcount,
  getRecordsRetention,
  growthDelta,
  rollupMovements,
} from '@/lib/sis/records-insights';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_ROLES = new Set(['registrar', 'school_admin', 'superadmin']);

const TERM_LABELS: Record<number, string> = {
  1: 'Term 1',
  2: 'Term 2',
  3: 'Term 3',
  4: 'Term 4',
};

// Records · Insights — the population-and-retention companion to the
// operational dashboard. Are we growing, who moves in and out across the
// year, do students come back, and where do late joins and withdrawals
// concentrate. Read-first; all aggregates are derived from the movement
// feed (audit-log) + headcount/retention loaders.
export default async function RecordsInsightsPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!sessionUser.role || !ALLOWED_ROLES.has(sessionUser.role)) {
    notFound();
  }

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
  const ayCodes = await listAyCodes(service);
  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const isCurrentAy = selectedAy === currentAy.ay_code;

  // Prior AY = the code directly below the selected one in the sorted list.
  // listAyCodes returns newest-first, so the prior year is the next index.
  const selectedIndex = ayCodes.indexOf(selectedAy);
  const priorAy =
    selectedIndex >= 0 && selectedIndex + 1 < ayCodes.length
      ? ayCodes[selectedIndex + 1]
      : null;

  const windows = await getDashboardWindows(selectedAy);
  const rangeInput = resolveRange(
    resolvedSearch,
    windows,
    selectedAy,
    undefined,
    { defaultPreset: 'thisMonth' }
  );

  const [
    headcount,
    priorHeadcount,
    retention,
    movementEvents,
    enrollVelocity,
    withdrawalVelocity,
  ] = await Promise.all([
    getRecordsHeadcount(selectedAy),
    priorAy ? getRecordsHeadcount(priorAy) : Promise.resolve(null),
    getRecordsRetention(selectedAy, priorAy),
    getMovementEvents(selectedAy),
    getEnrollmentVelocityRange(rangeInput),
    getWithdrawalVelocityRange(rangeInput),
  ]);

  const priorTotal = priorHeadcount ? priorHeadcount.total : null;
  const growth = growthDelta(headcount.total, priorTotal);

  const rollup = rollupMovements(movementEvents);

  const growthBadge =
    growth.pct === null
      ? { label: 'Building history', tone: 'muted' as const }
      : {
          label:
            growth.pct >= 0
              ? `▲ ${growth.pct}% vs ${priorAy}`
              : `▼ ${Math.abs(growth.pct)}% vs ${priorAy}`,
          tone: (growth.pct >= 0 ? 'mint' : 'amber') as 'mint' | 'amber',
        };

  const maxLevel = headcount.byLevel.reduce((m, l) => Math.max(m, l.count), 0);

  // Donut slices for withdrawal reasons (already humanized by reasonLabel).
  const reasonSlices = rollup.withdrawalsByReason.map((r) => ({
    name: r.reason,
    value: r.count,
  }));

  const haveLate =
    rollup.lateByLevel.length > 0 || rollup.lateByTerm.length > 0;
  const haveWithdrawals = rollup.counts.withdrawn > 0;

  // Velocity overlay: enrollment (current) vs withdrawal (comparison).
  const haveVelocity =
    enrollVelocity.current.length > 1 || withdrawalVelocity.current.length > 1;

  return (
    <PageShell>
      <Link
        href={`/records?ay=${encodeURIComponent(selectedAy)}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Records
      </Link>

      <DashboardHero
        eyebrow="Records · Insights"
        title="Retention & Population"
        description="The shape of the student body — how many are enrolled, who moves in and out across the year, and how steadily the school holds on to its students year over year."
        badges={[
          { label: selectedAy },
          {
            label: isCurrentAy ? 'Current' : 'Historical',
            tone: isCurrentAy ? 'mint' : 'muted',
          },
          growthBadge,
        ]}
      />

      {/* 1 — Growth headline: enrolled this year vs prior AY. */}
      <InsightsSection
        eyebrow="Population"
        title="How big is the school?"
        description={
          growth.pct === null
            ? 'Year-over-year growth unlocks once a prior academic year is on record. Until then, this is the current enrolled headcount.'
            : `Enrolled students this year compared with ${priorAy}.`
        }
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Enrolled students"
            value={headcount.total}
            icon={Users}
            intent="good"
            subtext={
              priorTotal !== null
                ? `${priorTotal.toLocaleString('en-SG')} in ${priorAy}`
                : 'No prior year on record'
            }
          />
          <MetricCard
            label="Levels in use"
            value={headcount.byLevel.length}
            icon={Users}
            intent="default"
            subtext="distinct year levels with students"
          />
          <MetricCard
            label="Withdrawals this year"
            value={rollup.counts.withdrawn}
            icon={UserMinus}
            intent={rollup.counts.withdrawn > 0 ? 'warning' : 'default'}
            subtext="students who left mid-year"
          />
        </section>
      </InsightsSection>

      {/* 2 — Student population by level. */}
      <InsightsSection
        eyebrow="Distribution"
        title="Where are the students?"
        description={
          priorTotal !== null
            ? `Enrolled headcount per level. ${headcount.total.toLocaleString('en-SG')} this year vs ${priorTotal.toLocaleString('en-SG')} in ${priorAy}.`
            : 'Enrolled headcount per level for the selected year.'
        }
      >
        {headcount.byLevel.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No enrolled students recorded for this year yet.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Enrolled per level
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                Student population
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {headcount.byLevel.map((lvl) => {
                  const widthPct =
                    maxLevel > 0
                      ? Math.max(4, Math.round((lvl.count / maxLevel) * 100))
                      : 0;
                  return (
                    <li key={lvl.level} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium text-foreground">
                          {lvl.level}
                        </span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {lvl.count.toLocaleString('en-SG')}
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand-indigo to-brand-navy"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </InsightsSection>

      {/* 3 — Student movement: 4 tiles + velocity overlay. */}
      <InsightsSection
        eyebrow="Movement"
        title="Who moves in and out?"
        description="Enrolment movements recorded across the year — and the daily rhythm of joins against departures over the selected period."
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Withdrawals"
            value={rollup.counts.withdrawn}
            icon={UserMinus}
            intent={rollup.counts.withdrawn > 0 ? 'warning' : 'default'}
            subtext="left during the year"
          />
          <MetricCard
            label="Late enrollees"
            value={rollup.counts.lateEnrolled}
            icon={CalendarClock}
            intent="default"
            subtext="joined after the year began"
          />
          <MetricCard
            label="Transfers"
            value={rollup.counts.transferred}
            icon={ArrowRightLeft}
            intent="default"
            subtext="moved between sections"
          />
          <MetricCard
            label="Re-enrollees"
            value={rollup.counts.reEnrolled}
            icon={RotateCcw}
            intent="default"
            subtext="returned after leaving"
          />
        </section>

        {haveVelocity ? (
          <Card>
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Joins vs departures per day
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                Movement velocity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart
                label="Enrolments"
                current={enrollVelocity.current}
                comparison={withdrawalVelocity.current}
                alignComparison
              />
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Not enough movement in this period to plot a trend yet.
            </CardContent>
          </Card>
        )}
      </InsightsSection>

      {/* 4 — Retention: did last year's students come back? */}
      <InsightsSection
        eyebrow="Retention"
        title="Do students come back?"
        description={
          priorAy === null
            ? 'Retention compares this year against the one before it.'
            : `Of the students enrolled in ${priorAy}, how many returned this year.`
        }
      >
        {priorAy === null ? (
          <BuildingHistoryCard
            label="Retention"
            detail="Once a prior academic year is on record, this will show how many of last year's students returned — the clearest single measure of how well the school holds on to families. It fills in automatically each year."
          />
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              label="Returned"
              value={retention.returned}
              icon={UserPlus}
              intent="good"
              subtext={`of ${retention.priorTotal.toLocaleString('en-SG')} from ${priorAy}`}
            />
            <MetricCard
              label="Did not return"
              value={retention.didNotReturn}
              icon={UserMinus}
              intent={retention.didNotReturn > 0 ? 'warning' : 'default'}
              subtext={`enrolled in ${priorAy}, not this year`}
            />
            <MetricCard
              label="Retention rate"
              value={retention.pct ?? 0}
              format="percent"
              icon={RotateCcw}
              intent="default"
              subtext={
                retention.priorTotal > 0
                  ? `returned year over year`
                  : 'no prior cohort to measure'
              }
            />
          </section>
        )}
      </InsightsSection>

      {/* 5 — Late enrollees by level + term. */}
      <InsightsSection
        eyebrow="Late joins"
        title="Where do late enrollees land?"
        description="Students who joined after the year began, by level and by the term they joined in."
      >
        {!haveLate ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No late enrollees recorded this year — every student started on
              time.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Late enrollees per level
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  By level
                </CardTitle>
              </CardHeader>
              <CardContent>
                {rollup.lateByLevel.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No level breakdown available.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {(() => {
                      const maxLate = rollup.lateByLevel.reduce(
                        (m, l) => Math.max(m, l.count),
                        0
                      );
                      return rollup.lateByLevel.map((lvl) => {
                        const widthPct =
                          maxLate > 0
                            ? Math.max(
                                4,
                                Math.round((lvl.count / maxLate) * 100)
                              )
                            : 0;
                        return (
                          <li key={lvl.level} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="font-medium text-foreground">
                                {lvl.level}
                              </span>
                              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                {lvl.count.toLocaleString('en-SG')}
                              </span>
                            </div>
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-brand-amber to-brand-sky"
                                style={{ width: `${widthPct}%` }}
                              />
                            </div>
                          </li>
                        );
                      });
                    })()}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  When they joined
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  By term
                </CardTitle>
              </CardHeader>
              <CardContent>
                {rollup.lateByTerm.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No term breakdown available.
                  </p>
                ) : (
                  <ul className="divide-y divide-hairline">
                    {rollup.lateByTerm.map((t) => (
                      <li
                        key={t.termNumber}
                        className="flex items-baseline justify-between gap-3 py-2.5 text-sm"
                      >
                        <span className="font-medium text-foreground">
                          {TERM_LABELS[t.termNumber] ?? `Term ${t.termNumber}`}
                        </span>
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          {t.count.toLocaleString('en-SG')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </InsightsSection>

      {/* 6 — Withdrawal analysis: reason donut + level bar. */}
      <InsightsSection
        eyebrow="Attrition"
        title="Why do students leave?"
        description="Reasons recorded when a student is withdrawn mid-year, overall and per level."
      >
        {!haveWithdrawals ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No withdrawals recorded this year — nothing to break down.
              That&rsquo;s a good sign.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Withdrawal reasons
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  Overall
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DonutChart
                  data={reasonSlices}
                  centerLabel="Withdrawn"
                  centerValue={rollup.counts.withdrawn}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Withdrawals per level
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  By level
                </CardTitle>
              </CardHeader>
              <CardContent>
                {rollup.withdrawalsByLevel.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No level breakdown available.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {(() => {
                      const maxW = rollup.withdrawalsByLevel.reduce(
                        (m, l) => Math.max(m, l.count),
                        0
                      );
                      return rollup.withdrawalsByLevel.map((lvl) => {
                        const widthPct =
                          maxW > 0
                            ? Math.max(4, Math.round((lvl.count / maxW) * 100))
                            : 0;
                        return (
                          <li key={lvl.level} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="font-medium text-foreground">
                                {lvl.level}
                              </span>
                              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                {lvl.count.toLocaleString('en-SG')}
                              </span>
                            </div>
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-destructive to-brand-amber"
                                style={{ width: `${widthPct}%` }}
                              />
                            </div>
                          </li>
                        );
                      });
                    })()}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </InsightsSection>

      {/* Footer trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Users className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>Retention &amp; population</span>
        <span className="text-border">·</span>
        <span>Refreshes every minute</span>
      </div>
    </PageShell>
  );
}
