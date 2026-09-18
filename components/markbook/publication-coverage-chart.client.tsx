'use client';

import { FileCheck2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { chartLegendContent } from '@/components/dashboard/chart-legend-chip';
import { chartTooltipContent } from '@/components/dashboard/charts/chart-tooltip';
import type { TermPubCoverage } from '@/lib/markbook/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export type PublicationCoverageChartProps = {
  data: TermPubCoverage[];
  onSegmentClick?: (segment: string) => void;
};

export function PublicationCoverageChart({
  data,
  onSegmentClick,
}: PublicationCoverageChartProps) {
  const chartData = data.map((t) => ({
    ...t,
    notPublished: Math.max(0, t.sections - t.published),
  }));
  const totalSections = data.reduce((sum, t) => sum + t.sections, 0);
  const empty = totalSections === 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Report cards · By term
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Publication coverage
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <FileCheck2 className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[340px] flex-col items-center justify-center gap-2 text-center">
            <FileCheck2 className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">
              No sections configured
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Bars appear once AY sections are populated.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <BarChart
              data={chartData}
              margin={{ top: 16, right: 16, bottom: 8, left: 0 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="var(--border)"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="termLabel"
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={12}
                allowDecimals={false}
                tickLine={false}
              />
              <Tooltip
                wrapperStyle={{ zIndex: 20 }}
                cursor={{ fill: 'var(--accent)' }}
                // Published + not yet published is every section in the term,
                // which is the number the reader is judging coverage against.
                content={chartTooltipContent({
                  share: true,
                  totalLabel: 'All sections',
                })}
              />
              <Legend
                content={chartLegendContent({
                  published: 'chart-5',
                  notPublished: 'chart-2',
                })}
              />
              <Bar
                dataKey="published"
                name="Published"
                stackId="pub"
                fill="var(--chart-5)"
                onClick={
                  onSegmentClick
                    ? (((d: unknown) => {
                        const p = d as { payload?: { termLabel?: string } };
                        const lbl = p?.payload?.termLabel;
                        if (lbl) onSegmentClick(`${lbl} · Published`);
                      }) as never)
                    : undefined
                }
                style={onSegmentClick ? { cursor: 'pointer' } : undefined}
              />
              <Bar
                dataKey="notPublished"
                name="Not yet published"
                stackId="pub"
                fill="var(--muted-foreground)"
                onClick={
                  onSegmentClick
                    ? (((d: unknown) => {
                        const p = d as { payload?: { termLabel?: string } };
                        const lbl = p?.payload?.termLabel;
                        if (lbl) onSegmentClick(`${lbl} · Unpublished`);
                      }) as never)
                    : undefined
                }
                style={onSegmentClick ? { cursor: 'pointer' } : undefined}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
