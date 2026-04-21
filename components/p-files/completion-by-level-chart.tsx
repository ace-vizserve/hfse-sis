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

import type { LevelCompletionRow } from '@/lib/p-files/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function CompletionByLevelChart({ data }: { data: LevelCompletionRow[] }) {
  const chartData = data.map((r) => ({
    ...r,
    short: r.level.replace(/^Primary /, 'P').replace(/^Secondary /, 'S'),
  }));
  const total = data.reduce(
    (sum, r) => sum + r.valid + r.pending + r.rejected + r.missing,
    0,
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
            <p className="text-sm font-medium text-foreground">No document data</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Bars appear once students have a level assignment.
            </p>
          </div>
        ) : (
          <div className="h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
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
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.level ?? ''}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
                <Bar dataKey="valid" name="Valid" stackId="status" fill="var(--chart-5)" />
                <Bar
                  dataKey="pending"
                  name="Pending review"
                  stackId="status"
                  fill="var(--chart-3)"
                />
                <Bar
                  dataKey="rejected"
                  name="Rejected"
                  stackId="status"
                  fill="var(--destructive)"
                />
                <Bar
                  dataKey="missing"
                  name="Missing / expired"
                  stackId="status"
                  fill="var(--muted-foreground)"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
