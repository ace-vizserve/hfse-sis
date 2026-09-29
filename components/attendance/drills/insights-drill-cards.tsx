'use client';

import * as React from 'react';

import { AttendanceDrillSheet } from '@/components/attendance/drills/attendance-drill-sheet';
import {
  GroupedBarChart,
  type GroupedBarSeries,
} from '@/components/dashboard/charts/grouped-bar-chart';
import {
  LabeledPieChart,
  type LabeledPieSlice,
} from '@/components/dashboard/charts/labeled-pie-chart';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import type { AttendanceDrillTarget } from '@/lib/attendance/drill';
import {
  MIX_SERIES_TARGET,
  MIX_SLICE_TARGET,
  termWindowFor,
  type TermWindowMap,
} from '@/lib/attendance/insights-drill';

// Attendance Insights is a Server Component, and a server page cannot hand a
// click handler to a client chart. These wrappers hold the clicked segment and
// open the drill sheet — the chart-drill-cards.tsx pattern, one per block.
// Unlike that file's cards, these own no <Card> chrome: the page (Task 2.7)
// keeps the header/title/"See all" around each chart, so a wrapper here is
// only the chart plus its Sheet.

type OpenDrill = {
  target: AttendanceDrillTarget;
  ayCode: string;
  from?: string;
  to?: string;
  segment?: string;
  termId?: string;
};

function DrillHost({
  drill,
  onClose,
  children,
}: {
  drill: OpenDrill | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={drill !== null} onOpenChange={(o) => !o && onClose()}>
      {children}
      {drill && (
        <AttendanceDrillSheet
          key={`${drill.target}|${drill.ayCode}|${drill.from ?? ''}|${drill.to ?? ''}|${drill.segment ?? ''}|${drill.termId ?? ''}`}
          target={drill.target}
          segment={drill.segment ?? null}
          ayCode={drill.ayCode}
          initialFrom={drill.from}
          initialTo={drill.to}
          termId={drill.termId}
        />
      )}
    </Sheet>
  );
}

type ChartData = Array<Record<string, string | number | null>>;

/** Attendance mix pie — a slice opens that status's marks for the selected term. */
export function AttendanceMixPieDrill({
  data,
  colors,
  ayCode,
  from,
  to,
}: {
  data: LabeledPieSlice[];
  colors: string[];
  ayCode: string;
  from?: string;
  to?: string;
}) {
  const [drill, setDrill] = React.useState<OpenDrill | null>(null);
  return (
    <DrillHost drill={drill} onClose={() => setDrill(null)}>
      <LabeledPieChart
        data={data}
        colors={colors}
        onSegmentClick={(name) => {
          const target = MIX_SLICE_TARGET[name];
          if (target) setDrill({ target, ayCode, from, to });
        }}
      />
    </DrillHost>
  );
}

/**
 * Term-by-term attendance rate — a bar opens every marked day of that term in
 * THAT BAR'S year (the series key is the AY code), Status as a column. A term
 * with no dates opens nothing rather than the whole year.
 */
export function TermRateBarsDrill({
  series,
  data,
  yDomain,
  highlightX,
  termWindows,
}: {
  series: GroupedBarSeries[];
  data: ChartData;
  yDomain?: [number, number];
  highlightX?: string;
  termWindows: TermWindowMap;
}) {
  const [drill, setDrill] = React.useState<OpenDrill | null>(null);
  return (
    <DrillHost drill={drill} onClose={() => setDrill(null)}>
      <GroupedBarChart
        series={series}
        data={data}
        yFormat="percent"
        yDomain={yDomain}
        showValueLabels
        highlightX={highlightX}
        onSegmentClick={(term, ayCode) => {
          if (!ayCode) return;
          const w = termWindowFor(termWindows, ayCode, term);
          if (!w) return;
          setDrill({
            target: 'attendance-summary',
            ayCode,
            from: w.from,
            to: w.to,
          });
        }}
      />
    </DrillHost>
  );
}

/**
 * Composition by term — a bar opens that status's marks for that term (a
 * count of marks, not every mark in the year). Mr Ace: composition bars are a
 * per-term breakdown, so the drill they open stays scoped to the term clicked.
 */
export function CompositionBarsDrill({
  series,
  data,
  height,
  ayCode,
  termWindows,
}: {
  series: GroupedBarSeries[];
  data: ChartData;
  height?: number;
  ayCode: string;
  termWindows: TermWindowMap;
}) {
  const [drill, setDrill] = React.useState<OpenDrill | null>(null);
  return (
    <DrillHost drill={drill} onClose={() => setDrill(null)}>
      <GroupedBarChart
        series={series}
        data={data}
        yFormat="percent"
        height={height}
        onSegmentClick={(term, statusKey) => {
          const target = statusKey ? MIX_SERIES_TARGET[statusKey] : undefined;
          const w = termWindowFor(termWindows, ayCode, term);
          if (!target || !w) return;
          setDrill({ target, ayCode, from: w.from, to: w.to });
        }}
      />
    </DrillHost>
  );
}

/** "See all" for a block that is itself a short list — opens the full list. */
export function SeeAllDrillButton({
  target,
  segment,
  ayCode,
  from,
  to,
  termId,
  label = 'See all',
}: {
  target: AttendanceDrillTarget;
  segment?: string;
  ayCode: string;
  from?: string;
  to?: string;
  termId?: string;
  label?: string;
}) {
  const [drill, setDrill] = React.useState<OpenDrill | null>(null);
  return (
    <DrillHost drill={drill} onClose={() => setDrill(null)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setDrill({ target, segment, ayCode, from, to, termId })}
      >
        {label}
      </Button>
    </DrillHost>
  );
}
