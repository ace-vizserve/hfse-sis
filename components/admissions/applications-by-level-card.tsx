'use client';

import * as React from 'react';
import { GraduationCap } from 'lucide-react';

import type {
  ApplicationsByLevelResult,
  ApplicationsByLevelRow,
} from '@/lib/admissions/dashboard';
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
import { ComparisonBarChart } from '@/components/dashboard/charts/comparison-bar-chart';
import { AdmissionsDrillSheet } from '@/components/admissions/drills/admissions-drill-sheet';

export type ApplicationsByLevelCardProps = {
  data: ApplicationsByLevelResult;
  ayCode: string;
  rangeFrom: string;
  rangeTo: string;
  /** Pre-fetched drill row set, scoped to current range. Optional but recommended. */
  drillRows?: DrillRow[];
};

export function ApplicationsByLevelCard({
  data,
  ayCode,
  rangeFrom,
  rangeTo,
  drillRows,
}: ApplicationsByLevelCardProps) {
  const [openLevel, setOpenLevel] = React.useState<string | null>(null);

  // Zip the comparison series into the current series by matching level so
  // the bar chart can render side-by-side current vs. prior bars per level.
  // When the user hasn't opted into a comparison, `data.comparison` is null
  // and the chart drops the secondary bar.
  const comparisonByLevel = React.useMemo(() => {
    const map = new Map<string, number>();
    if (!data.comparison) return map;
    for (const r of data.comparison) map.set(r.level, r.count);
    return map;
  }, [data.comparison]);

  const chartData = React.useMemo(
    () =>
      data.current.map((row: ApplicationsByLevelRow) => ({
        category: row.level,
        current: row.count,
        ...(data.comparison
          ? { comparison: comparisonByLevel.get(row.level) ?? 0 }
          : {}),
      })),
    [data.current, data.comparison, comparisonByLevel],
  );

  const empty = data.current.length === 0;

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
            Applications by level
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Where applications are coming from
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <GraduationCap className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {empty ? (
            <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
              <GraduationCap className="size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">No applications yet</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Level breakdown populates once admissions records exist for this range.
              </p>
            </div>
          ) : (
            <ComparisonBarChart
              data={chartData}
              orientation="vertical"
              height={260}
              yFormat="number"
              onSegmentClick={(level) => setOpenLevel(level)}
            />
          )}
        </CardContent>
      </Card>
      {openLevel && (
        <AdmissionsDrillSheet
          target="applications-by-level"
          segment={openLevel}
          ayCode={ayCode}
          initialScope="range"
          initialFrom={rangeFrom}
          initialTo={rangeTo}
          initialRows={drillRows}
        />
      )}
    </Sheet>
  );
}
