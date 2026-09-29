'use client';

import * as React from 'react';
import { ChevronsRight } from 'lucide-react';

import { AttritionStackedBarChart } from '@/components/dashboard/charts/attrition-stacked-bar-chart';
import { ComparisonBarChart } from '@/components/dashboard/charts/comparison-bar-chart';
import { ComposedBarLineChart } from '@/components/dashboard/charts/composed-bar-line-chart';
import { DonutChart } from '@/components/dashboard/charts/donut-chart';
import { GroupedBarChart } from '@/components/dashboard/charts/grouped-bar-chart';
import { RetentionStackedBarChart } from '@/components/dashboard/charts/retention-stacked-bar-chart';
import { NationalityByLevelBars } from '@/components/dashboard/insights/nationality-by-level-bars';
import { NationalityMixPie } from '@/components/dashboard/insights/nationality-mix-pie';
import { RecordsDrillSheet } from '@/components/sis/drills/records-drill-sheet';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger } from '@/components/ui/sheet';
import type { RecordsDrillTarget } from '@/lib/sis/drill';
import {
  encodeInsightsSegment,
  pickSeriesAy,
  termSegmentFromLabel,
} from '@/lib/sis/insights-shared';

// Records · Insights drill wrappers (KD #229). The page is a Server Component
// and cannot hand a click handler to a client chart, so each clickable chart
// is wrapped here: the wrapper owns the open drill and turns the chart's
// (category, series) into a target + segment + year. Same pattern as
// chart-drill-cards.tsx (Records dashboard) and the Admissions/Attendance
// Insights wrappers; the sheet only mounts once something is clicked, so no
// list is fetched until it is asked for.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChartProps<C extends React.JSXElementConstructor<any>> = Omit<
  React.ComponentProps<C>,
  'onSegmentClick'
>;

type OpenDrill = {
  target: RecordsDrillTarget;
  segment: string | null;
  ayCode: string;
  compareAy?: string;
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
    <Sheet
      open={drill !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {children}
      {drill && (
        <RecordsDrillSheet
          target={drill.target}
          segment={drill.segment}
          ayCode={drill.ayCode}
          compareAy={drill.compareAy}
        />
      )}
    </Sheet>
  );
}

function useDrill() {
  const [drill, setDrill] = React.useState<OpenDrill | null>(null);
  return { drill, open: setDrill, close: () => setDrill(null) };
}

// ─── Population & growth ────────────────────────────────────────────────────

export function PopulationByLevelDrillCard({
  selectedAy,
  compareAy,
  ...chart
}: ChartProps<typeof ComposedBarLineChart> & {
  selectedAy: string;
  compareAy: string;
}) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <ComposedBarLineChart
        {...chart}
        onSegmentClick={(level, series) =>
          open({
            target: 'enrolled-headcount',
            segment: encodeInsightsSegment({ level }),
            ayCode: pickSeriesAy(series, 'line', selectedAy, compareAy),
          })
        }
      />
    </DrillHost>
  );
}

export function CategoryMixDrillCard({
  selectedAy,
  compareAy,
  ...chart
}: ChartProps<typeof GroupedBarChart> & {
  selectedAy: string;
  compareAy: string;
}) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <GroupedBarChart
        {...chart}
        onSegmentClick={(category, series) =>
          open({
            target: 'category',
            segment: encodeInsightsSegment({ category }),
            ayCode: pickSeriesAy(series, 'compare', selectedAy, compareAy),
          })
        }
      />
    </DrillHost>
  );
}

export function NationalityMixDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof NationalityMixPie> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <NationalityMixPie
        {...chart}
        onSegmentClick={(nationality) =>
          open({
            target: 'nationality',
            segment: encodeInsightsSegment({ nationality }),
            ayCode,
          })
        }
      />
    </DrillHost>
  );
}

export function NationalityByLevelDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof NationalityByLevelBars> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <NationalityByLevelBars
        {...chart}
        onSegmentClick={(level, nationality) =>
          open({
            target: 'nationality',
            segment: encodeInsightsSegment({ level, nationality }),
            ayCode,
          })
        }
      />
    </DrillHost>
  );
}

export function MovementDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof GroupedBarChart> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <GroupedBarChart
        {...chart}
        onSegmentClick={(month, flow) => {
          if (!flow) return;
          open({
            target: 'movement-month',
            segment: encodeInsightsSegment({ flow, month }),
            ayCode,
          });
        }}
      />
    </DrillHost>
  );
}

// ─── Retention ──────────────────────────────────────────────────────────────

export function RetentionByLevelDrillCard({
  ayCode,
  compareAy,
  ...chart
}: ChartProps<typeof RetentionStackedBarChart> & {
  ayCode: string;
  compareAy: string;
}) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <RetentionStackedBarChart
        {...chart}
        onSegmentClick={(level, outcome) =>
          open({
            target: 'retention',
            segment: encodeInsightsSegment({ level, outcome }),
            ayCode,
            compareAy,
          })
        }
      />
    </DrillHost>
  );
}

// ─── Attrition ──────────────────────────────────────────────────────────────

export function LateByLevelDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof DonutChart> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <DonutChart
        {...chart}
        onSegmentClick={(level) =>
          open({
            target: 'late-enrollees',
            segment: encodeInsightsSegment({ level }),
            ayCode,
          })
        }
      />
    </DrillHost>
  );
}

export function LateByTermDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof ComparisonBarChart> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <ComparisonBarChart
        {...chart}
        onSegmentClick={(termLabel) => {
          const segment = termSegmentFromLabel(termLabel);
          if (segment) open({ target: 'late-enrollees', segment, ayCode });
        }}
      />
    </DrillHost>
  );
}

export function WithdrawalReasonsDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof DonutChart> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <DonutChart
        {...chart}
        onSegmentClick={(reason) =>
          open({
            target: 'withdrawals',
            segment: encodeInsightsSegment({ reason }),
            ayCode,
          })
        }
      />
    </DrillHost>
  );
}

export function AttritionDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof AttritionStackedBarChart> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <AttritionStackedBarChart
        {...chart}
        onSegmentClick={(level, reason) =>
          open({
            target: 'withdrawals',
            segment: encodeInsightsSegment({ level, reason }),
            ayCode,
          })
        }
      />
    </DrillHost>
  );
}

// ─── "See all" for list blocks ──────────────────────────────────────────────

export function RecordsSeeAllButton({
  target,
  segment = null,
  ayCode,
  compareAy,
  label = 'See all',
  className,
}: {
  target: RecordsDrillTarget;
  segment?: string | null;
  ayCode: string;
  compareAy?: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className={className}>
          {label}
          <ChevronsRight className="size-3.5" />
        </Button>
      </SheetTrigger>
      {open && (
        <RecordsDrillSheet
          target={target}
          segment={segment}
          ayCode={ayCode}
          compareAy={compareAy}
        />
      )}
    </Sheet>
  );
}
