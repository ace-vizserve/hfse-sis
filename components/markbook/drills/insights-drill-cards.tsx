'use client';

import * as React from 'react';

import {
  CategoryLineChart,
  type CategoryLineChartProps,
} from '@/components/dashboard/charts/category-line-chart';
import {
  ComparisonBarChart,
  type ComparisonBarChartProps,
} from '@/components/dashboard/charts/comparison-bar-chart';
import {
  GroupedBarChart,
  type GroupedBarChartProps,
} from '@/components/dashboard/charts/grouped-bar-chart';
import {
  heroBadgeClassName,
  type HeroBadge,
} from '@/components/dashboard/dashboard-hero';
import { MarkbookDrillSheet } from '@/components/markbook/drills/markbook-drill-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger } from '@/components/ui/sheet';
import type { MarkbookDrillTarget } from '@/lib/markbook/drill';
import {
  levelTermSegment,
  parseTrendSeriesKey,
  subjectTermSegment,
  termNumberFromLabel,
  topBandSegment,
} from '@/lib/markbook/insights-drill';
import { cn } from '@/lib/utils';

// Markbook Insights (KD #229): each wrapper holds the clicked segment and
// opens the Markbook drill for it. A Server Component cannot hand a chart a
// function, so the page renders these instead of the bare charts. Every
// average they open is pinned to its figure by
// __tests__/markbook/insights-drill-parity.test.ts.

type OpenDrill = {
  target: MarkbookDrillTarget;
  segment: string;
  ayCode: string;
};

function InsightsDrillHost({
  open,
  onClose,
  children,
}: {
  open: OpenDrill | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet
      open={open !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {children}
      {open && (
        <MarkbookDrillSheet
          key={`${open.target}:${open.ayCode}:${open.segment}`}
          target={open.target}
          segment={open.segment}
          ayCode={open.ayCode}
          showInsightsSummary
        />
      )}
    </Sheet>
  );
}

// ─── How does performance move across terms? ────────────────────────────────
// Bars are subjects (series key "{subject} · {ayCode}") per term (x "T2"). The
// year comes from the SERIES, so a comparison-year series opens that year.

export function SubjectTrendDrillChart(
  props: Omit<GroupedBarChartProps, 'onSegmentClick'>
) {
  const [open, setOpen] = React.useState<OpenDrill | null>(null);
  return (
    <InsightsDrillHost open={open} onClose={() => setOpen(null)}>
      <GroupedBarChart
        {...props}
        onSegmentClick={(category, series) => {
          const termNumber = termNumberFromLabel(category);
          const parsed = series ? parseTrendSeriesKey(series) : null;
          if (termNumber === null || !parsed) return;
          setOpen({
            target: 'subject-term-entries',
            segment: subjectTermSegment(parsed.subjectName, termNumber),
            ayCode: parsed.ayCode,
          });
        }}
      />
    </InsightsDrillHost>
  );
}

// ─── Subjects to watch ──────────────────────────────────────────────────────

export function SubjectsToWatchDrillChart({
  ayCode,
  termNumber,
  ...chart
}: Omit<ComparisonBarChartProps, 'onSegmentClick'> & {
  ayCode: string;
  termNumber: number;
}) {
  const [open, setOpen] = React.useState<OpenDrill | null>(null);
  return (
    <InsightsDrillHost open={open} onClose={() => setOpen(null)}>
      <ComparisonBarChart
        {...chart}
        onSegmentClick={(subjectName) =>
          setOpen({
            target: 'subject-term-entries',
            segment: subjectTermSegment(subjectName, termNumber),
            ayCode,
          })
        }
      />
    </InsightsDrillHost>
  );
}

// ─── Which levels are struggling? ───────────────────────────────────────────

export function LevelAverageDrillChart({
  ayCode,
  termNumber,
  ...chart
}: Omit<CategoryLineChartProps, 'onSegmentClick'> & {
  ayCode: string;
  termNumber: number;
}) {
  const [open, setOpen] = React.useState<OpenDrill | null>(null);
  return (
    <InsightsDrillHost open={open} onClose={() => setOpen(null)}>
      <CategoryLineChart
        {...chart}
        onSegmentClick={(levelCode) =>
          setOpen({
            target: 'level-term-entries',
            segment: levelTermSegment(levelCode, termNumber),
            ayCode,
          })
        }
      />
    </InsightsDrillHost>
  );
}

// ─── Term-over-term movement ────────────────────────────────────────────────
// The category is display text ("Mathematics · P1"); the page passes the
// segment for each category so no display string is ever parsed back.

export function TermMovementDrillChart({
  ayCode,
  segmentByCategory,
  ...chart
}: Omit<ComparisonBarChartProps, 'onSegmentClick'> & {
  ayCode: string;
  segmentByCategory: Record<string, string>;
}) {
  const [open, setOpen] = React.useState<OpenDrill | null>(null);
  return (
    <InsightsDrillHost open={open} onClose={() => setOpen(null)}>
      <ComparisonBarChart
        {...chart}
        onSegmentClick={(category) => {
          const segment = segmentByCategory[category];
          if (!segment) return;
          setOpen({ target: 'subject-level-entries', segment, ayCode });
        }}
      />
    </InsightsDrillHost>
  );
}

// ─── Sheets locked · per term ───────────────────────────────────────────────
// Bars are labelled "Term 1"; term-sheet-status wants "T1" (a bare "Term 1"
// matches no pattern and would list every sheet).

export function SheetLockDrillChart({
  ayCode,
  ...chart
}: Omit<GroupedBarChartProps, 'onSegmentClick'> & { ayCode: string }) {
  const [open, setOpen] = React.useState<OpenDrill | null>(null);
  return (
    <InsightsDrillHost open={open} onClose={() => setOpen(null)}>
      <GroupedBarChart
        {...chart}
        onSegmentClick={(category) => {
          const termNumber = termNumberFromLabel(category);
          if (termNumber === null) return;
          setOpen({
            target: 'term-sheet-status',
            segment: `T${termNumber}`,
            ayCode,
          });
        }}
      />
    </InsightsDrillHost>
  );
}

// ─── Top-band hero badge ────────────────────────────────────────────────────
// The badge compares two years' share of grades at 85 and above, each in the
// term its histogram reads. It opens this year's list; the sheet offers the
// comparison year's list in place (no second dialog).

export type TopBandYear = {
  ayCode: string;
  termNumber: number;
  topCount: number;
  total: number;
};

export function TopBandBadgeDrill({
  badge,
  years,
}: {
  badge: HeroBadge;
  years: TopBandYear[];
}) {
  const [open, setOpen] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const className = heroBadgeClassName(badge.tone ?? 'default');

  if (years.length === 0) {
    return (
      <Badge variant="outline" className={className}>
        {badge.label}
      </Badge>
    );
  }

  const year = years[index % years.length];
  const other = years.length > 1 ? years[(index + 1) % years.length] : null;
  const pct =
    year.total > 0 ? Math.round((year.topCount / year.total) * 100) : 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setIndex(0);
      }}
    >
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={`${badge.label} — see the grades of 85 and above`}
          className="cursor-pointer rounded-md transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge
            variant="outline"
            className={cn(className, 'pointer-events-none')}
          >
            {badge.label}
          </Badge>
        </button>
      </SheetTrigger>
      {open && (
        <MarkbookDrillSheet
          key={year.ayCode}
          target="grade-bucket-entries"
          segment={topBandSegment(year.termNumber)}
          ayCode={year.ayCode}
          description={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span>
                {year.topCount.toLocaleString('en-SG')} of{' '}
                {year.total.toLocaleString('en-SG')} graded marks in Term{' '}
                {year.termNumber} of {year.ayCode} are 85 or above ({pct}%).
              </span>
              {other && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIndex((i) => i + 1)}
                >
                  Show {other.ayCode} instead
                </Button>
              )}
            </span>
          }
        />
      )}
    </Sheet>
  );
}
