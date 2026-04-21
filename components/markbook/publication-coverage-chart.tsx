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

import type { TermPubCoverage } from '@/lib/markbook/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function PublicationCoverageChart({ data }: { data: TermPubCoverage[] }) {
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
            <p className="text-sm font-medium text-foreground">No sections configured</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Bars appear once AY sections are populated.
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
                  cursor={{ fill: 'var(--accent)' }}
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    color: 'var(--popover-foreground)',
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
                <Bar
                  dataKey="published"
                  name="Published"
                  stackId="pub"
                  fill="var(--chart-5)"
                />
                <Bar
                  dataKey="notPublished"
                  name="Not yet published"
                  stackId="pub"
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
