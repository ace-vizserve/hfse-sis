'use client';

import { Megaphone } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ReferralSource } from '@/lib/admissions/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Truncate long source labels so the Y-axis doesn't eat the chart width.
const trunc = (s: string, n = 22) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function ReferralSourceChart({ data }: { data: ReferralSource[] }) {
  const empty = data.length === 0;
  const rows = data.map((d) => ({ ...d, display: trunc(d.source) }));

  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Referral source
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          How parents hear about us
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Megaphone className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
            <Megaphone className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No referral data</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              The referral field on the enrolment form is empty for all
              applicants in this academic year.
            </p>
          </div>
        ) : (
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ top: 0, right: 24, bottom: 0, left: 8 }}
              >
                <CartesianGrid
                  horizontal={false}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  type="number"
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  allowDecimals={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="display"
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  width={140}
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
                  labelFormatter={(_, payload) => {
                    const r = payload?.[0]?.payload as ReferralSource | undefined;
                    return r?.source ?? '';
                  }}
                />
                <Bar
                  dataKey="count"
                  name="Applications"
                  fill="var(--chart-3)"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
