'use client';

import {
  Award,
  BookOpenCheck,
  CalendarCheck2,
  GraduationCap,
  Lock,
  MessageSquareText,
} from 'lucide-react';
import { useMemo } from 'react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  type MasterfileDashboardFilters,
  type MasterfileReadiness,
  type ReadinessMetric,
} from '@/lib/markbook/masterfile-dashboard';
import type { MasterfilePayload } from '@/lib/markbook/masterfile';
import { cn } from '@/lib/utils';

// Masterfile narrative dashboard (KD #95). Three acts — Readiness → Outcomes →
// Watchlists — computed client-side from the full payload so the Term / Subject
// / Status filters refine every section without a server round-trip. The Excel
// export stays the exact masterfile sheet (handled on the toolbar).

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
}: {
  payload: MasterfilePayload;
  filters: MasterfileDashboardFilters;
}) {
  const d = useMemo(
    () => computeMasterfileDashboard(payload, filters),
    [payload, filters]
  );

  return (
    <div className="flex flex-col gap-10">
      {/* ── Act 1 — Readiness ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <ActHeader
          eyebrow="Act 1 · Compilation status"
          title="How ready is this masterfile?"
          subtitle="Filled grades, locked sheets, adviser comments and attendance for the selected scope. Incomplete work shows honestly — never a fake total."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <ReadinessCard
            label="Grades entered"
            icon={BookOpenCheck}
            metric={d.readiness.gradesEntered}
          />
          <ReadinessCard
            label="Sheets locked"
            icon={Lock}
            metric={d.readiness.sheetsLocked}
          />
          <ReadinessCard
            label="Comments written"
            icon={MessageSquareText}
            metric={d.readiness.commentsWritten}
          />
          <ReadinessCard
            label="Attendance recorded"
            icon={CalendarCheck2}
            metric={d.readiness.attendanceRecorded}
          />
          <GradableCard readiness={d.readiness} />
        </div>
      </section>

      {/* ── Act 2 — Outcomes ──────────────────────────────────────────── */}
      <section className="space-y-4">
        <ActHeader
          eyebrow="Act 2 · What the data says"
          title="Outcomes for the cohort"
          subtitle="Award distribution, General Average spread, subject performance and attendance health. Students without complete data are counted as pending, not awarded."
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AwardDistributionCard dashboard={d} />
          <GaSpreadCard dashboard={d} />
          <SubjectPerformanceCard dashboard={d} />
          <AttendanceHealthCard dashboard={d} />
        </div>
      </section>

      {/* ── Act 3 — Watchlists ────────────────────────────────────────── */}
      <section className="space-y-4">
        <ActHeader
          eyebrow="Act 3 · Follow-up"
          title="What needs a hand"
          subtitle="Two lists: data still to be entered or locked (chase), and students whose results warrant a closer look."
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <NeedsDataCard dashboard={d} />
          <NeedsAttentionCard dashboard={d} />
        </div>
      </section>
    </div>
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

// ---------- Act 1 cards ----------

function readinessIntent(metric: ReadinessMetric): MetricIntent {
  if (metric.pct == null) return 'default';
  if (metric.pct >= 100) return 'good';
  if (metric.pct >= 60) return 'warning';
  return 'bad';
}

function ReadinessCard({
  label,
  icon,
  metric,
}: {
  label: string;
  icon: React.ComponentProps<typeof MetricCard>['icon'];
  metric: ReadinessMetric;
}) {
  const value =
    metric.expected === 0 ? 'Pending' : `${metric.done}/${metric.expected}`;
  const subtext =
    metric.pct == null
      ? 'Nothing expected in this scope yet'
      : `${metric.pct.toFixed(0)}% complete`;
  return (
    <MetricCard
      label={label}
      value={value}
      format="raw"
      icon={icon}
      intent={readinessIntent(metric)}
      subtext={subtext}
    />
  );
}

function GradableCard({ readiness }: { readiness: MasterfileReadiness }) {
  // When no examinable subjects are in scope (e.g. Subject = Music), the
  // gradable metric doesn't apply — show "Pending" with a clarifying subtext
  // instead of a misleading "0 / N" deficit.
  const notApplicable =
    readiness.gradableApplicable === false || readiness.rosterCount === 0;
  const value = notApplicable
    ? 'Pending'
    : `${readiness.gradableCount}/${readiness.rosterCount}`;
  const intent: MetricIntent = notApplicable
    ? 'default'
    : readiness.gradableCount === readiness.rosterCount
      ? 'good'
      : 'warning';
  const subtext =
    readiness.gradableApplicable === false
      ? 'No examinable subjects in scope'
      : 'Complete examinable data for an award / General Average';
  return (
    <MetricCard
      label="Gradable students"
      value={value}
      format="raw"
      icon={GraduationCap}
      intent={intent}
      subtext={subtext}
    />
  );
}

// ---------- Act 2 cards ----------

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

function AwardDistributionCard({
  dashboard,
}: {
  dashboard: ReturnType<typeof computeMasterfileDashboard>;
}) {
  const t = dashboard.outcomes.awardTierCounts;
  const total = t.gold + t.silver + t.bronze + t.notEligible;
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
        <DonutChart
          data={data}
          colors={DONUT_COLORS}
          centerValue={total}
          centerLabel="Students"
        />
      )}
    </ChartCard>
  );
}

function GaSpreadCard({
  dashboard,
}: {
  dashboard: ReturnType<typeof computeMasterfileDashboard>;
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
      <BandFootnote colors={GA_COLORS} buckets={buckets} />
    </ChartCard>
  );
}

function BandFootnote({
  colors,
  buckets,
}: {
  colors: string[];
  buckets: ReturnType<
    typeof computeMasterfileDashboard
  >['outcomes']['gaBuckets'];
}) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {buckets.map((b, i) => (
        <li
          key={b.tier}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground"
        >
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: colors[i % colors.length] }}
          />
          {b.label}
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

// ---------- Act 3 cards ----------

function NeedsDataCard({
  dashboard,
}: {
  dashboard: ReturnType<typeof computeMasterfileDashboard>;
}) {
  const items: ActionItem[] = dashboard.watchlists.needsData.map((i) => ({
    label: i.group,
    sublabel: i.detail,
    meta: String(i.count),
    severity:
      i.severity === 'bad' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info',
  }));
  return (
    <ActionList
      title="Needs data"
      description="Grades to enter, sheets to lock, and adviser comments still blank — grouped so the chase is per class / subject."
      items={items}
      emptyLabel="Everything in this scope is entered and locked."
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
      title="Needs attention"
      description="Students with a low General Average, an at-risk subject grade, or low attendance — open their permanent record to follow up."
      items={items}
      emptyLabel="No students are flagged for follow-up in this scope."
    />
  );
}
