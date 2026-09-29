'use client';

import { GraduationCap } from 'lucide-react';
import * as React from 'react';

import { AdmissionsDrillSheet } from '@/components/admissions/drills/admissions-drill-sheet';
import { FeedbackRatingDrillSheet } from '@/components/admissions/drills/feedback-rating-drill-sheet';
import {
  ComparisonBarChart,
  type ComparisonBarPoint,
} from '@/components/dashboard/charts/comparison-bar-chart';
import {
  DonutChart,
  type DonutSlice,
} from '@/components/dashboard/charts/donut-chart';
import {
  GroupedBarChart,
  type GroupedBarChartProps,
  type GroupedBarSeries,
} from '@/components/dashboard/charts/grouped-bar-chart';
import {
  TrendChart,
  type TrendPoint,
} from '@/components/dashboard/charts/trend-chart';
import { NationalityByLevelBars } from '@/components/dashboard/insights/nationality-by-level-bars';
import { NationalityMixPie } from '@/components/dashboard/insights/nationality-mix-pie';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import type { DrillTarget } from '@/lib/admissions/drill';
import type { ReasonBar } from '@/lib/admissions/insights';
import {
  assessmentSegment,
  INSIGHTS_SCOPE_LABEL,
  levelReasonsSegment,
  nationalitySegment,
  ratingSegmentFromCategory,
  reasonSegmentForSlice,
  referralSegmentForSlice,
  resolveSeriesAy,
} from '@/lib/admissions/insights-drill-segments';
import type {
  NationalityByLevel,
  NationalityMixRow,
  ReferralConversionRow,
} from '@/lib/admissions/insights-funnel';

// Admissions Insights (KD #229): each wrapper holds the clicked segment and
// opens the Admissions drill sheet for it. One 'use client' module so the
// Server Component page passes data only — never a function (Next 16 rejects
// functions across the boundary, and only at render time).
//
// No `initialRows`: a comparison-year click would paint the selected year's
// broad rows under the other year's title while it fetched. These open on the
// skeleton instead.

type DrillPick = { ayCode: string; segment: string | null };

function useDrillPick() {
  const [pick, setPick] = React.useState<DrillPick | null>(null);
  const onOpenChange = React.useCallback((open: boolean) => {
    if (!open) setPick(null);
  }, []);
  return { pick, setPick, onOpenChange };
}

function InsightsDrill({
  target,
  pick,
}: {
  target: DrillTarget;
  pick: DrillPick | null;
}) {
  if (!pick) return null;
  return (
    <AdmissionsDrillSheet
      target={target}
      segment={pick.segment}
      ayCode={pick.ayCode}
      scopeLabel={INSIGHTS_SCOPE_LABEL}
    />
  );
}

// ─── Applications per month ─────────────────────────────────────────────────

export function IntakeTrendDrillChart({
  label,
  current,
  comparison,
  selectedAy,
  compareAy,
}: {
  label: string;
  current: TrendPoint[];
  comparison: TrendPoint[] | null;
  selectedAy: string;
  compareAy: string | null;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  const handleClick = React.useCallback(
    (x: string, series?: string) => {
      const ayCode = resolveSeriesAy(series, { selectedAy, compareAy });
      const points = ayCode === selectedAy ? current : (comparison ?? []);
      const point = points.find((p) => p.x === x);
      // A month that has not happened yet is a gap, not a zero.
      if (!point || (point.y as number | null) === null) return;
      setPick({ ayCode, segment: x });
    },
    [current, comparison, selectedAy, compareAy, setPick]
  );
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <TrendChart
        label={label}
        current={current}
        comparison={comparison}
        yFormat="number"
        onSegmentClick={handleClick}
      />
      <InsightsDrill target="intake-month" pick={pick} />
    </Sheet>
  );
}

// ─── Application experience ─────────────────────────────────────────────────

export function FeedbackRatingDrillChart({
  data,
  ayCode,
}: {
  data: ComparisonBarPoint[];
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <ComparisonBarChart
        data={data}
        orientation="vertical"
        yFormat="number"
        height={200}
        rotateLabels={false}
        onSegmentClick={(category: string) => {
          const segment = ratingSegmentFromCategory(category);
          if (segment) setPick({ ayCode, segment });
        }}
      />
      {pick && (
        <FeedbackRatingDrillSheet ayCode={pick.ayCode} segment={pick.segment} />
      )}
    </Sheet>
  );
}

// ─── Withdrawn by level ─────────────────────────────────────────────────────

export function WithdrawnByLevelDrillDonut({
  data,
  centerValue,
  centerLabel,
  ayCode,
}: {
  data: DonutSlice[];
  centerValue: string;
  centerLabel: string;
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <DonutChart
        data={data}
        centerValue={centerValue}
        centerLabel={centerLabel}
        onSegmentClick={(level: string) => setPick({ ayCode, segment: level })}
      />
      <InsightsDrill target="withdrawn-by-level" pick={pick} />
    </Sheet>
  );
}

// ─── Entrance assessment ────────────────────────────────────────────────────

export function AssessmentConversionDrillChart({
  series,
  data,
  ayCode,
}: {
  series: GroupedBarSeries[];
  data: GroupedBarChartProps['data'];
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <GroupedBarChart
        series={series}
        data={data}
        yFormat="percent"
        height={240}
        onSegmentClick={(subject: string, s?: string) => {
          const segment = assessmentSegment(subject, s);
          if (segment) setPick({ ayCode, segment });
        }}
      />
      <InsightsDrill target="assessment-all" pick={pick} />
    </Sheet>
  );
}

// ─── Cancellation reasons ───────────────────────────────────────────────────

export function CancellationReasonsDrillDonut({
  bars,
  centerValue,
  centerLabel,
  ayCode,
}: {
  bars: ReasonBar[];
  centerValue: string;
  centerLabel: string;
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  const data = React.useMemo<DonutSlice[]>(
    () => bars.map((b) => ({ name: b.label, value: b.count })),
    [bars]
  );
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <DonutChart
        data={data}
        centerValue={centerValue}
        centerLabel={centerLabel}
        onSegmentClick={(name: string) => {
          const segment = reasonSegmentForSlice(name, bars);
          if (segment) setPick({ ayCode, segment });
        }}
      />
      <InsightsDrill target="terminal-reason" pick={pick} />
    </Sheet>
  );
}

/** The ghost "See all" in the Top-reason-per-level card header. */
export function TerminalReasonsSeeAll({ ayCode }: { ayCode: string }) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setPick({ ayCode, segment: null })}
      >
        See all
      </Button>
      <InsightsDrill target="terminal-reason" pick={pick} />
    </Sheet>
  );
}

/** Top reason per level — each row opens every reason recorded for its
 *  level, because the figure on the row is the level's total. */
export function TopReasonPerLevelList({
  ayCode,
  rows,
}: {
  ayCode: string;
  rows: { level: string; count: number; topReasonLabel: string | null }[];
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <div>
        {rows.map((lvl) => (
          <button
            key={lvl.level}
            type="button"
            onClick={() =>
              setPick({ ayCode, segment: levelReasonsSegment(lvl.level) })
            }
            className="flex w-full cursor-pointer items-center gap-3.5 rounded-md border-t border-hairline py-3 text-left transition-colors first:border-t-0 first:pt-1 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <GraduationCap className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-foreground">
                {lvl.level}
              </div>
              <div className="truncate text-[11.5px] text-muted-foreground">
                {lvl.topReasonLabel ?? '—'}
              </div>
            </div>
            <span className="shrink-0 font-mono text-[13px] font-bold text-foreground">
              {lvl.count.toLocaleString('en-SG')}
            </span>
          </button>
        ))}
      </div>
      <InsightsDrill target="terminal-reason" pick={pick} />
    </Sheet>
  );
}

// ─── By source ──────────────────────────────────────────────────────────────

export function ReferralVolumeDrillDonut({
  rows,
  centerValue,
  centerLabel,
  ayCode,
}: {
  rows: ReferralConversionRow[];
  centerValue: string;
  centerLabel: string;
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  const data = React.useMemo<DonutSlice[]>(
    () =>
      rows
        .filter((r) => r.applied > 0)
        .map((r) => ({ name: r.source, value: r.applied })),
    [rows]
  );
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <DonutChart
        data={data}
        centerValue={centerValue}
        centerLabel={centerLabel}
        onSegmentClick={(name: string) =>
          setPick({ ayCode, segment: referralSegmentForSlice(name, rows) })
        }
      />
      <InsightsDrill target="referral-all" pick={pick} />
    </Sheet>
  );
}

// ─── By category ────────────────────────────────────────────────────────────

export function CategoryMixDrillChart({
  series,
  data,
  selectedAy,
  compareAy,
}: {
  series: GroupedBarSeries[];
  data: GroupedBarChartProps['data'];
  selectedAy: string;
  compareAy: string | null;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <GroupedBarChart
        series={series}
        data={data}
        yFormat="number"
        height={260}
        onSegmentClick={(category: string, s?: string) =>
          setPick({
            ayCode: resolveSeriesAy(s, { selectedAy, compareAy }),
            segment: category,
          })
        }
      />
      <InsightsDrill target="category" pick={pick} />
    </Sheet>
  );
}

// ─── Nationality ────────────────────────────────────────────────────────────

export function NationalityMixDrillPie({
  rows,
  compareRows,
  compareLabel,
  unitLabel,
  ayCode,
}: {
  rows: NationalityMixRow[];
  compareRows: NationalityMixRow[] | null;
  compareLabel: string | null;
  unitLabel: string;
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <NationalityMixPie
        rows={rows}
        compareRows={compareRows}
        compareLabel={compareLabel}
        unitLabel={unitLabel}
        onSegmentClick={(nationality: string) =>
          setPick({ ayCode, segment: nationalitySegment(nationality) })
        }
      />
      <InsightsDrill target="nationality" pick={pick} />
    </Sheet>
  );
}

export function NationalityByLevelDrillBars({
  data,
  unitLabel,
  ayCode,
}: {
  data: NationalityByLevel;
  unitLabel: string;
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <NationalityByLevelBars
        data={data}
        unitLabel={unitLabel}
        onSegmentClick={(level: string, nationality?: string) =>
          setPick({
            ayCode,
            segment: nationalitySegment(nationality ?? '', level),
          })
        }
      />
      <InsightsDrill target="nationality" pick={pick} />
    </Sheet>
  );
}
