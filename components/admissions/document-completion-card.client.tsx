'use client';

import * as React from 'react';
import { FileCheck2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { DocCompletionResult } from '@/lib/admissions/dashboard';
import type { DrillRow } from '@/lib/admissions/drill';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';
import {
  AXIS_TICK,
  BAR_CURSOR,
  BAR_RADIUS_TOP,
  CATEGORY_TICK,
  CHART_AXIS,
  CHART_GRID,
  SEGMENT_EDGE,
} from '@/components/dashboard/charts/chart-primitives';
import { chartTooltipContent } from '@/components/dashboard/charts/chart-tooltip';
import { AdmissionsDrillSheet } from '@/components/admissions/drills/admissions-drill-sheet';

export type DocumentCompletionCardProps = {
  data: DocCompletionResult;
  ayCode: string;
  drillRows?: DrillRow[];
};

export function DocumentCompletionCard({
  data,
  ayCode,
  drillRows,
}: DocumentCompletionCardProps) {
  const [openLevel, setOpenLevel] = React.useState<string | null>(null);

  const chartData = React.useMemo(
    () =>
      data.map((row) => ({
        level: row.level,
        complete: row.complete,
        partial: row.partial,
        missing: row.missing,
      })),
    [data]
  );

  const empty = data.length === 0;

  const handleBarClick = React.useCallback((data: unknown) => {
    const payload = data as { payload?: { level?: string }; level?: string };
    const level = payload?.payload?.level ?? payload?.level;
    if (level) setOpenLevel(level);
  }, []);

  return (
    <Sheet
      open={!!openLevel}
      onOpenChange={(o) => {
        if (!o) setOpenLevel(null);
      }}
    >
      <Card className="h-full">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Documents
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Documents collected by level
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <FileCheck2 className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {empty ? (
            <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
              <FileCheck2 className="size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">
                No document data
              </p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Document completion appears once applicants have uploaded files.
              </p>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                >
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis
                    dataKey="level"
                    tick={CATEGORY_TICK}
                    {...CHART_AXIS}
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                    height={56}
                  />
                  <YAxis
                    tick={AXIS_TICK}
                    {...CHART_AXIS}
                    allowDecimals={false}
                    width={36}
                  />
                  <Tooltip
                    wrapperStyle={{ zIndex: 20 }}
                    cursor={BAR_CURSOR}
                    // The three segments count applicants, not documents: each
                    // applicant at this level is complete, partial or missing
                    // and never two of them, so the stack sums to the level's
                    // applicant count.
                    content={chartTooltipContent({
                      share: true,
                      totalLabel: 'All applicants',
                    })}
                  />
                  {/* How complete a file is, is ONE quantity in three grades,
                      so it is three shades of one blue — darkest for done —
                      rather than green / amber / red, which read as three
                      unrelated states and borrow the status colours. */}
                  <Bar
                    dataKey="complete"
                    name="Complete"
                    stackId="a"
                    fill="var(--color-series-1)"
                    {...SEGMENT_EDGE}
                    isAnimationActive={false}
                    onClick={handleBarClick as never}
                    style={{ cursor: 'pointer' }}
                  />
                  <Bar
                    dataKey="partial"
                    name="Partial"
                    stackId="a"
                    fill="var(--color-series-1-mid)"
                    {...SEGMENT_EDGE}
                    isAnimationActive={false}
                    onClick={handleBarClick as never}
                    style={{ cursor: 'pointer' }}
                  />
                  <Bar
                    dataKey="missing"
                    name="Missing"
                    stackId="a"
                    fill="var(--color-series-1-soft)"
                    {...SEGMENT_EDGE}
                    radius={BAR_RADIUS_TOP}
                    isAnimationActive={false}
                    onClick={handleBarClick as never}
                    style={{ cursor: 'pointer' }}
                  />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ChartLegendChip color="series-1" label="Complete" />
                <ChartLegendChip color="series-1-mid" label="Partial" />
                <ChartLegendChip color="series-1-soft" label="Missing" />
              </div>
            </>
          )}
        </CardContent>
      </Card>
      {openLevel && (
        <AdmissionsDrillSheet
          target="doc-completion"
          segment={openLevel}
          ayCode={ayCode}
          initialRows={drillRows}
        />
      )}
    </Sheet>
  );
}
