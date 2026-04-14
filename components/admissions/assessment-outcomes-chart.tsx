'use client';

import { ClipboardCheck } from 'lucide-react';
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

import type { AssessmentOutcomes } from '@/lib/admissions/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function AssessmentOutcomesChart({ data }: { data: AssessmentOutcomes }) {
  const rows = [
    {
      subject: 'Math',
      Pass: data.mathPass,
      Fail: data.mathFail,
      Unknown: data.mathUnknown,
    },
    {
      subject: 'English',
      Pass: data.engPass,
      Fail: data.engFail,
      Unknown: data.engUnknown,
    },
  ];
  const empty = rows.every((r) => r.Pass + r.Fail + r.Unknown === 0);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Assessment outcomes
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Entrance assessment pass rate
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <ClipboardCheck className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
            <ClipboardCheck className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No assessment data</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Pass rates appear once applicants have been assessed.
            </p>
          </div>
        ) : (
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="subject"
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
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                  iconType="circle"
                />
                <Bar dataKey="Pass" stackId="a" fill="var(--chart-5)" />
                <Bar dataKey="Fail" stackId="a" fill="var(--destructive)" />
                <Bar
                  dataKey="Unknown"
                  stackId="a"
                  fill="var(--muted-foreground)"
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
