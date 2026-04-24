'use client';

import { Lock } from 'lucide-react';
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
import type { TermLockProgress } from '@/lib/markbook/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function SheetProgressChart({ data }: { data: TermLockProgress[] }) {
  const total = data.reduce((sum, t) => sum + t.locked + t.open, 0);
  const empty = total === 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Grading · By term
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Sheet lock progress
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Lock className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[340px] flex-col items-center justify-center gap-2 text-center">
            <Lock className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No grading sheets yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Bars appear once registrar creates sheets for this academic year.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="termLabel" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} allowDecimals={false} tickLine={false} />
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
              <Legend content={chartLegendContent({ locked: 'chart-5', open: 'chart-3' })} />
              <Bar dataKey="locked" name="Locked" stackId="status" fill="var(--chart-5)" />
              <Bar dataKey="open" name="Open" stackId="status" fill="var(--chart-3)" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
