'use client';

import { GraduationCap } from 'lucide-react';
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
import type { LevelCompletionRow } from '@/lib/p-files/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function CompletionByLevelChartImpl({
  data,
  onSegmentClick,
}: {
  data: LevelCompletionRow[];
  onSegmentClick?: (level: string) => void;
}) {
  const chartData = data.map((r) => ({
    ...r,
    short: r.level.replace(/^Primary /, 'P').replace(/^Secondary /, 'S'),
  }));
  const total = data.reduce(
    (sum, r) => sum + r.valid + r.pending + r.rejected + r.missing,
    0
  );
  const empty = total === 0;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Documents · By level
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Completion by grade level
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <GraduationCap className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[340px] flex-col items-center justify-center gap-2 text-center">
            <GraduationCap className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">
              No document data
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Bars appear once students have a level assignment.
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
                dataKey="short"
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
                interval={0}
                // Tilt category labels so longer level codes (e.g. "YS-L",
                // "YS-J") don't overlap when the chart has 10+ bars.
                angle={-30}
                textAnchor="end"
                height={56}
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
                // The axis plots the short code ("P1", "YS-L"), so the heading
                // has to come off the row to name the level in full.
                // The four segments count documents, one per slot per student,
                // so the stack sums to the documents asked of that level.
                content={chartTooltipContent({
                  heading: (ctx) =>
                    (ctx.row as LevelCompletionRow | undefined)?.level ?? '',
                  share: true,
                  totalLabel: 'All documents',
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
                        const p = d as { payload?: { level?: string } };
                        const lvl = p?.payload?.level;
                        if (lvl) onSegmentClick(lvl);
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
                        const p = d as { payload?: { level?: string } };
                        const lvl = p?.payload?.level;
                        if (lvl) onSegmentClick(lvl);
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
                        const p = d as { payload?: { level?: string } };
                        const lvl = p?.payload?.level;
                        if (lvl) onSegmentClick(lvl);
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
                        const p = d as { payload?: { level?: string } };
                        const lvl = p?.payload?.level;
                        if (lvl) onSegmentClick(lvl);
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
