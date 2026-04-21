'use client';

import { BarChart3 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { GradeBucket } from '@/lib/markbook/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Mastery band colors — keyed to the DepEd tiers. Failing = destructive,
// outstanding = chart-5 (green). Uses design-system tokens only.
const BAND_FILL: Record<string, string> = {
  dnm: 'var(--destructive)',
  fs: 'var(--chart-3)',
  s: 'var(--chart-2)',
  vs: 'var(--chart-1)',
  o: 'var(--chart-5)',
};

export function GradeDistributionChart({
  data,
  termLabel,
}: {
  data: GradeBucket[];
  termLabel: string;
}) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const empty = total === 0;
  const meetsExpectations = data
    .filter((d) => d.key !== 'dnm')
    .reduce((sum, d) => sum + d.count, 0);
  const pct = total > 0 ? Math.round((meetsExpectations / total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Academic · {termLabel}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Grade distribution
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <BarChart3 className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[340px] flex-col items-center justify-center gap-2 text-center">
            <BarChart3 className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No quarterly grades yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Bars appear once teachers enter scores for {termLabel}.
            </p>
          </div>
        ) : (
          <div className="h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 16, right: 12, bottom: 8, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  allowDecimals={false}
                  tickLine={false}
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
                />
                <Bar dataKey="count" name="Students" radius={[4, 4, 0, 0]}>
                  {data.map((d) => (
                    <Cell key={d.key} fill={BAND_FILL[d.key] ?? 'var(--chart-1)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
      {!empty && (
        <CardFooter className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground tabular-nums">{pct}%</span> of{' '}
            <span className="tabular-nums">{total.toLocaleString('en-SG')}</span> grades meet
            expectations (≥ 75)
          </span>
        </CardFooter>
      )}
    </Card>
  );
}
