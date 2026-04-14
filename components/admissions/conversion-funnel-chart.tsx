'use client';

import { Filter } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { FunnelStage } from '@/lib/admissions/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Horizontal bar chart reads more clearly than recharts' FunnelChart at low n.
// Each row = one stage, width = cumulative count reaching that stage.
export function ConversionFunnelChart({ data }: { data: FunnelStage[] }) {
  const empty = data.every((d) => d.count === 0);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Conversion funnel
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Where do applications drop off?
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Filter className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <EmptyFunnel />
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 8, right: 48, bottom: 8, left: 16 }}
              >
                <CartesianGrid
                  horizontal={false}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  type="number"
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="stage"
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  width={140}
                />
                <Tooltip
                  cursor={{ fill: 'var(--accent)' }}
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    color: 'var(--popover-foreground)',
                    fontSize: 12,
                  }}
                  formatter={(value, _name, item) => {
                    const drop =
                      (item as { payload?: FunnelStage } | undefined)?.payload
                        ?.dropOffPct ?? 0;
                    const label = `${value}${drop > 0 ? ` · −${drop}% from prior stage` : ''}`;
                    return [label, 'Applications'];
                  }}
                />
                <Bar dataKey="count" fill="var(--chart-1)" radius={[0, 6, 6, 0]}>
                  <LabelList
                    dataKey="count"
                    position="right"
                    className="fill-foreground"
                    fontSize={12}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyFunnel() {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
      <Filter className="size-6 text-muted-foreground/60" />
      <p className="text-sm font-medium text-foreground">No applications yet</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Funnel populates once admissions records exist for this academic year.
      </p>
    </div>
  );
}
