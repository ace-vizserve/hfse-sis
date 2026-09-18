'use client';

import { FileWarning } from 'lucide-react';
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
import type { DocumentBacklogRow } from '@/lib/sis/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export type DocumentBacklogChartProps = {
  data: DocumentBacklogRow[];
  onSegmentClick?: (segment: string) => void;
};

export function DocumentBacklogChart({
  data,
  onSegmentClick,
}: DocumentBacklogChartProps) {
  const total = data.reduce(
    (sum, r) => sum + r.valid + r.pending + r.rejected + r.missing,
    0
  );
  const empty = total === 0;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Documents
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Validation backlog by document type
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <FileWarning className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[340px] flex-col items-center justify-center gap-2 text-center">
            <FileWarning className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">
              No document data
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Bars appear once documents exist for this academic year.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <BarChart
              data={data}
              margin={{ top: 16, right: 16, bottom: 8, left: 0 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="var(--border)"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="label"
                stroke="var(--muted-foreground)"
                fontSize={11}
                tickLine={false}
                interval={0}
                angle={-30}
                height={80}
                textAnchor="end"
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
                // One bar is one document type, counted once per student it is
                // asked of, so the four segments sum to the students this
                // document applies to (KD #219 gates the rest out).
                content={chartTooltipContent({
                  share: true,
                  totalLabel: 'All students',
                })}
              />
              <Legend
                content={chartLegendContent({
                  valid: 'chart-5',
                  pending: 'chart-3',
                  rejected: 'very-stale',
                  missing: 'chart-2',
                })}
              />
              <Bar
                dataKey="valid"
                name="Valid"
                stackId="status"
                fill="var(--chart-5)"
                onClick={
                  onSegmentClick
                    ? (((d: unknown) => {
                        const p = d as { payload?: { label?: string } };
                        const lbl = p?.payload?.label;
                        if (lbl) onSegmentClick(`${lbl}|valid`);
                      }) as never)
                    : undefined
                }
                style={onSegmentClick ? { cursor: 'pointer' } : undefined}
              />
              <Bar
                dataKey="pending"
                name="Pending review"
                stackId="status"
                fill="var(--chart-3)"
                onClick={
                  onSegmentClick
                    ? (((d: unknown) => {
                        const p = d as { payload?: { label?: string } };
                        const lbl = p?.payload?.label;
                        if (lbl) onSegmentClick(`${lbl}|pending`);
                      }) as never)
                    : undefined
                }
                style={onSegmentClick ? { cursor: 'pointer' } : undefined}
              />
              <Bar
                dataKey="rejected"
                name="Rejected"
                stackId="status"
                fill="var(--destructive)"
                onClick={
                  onSegmentClick
                    ? (((d: unknown) => {
                        const p = d as { payload?: { label?: string } };
                        const lbl = p?.payload?.label;
                        if (lbl) onSegmentClick(`${lbl}|rejected`);
                      }) as never)
                    : undefined
                }
                style={onSegmentClick ? { cursor: 'pointer' } : undefined}
              />
              <Bar
                dataKey="missing"
                name="Missing / expired"
                stackId="status"
                fill="var(--muted-foreground)"
                onClick={
                  onSegmentClick
                    ? (((d: unknown) => {
                        const p = d as { payload?: { label?: string } };
                        const lbl = p?.payload?.label;
                        if (lbl) onSegmentClick(`${lbl}|missing`);
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
