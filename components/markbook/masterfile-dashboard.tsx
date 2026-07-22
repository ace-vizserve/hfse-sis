'use client';

import {
  ArrowUpRight,
  Award,
  BookOpenCheck,
  CalendarCheck2,
  GraduationCap,
  Lock,
  MessageSquareText,
  Users,
  UserCheck,
  UserMinus,
  Timer,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ActionList,
  type ActionItem,
} from '@/components/dashboard/action-list';
import {
  ComparisonBarChart,
  type ComparisonBarPoint,
} from '@/components/dashboard/charts/comparison-bar-chart';
import { DonutChart } from '@/components/dashboard/charts/donut-chart';
import {
  MetricCard,
  type MetricIntent,
} from '@/components/dashboard/metric-card';
import {
  computeMasterfileDashboard,
  commentTermsInScope,
  enrolledScopeRows,
  studentMissingCommentTerms,
  type AwardTier,
  type GaBandTier,
  type MasterfileDashboardFilters,
  type MasterfileReadiness,
  type ReadinessMetric,
} from '@/lib/markbook/masterfile-dashboard';
import type { MasterfileDrillTarget } from '@/lib/markbook/masterfile-drill';
import { MasterfileDrillSheet } from '@/components/markbook/masterfile-drill-sheet';
import type { MasterfilePayload } from '@/lib/markbook/masterfile';
import { cn } from '@/lib/utils';

// Masterfile narrative dashboard (KD #95). A tracking view, not a readiness
// gate: Overview (who's here) → At a glance (readiness strip) → Academic
// Performance (outcomes) → Quick Links (child views) → Worth a look.
// Computed client-side from the full payload so the Term / Subject / Status
// filters refine every section without a server round-trip. The Excel export
// stays the exact masterfile sheet (handled on the toolbar).

const DONUT_COLORS = [
  'var(--color-brand-amber)', // Gold
  'var(--color-ink-4)', // Silver
  'var(--color-brand-bronze)', // Bronze
  'var(--color-muted-foreground)', // Not eligible
];

// Award-band colors for the GA-spread bar (gold→below).
const GA_COLORS = [
  'var(--color-brand-amber)',
  'var(--color-ink-4)',
  'var(--color-brand-bronze)',
  'var(--color-muted-foreground)',
];

export function MasterfileDashboard({
  payload,
  filters,
  scopeQuery = '',
}: {
  payload: MasterfilePayload;
  filters: MasterfileDashboardFilters;
  scopeQuery?: string;
}) {
  const d = useMemo(
    () => computeMasterfileDashboard(payload, filters),
    [payload, filters]
  );

  // Derive missing-comments count for the Overview card (enrolled scope,
  // same logic as computeNeedsData so count == drill).
  const missingCommentsCount = useMemo(() => {
    const commentTerms = commentTermsInScope(payload, filters.termNumber);
    if (commentTerms.length === 0) return 0;
    const enrolled = enrolledScopeRows(payload, filters);
    let total = 0;
    for (const r of enrolled) {
      total += studentMissingCommentTerms(r, commentTerms).length;
    }
    return total;
  }, [payload, filters]);

  // One piece of drill state for the whole dashboard. null = sheet closed.
  const [target, setTarget] = useState<MasterfileDrillTarget | null>(null);

  // Per-term late-enrollee subtext for the Overview card.
  const lateSubtext = useMemo(() => {
    const { lateEnrollee, lateByTerm, lateUnresolved } = d.overview;
    if (lateEnrollee === 0) return 'None this scope';
    const termParts = lateByTerm.map((b) => `T${b.termNumber}: ${b.count}`);
    const parts: string[] = [...termParts];
    if (lateUnresolved > 0) parts.push(`+${lateUnresolved} unresolved`);
    return parts.join(' · ');
  }, [d.overview]);

  return (
    <div className="flex flex-col gap-10">
      {/* ── Overview — who's here ─────────────────────────────────────── */}
      <section className="space-y-4">
        <ActHeader
          eyebrow="Overview"
          title="Where things stand"
          subtitle="A live snapshot of this cohort — enrolment status, late arrivals, and the two operational readiness signals most likely to need your attention."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {/* Row 1: Enrolment counts */}
          <MetricCard
            label="Total students"
            value={d.overview.total}
            format="number"
            icon={Users}
            intent="default"
            subtext="All statuses in this scope"
          />
          <MetricCard
            label="Active"
            value={d.overview.active}
            format="number"
            icon={UserCheck}
            intent={d.overview.active > 0 ? 'good' : 'default'}
            subtext="Currently enrolled and active"
          />
          <MetricCard
            label="Withdrawn"
            value={d.overview.withdrawn}
            format="number"
            icon={UserMinus}
            intent="default"
            subtext="Withdrawn this academic year"
          />

          {/* Late Enrollees — with per-term breakdown subtext */}
          <MetricCard
            label="Late enrolees"
            value={d.overview.lateEnrollee}
            format="number"
            icon={Timer}
            intent="default"
            subtext={lateSubtext}
          />

          {/* Missing FCA Comments — drillable (reuses missing-comments target) */}
          <DrillButton
            onClick={() => setTarget({ kind: 'missing-comments' })}
            label="Missing FCA comments — show students without an adviser write-up"
          >
            <MetricCard
              label="Missing FCA comments"
              value={
                missingCommentsCount === 0 ? 'All in' : missingCommentsCount
              }
              format={missingCommentsCount === 0 ? 'raw' : 'number'}
              icon={MessageSquareText}
              intent={missingCommentsCount === 0 ? 'good' : 'default'}
              subtext={
                missingCommentsCount === 0
                  ? 'All write-ups present'
                  : 'Students with no write-up text yet (drafts count as written)'
              }
            />
          </DrillButton>

          {/* Full Results (incomplete-results drill) — moved from At a glance */}
          <GradableCard
            readiness={d.readiness}
            onDrill={() => setTarget({ kind: 'incomplete-results' })}
          />
        </div>
      </section>

      {/* ── At a glance — readiness strip ────────────────────────────── */}
      <section className="space-y-4">
        <ActHeader
          eyebrow="At a glance"
          title="Readiness snapshot"
          subtitle="Grades entered, grading sheets locked and attendance recorded — a quick read on how complete the records are for this scope."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ReadinessCard
            label="Grades recorded"
            icon={BookOpenCheck}
            metric={d.readiness.gradesEntered}
            onDrill={() => setTarget({ kind: 'missing-grades' })}
            drillHint="See students with missing grades"
          />
          {/* Sheet-centric, not student-centric — intentionally not drillable. */}
          <ReadinessCard
            label="Sheets locked"
            icon={Lock}
            metric={d.readiness.sheetsLocked}
          />
          <ReadinessCard
            label="Attendance logged"
            icon={CalendarCheck2}
            metric={d.readiness.attendanceRecorded}
          />
        </div>
      </section>

      {/* ── Academic Performance — outcomes ───────────────────────────── */}
      <section className="space-y-4">
        <ActHeader
          eyebrow="Academic Performance"
          title="How they're doing"
          subtitle="Award distribution, General Average spread, subject performance and attendance. Students without complete data show as pending, not awarded."
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AwardDistributionCard
            dashboard={d}
            onDrillTier={(tier) => setTarget({ kind: 'award', tier })}
          />
          <GaSpreadCard
            dashboard={d}
            onDrillBand={(tier) => setTarget({ kind: 'ga-band', tier })}
          />
          <SubjectPerformanceCard dashboard={d} />
          <AttendanceHealthCard dashboard={d} />
        </div>
      </section>

      {/* ── Quick Links — child routes ────────────────────────────────── */}
      <section className="space-y-4">
        <ActHeader
          eyebrow="Quick Links"
          title="Go deeper"
          subtitle="Jump to a focused view — awards, attendance records, or adviser comments — scoped to the same level and class."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <QuickLinkCard
            eyebrow="Awards"
            title="Academic Awards"
            description="Subject and Overall Academic Award recipients. Gold, Silver, and Bronze tiers."
            href={`/markbook/awards${scopeQuery}`}
            icon={Award}
          />
          <QuickLinkCard
            eyebrow="Attendance"
            title="Attendance Records"
            description="Per-term attendance totals, rates and rollups for this cohort."
            href={`/attendance/summary${scopeQuery}`}
            icon={CalendarCheck2}
          />
          <QuickLinkCard
            eyebrow="Comments"
            title="Adviser Comments"
            description="FCA write-up completion by term — see who's submitted and who still needs to."
            href={`/evaluation/comments${scopeQuery}`}
            icon={MessageSquareText}
          />
        </div>
      </section>

      {/* ── Worth a look ──────────────────────────────────────────────── */}
      <section className="space-y-4">
        <ActHeader
          eyebrow="Worth a look"
          title="Where to point your eyes"
          subtitle="Two quick lists — what's still coming in, and students whose results stand out — so you know where to look next."
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <NeedsDataCard
            dashboard={d}
            onDrillGroup={(groupKey) =>
              setTarget({ kind: 'needs-data', groupKey })
            }
          />
          <NeedsAttentionCard dashboard={d} />
        </div>
      </section>

      <MasterfileDrillSheet
        payload={payload}
        filters={filters}
        target={target}
        open={target != null}
        onOpenChange={(o) => {
          if (!o) setTarget(null);
        }}
      />
    </div>
  );
}

// Accessible wrapper that turns a non-interactive card into a drill trigger.
// The child MetricCard renders a <Card> (a div), so we wrap it in a real
// <button> for keyboard + screen-reader support (design-system §1/§2).
function DrillButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="group block w-full cursor-pointer rounded-xl text-left transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.99] [&>*]:transition-shadow [&>*]:hover:shadow-md"
    >
      {children}
    </button>
  );
}

// ---------- Act headers ----------

function ActHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {eyebrow}
      </p>
      <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {subtitle}
      </p>
    </div>
  );
}

// ---------- Quick link card (§8 interactive quick-link card pattern) ----------

function QuickLinkCard({
  eyebrow,
  title,
  description,
  href,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="@container/card group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-4 text-sm">
        <p className="leading-relaxed text-muted-foreground">{description}</p>
        <Button asChild size="sm">
          <Link href={href}>
            View
            <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------- Readiness cards ----------

// Snapshot, not a verdict: a full count reads as a quiet positive, everything
// else stays neutral (no amber/red "you're behind" signal — this is tracking).
function readinessIntent(metric: ReadinessMetric): MetricIntent {
  if (metric.pct != null && metric.pct >= 100) return 'good';
  return 'default';
}

function ReadinessCard({
  label,
  icon,
  metric,
  onDrill,
  drillHint,
}: {
  label: string;
  icon: React.ComponentProps<typeof MetricCard>['icon'];
  metric: ReadinessMetric;
  onDrill?: () => void;
  drillHint?: string;
}) {
  const value =
    metric.expected === 0 ? 'Pending' : `${metric.done}/${metric.expected}`;
  const subtext =
    metric.pct == null
      ? 'Nothing in this scope yet'
      : `${metric.pct.toFixed(0)}% so far`;
  const card = (
    <MetricCard
      label={label}
      value={value}
      format="raw"
      icon={icon}
      intent={readinessIntent(metric)}
      subtext={subtext}
    />
  );
  if (!onDrill) return card;
  return (
    <DrillButton
      onClick={onDrill}
      label={drillHint ?? `${label} — show details`}
    >
      {card}
    </DrillButton>
  );
}

function GradableCard({
  readiness,
  onDrill,
}: {
  readiness: MasterfileReadiness;
  onDrill?: () => void;
}) {
  // When no examinable subjects are in scope (e.g. Subject = Music), the
  // gradable metric doesn't apply — show "Pending" with a clarifying subtext
  // instead of a misleading "0 / N" deficit.
  const notApplicable =
    readiness.gradableApplicable === false || readiness.rosterCount === 0;
  const value = notApplicable
    ? 'Pending'
    : `${readiness.gradableCount}/${readiness.rosterCount}`;
  const intent: MetricIntent =
    !notApplicable && readiness.gradableCount === readiness.rosterCount
      ? 'good'
      : 'default';
  const subtext =
    readiness.gradableApplicable === false
      ? 'No examinable subjects in scope'
      : 'Have complete results so far';
  const card = (
    <MetricCard
      label="Full results"
      value={value}
      format="raw"
      icon={GraduationCap}
      intent={intent}
      subtext={subtext}
    />
  );
  // Drilling only makes sense when there's an examinable roster to be short of.
  if (!onDrill || notApplicable) return card;
  return (
    <DrillButton
      onClick={onDrill}
      label="Full results — see students without complete results"
    >
      {card}
    </DrillButton>
  );
}

// ---------- Academic Performance cards ----------

function ChartCard({
  eyebrow,
  title,
  icon: Icon,
  children,
}: {
  eyebrow: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function PendingState({ label }: { label: string }) {
  return (
    <div className="flex h-[200px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted/20 text-center">
      <p className="text-sm font-medium text-foreground">Pending</p>
      <p className="max-w-[18rem] text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

const AWARD_LEGEND: { tier: AwardTier; label: string }[] = [
  { tier: 'gold', label: 'Gold' },
  { tier: 'silver', label: 'Silver' },
  { tier: 'bronze', label: 'Bronze' },
  { tier: 'notEligible', label: 'Not eligible' },
];

function AwardDistributionCard({
  dashboard,
  onDrillTier,
}: {
  dashboard: ReturnType<typeof computeMasterfileDashboard>;
  onDrillTier: (tier: AwardTier) => void;
}) {
  const t = dashboard.outcomes.awardTierCounts;
  const total = t.gold + t.silver + t.bronze + t.notEligible;
  const countByTier: Record<AwardTier, number> = {
    gold: t.gold,
    silver: t.silver,
    bronze: t.bronze,
    notEligible: t.notEligible,
  };
  const data = [
    { name: 'Gold', value: t.gold },
    { name: 'Silver', value: t.silver },
    { name: 'Bronze', value: t.bronze },
    { name: 'Not eligible', value: t.notEligible },
  ];
  return (
    <ChartCard eyebrow="Outcomes" title="Overall Academic Award" icon={Award}>
      {total === 0 ? (
        <PendingState label="No students in this scope yet." />
      ) : (
        <>
          <DonutChart
            data={data}
            colors={DONUT_COLORS}
            centerValue={total}
            centerLabel="Students"
          />
          {/* Clickable legend — accessible alternative to chart-segment
              clicks; one drill chip per award tier. */}
          <ul className="mt-3 flex flex-wrap gap-2">
            {AWARD_LEGEND.map(({ tier, label }, i) => (
              <li key={tier}>
                <LegendChip
                  color={DONUT_COLORS[i % DONUT_COLORS.length]}
                  label={label}
                  count={countByTier[tier]}
                  onClick={() => onDrillTier(tier)}
                  ariaLabel={`${label}: ${countByTier[tier]} students — show list`}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </ChartCard>
  );
}

// Small clickable legend chip used by the Award + GA-band cards.
function LegendChip({
  color,
  label,
  count,
  onClick,
  ariaLabel,
}: {
  color: string;
  label: string;
  count?: number;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-hairline-strong hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
      {count != null && (
        <span className="tabular-nums text-foreground">{count}</span>
      )}
    </button>
  );
}

function GaSpreadCard({
  dashboard,
  onDrillBand,
}: {
  dashboard: ReturnType<typeof computeMasterfileDashboard>;
  onDrillBand: (tier: GaBandTier) => void;
}) {
  const buckets = dashboard.outcomes.gaBuckets;
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const data: ComparisonBarPoint[] = buckets.map((b) => ({
    category: b.label,
    current: b.count,
  }));
  return (
    <ChartCard
      eyebrow="Outcomes"
      title="General Average spread"
      icon={GraduationCap}
    >
      {total === 0 ? (
        <PendingState label="No complete General Averages to band yet — grades are still pending." />
      ) : (
        <ComparisonBarChart
          data={data}
          orientation="horizontal"
          yFormat="number"
          height={220}
        />
      )}
      <BandFootnote
        colors={GA_COLORS}
        buckets={buckets}
        onDrillBand={onDrillBand}
      />
    </ChartCard>
  );
}

function BandFootnote({
  colors,
  buckets,
  onDrillBand,
}: {
  colors: string[];
  buckets: ReturnType<
    typeof computeMasterfileDashboard
  >['outcomes']['gaBuckets'];
  onDrillBand: (tier: GaBandTier) => void;
}) {
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {buckets.map((b, i) => (
        <li key={b.tier}>
          <LegendChip
            color={colors[i % colors.length]}
            label={b.label}
            count={b.count}
            onClick={() => onDrillBand(b.tier)}
            ariaLabel={`${b.label}: ${b.count} students — show list`}
          />
        </li>
      ))}
    </ul>
  );
}

function SubjectPerformanceCard({
  dashboard,
}: {
  dashboard: ReturnType<typeof computeMasterfileDashboard>;
}) {
  // Examinable subjects with at least one graded cell, ascending so lagging
  // subjects surface at the top of the horizontal bar.
  const rows = dashboard.outcomes.subjectAverages
    .filter((s) => s.isExaminable && s.avg != null)
    .sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0));
  const data: ComparisonBarPoint[] = rows.map((s) => ({
    category: s.subjectName,
    current: s.avg ?? 0,
  }));
  return (
    <ChartCard
      eyebrow="Outcomes"
      title="Subject performance"
      icon={BookOpenCheck}
    >
      {data.length === 0 ? (
        <PendingState label="No examinable subject grades entered for this scope yet." />
      ) : (
        <ComparisonBarChart
          data={data}
          orientation="horizontal"
          yFormat="number"
          height={Math.max(160, data.length * 36)}
        />
      )}
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        Class average of examinable quarterly grades · lowest first
      </p>
    </ChartCard>
  );
}

function AttendanceHealthCard({
  dashboard,
}: {
  dashboard: ReturnType<typeof computeMasterfileDashboard>;
}) {
  const a = dashboard.outcomes.attendance;
  return (
    <ChartCard
      eyebrow="Outcomes"
      title="Attendance health"
      icon={CalendarCheck2}
    >
      {a.schoolDays === 0 ? (
        <PendingState label="No attendance rollups recorded for this scope yet." />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <RateStat label="Present" value={a.presentRate} tone="good" />
            <RateStat label="Late" value={a.lateRate} tone="warn" />
            <RateStat label="Absent" value={a.absentRate} tone="bad" />
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted">
            <span
              className="bg-brand-mint"
              style={{ width: `${a.presentRate ?? 0}%` }}
            />
            <span
              className="bg-destructive"
              style={{ width: `${a.absentRate ?? 0}%` }}
            />
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            {a.present.toLocaleString('en-SG')} present ·{' '}
            {a.late.toLocaleString('en-SG')} late ·{' '}
            {a.absent.toLocaleString('en-SG')} absent of{' '}
            {a.schoolDays.toLocaleString('en-SG')} student-days
          </p>
        </div>
      )}
    </ChartCard>
  );
}

function RateStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: 'good' | 'warn' | 'bad';
}) {
  const dotClass =
    tone === 'good'
      ? 'bg-brand-mint'
      : tone === 'warn'
        ? 'bg-brand-amber'
        : 'bg-destructive';
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span className={cn('size-2 rounded-full', dotClass)} />
        {label}
      </p>
      <p className="mt-1 font-serif text-2xl font-semibold tabular-nums text-foreground">
        {value == null ? '—' : `${value.toFixed(1)}%`}
      </p>
    </div>
  );
}

// ---------- Worth a look cards ----------

// The "Still coming in" count is in cells / comments / sheets depending on the
// group; label it so it reads in its own unit (the drill opens to students).
function needsDataMetaLabel(groupKey: string, count: number): string {
  const plural = (singular: string) =>
    count === 1 ? singular : `${singular}s`;
  if (groupKey.startsWith('missing-grades:')) return plural('cell');
  if (groupKey.startsWith('unlocked-sheets:')) return plural('sheet');
  if (groupKey === 'missing-comments') return plural('comment');
  return '';
}

function NeedsDataCard({
  dashboard,
  onDrillGroup,
}: {
  dashboard: ReturnType<typeof computeMasterfileDashboard>;
  onDrillGroup: (groupKey: string) => void;
}) {
  const items: ActionItem[] = dashboard.watchlists.needsData.map((i) => ({
    label: i.group,
    sublabel: i.detail,
    meta: String(i.count),
    // Self-label the count in its own unit — the drill opens to a student count
    // (or sheet count), so a bare number on this row would look contradictory.
    metaLabel: needsDataMetaLabel(i.groupKey, i.count),
    severity:
      i.severity === 'bad' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info',
    onClick: () => onDrillGroup(i.groupKey),
  }));
  return (
    <ActionList
      title="Still coming in"
      description="Grades, locks and adviser comments not in yet — grouped by class / subject so you can see what's outstanding."
      items={items}
      emptyLabel="Everything in this scope is in."
    />
  );
}

function NeedsAttentionCard({
  dashboard,
}: {
  dashboard: ReturnType<typeof computeMasterfileDashboard>;
}) {
  const items: ActionItem[] = dashboard.watchlists.needsAttention.map((i) => ({
    label: i.studentName,
    sublabel: i.reason,
    severity: i.severity,
    href: `/records/students/${encodeURIComponent(i.studentNumber)}`,
  }));
  return (
    <ActionList
      title="Standing out"
      description="Students with a low General Average, an at-risk subject grade, or low attendance — open their record for the full picture."
      items={items}
      emptyLabel="Nobody stands out in this scope right now."
    />
  );
}
