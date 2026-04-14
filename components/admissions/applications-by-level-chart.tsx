'use client';

import { BarChart3 } from 'lucide-react';
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

import type { LevelBucket } from '@/lib/admissions/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function ApplicationsByLevelChart({ data }: { data: LevelBucket[] }) {
  const empty = data.length === 0;
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Applications by level
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Submissions vs enrolments per level
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <BarChart3 className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-center">
            <BarChart3 className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No level data</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Bars appear once applications have a <code>levelApplied</code>.
            </p>
          </div>
        ) : (
          <div className="h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
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
                  dataKey="level"
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  tickLine={false}
                  interval={0}
                  angle={-20}
                  height={60}
                  textAnchor="end"
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
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  iconType="circle"
                />
                <Bar
                  dataKey="submitted"
                  name="Submitted"
                  fill="var(--chart-3)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="enrolled"
                  name="Enrolled"
                  fill="var(--chart-1)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
