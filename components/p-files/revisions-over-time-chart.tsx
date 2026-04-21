'use client';

import { History } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { RevisionWeek } from '@/lib/p-files/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function RevisionsOverTimeChart({ data }: { data: RevisionWeek[] }) {
  const total = data.reduce((sum, w) => sum + w.count, 0);
  const empty = total === 0;
  const recentWeek = data[data.length - 1];
  const priorWeek = data[data.length - 2];
  const delta =
    recentWeek && priorWeek ? recentWeek.count - priorWeek.count : 0;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Activity · Last {data.length} weeks
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Document replacements over time
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <History className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-center">
            <History className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No replacements yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              When staff replace documents, each archive appears as a bump on this chart.
            </p>
          </div>
        ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 16, right: 12, bottom: 8, left: 0 }}>
                <defs>
                  <linearGradient id="revisionsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="weekLabel"
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  allowDecimals={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--border)' }}
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    color: 'var(--popover-foreground)',
                    fontSize: 12,
                  }}
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.weekStart ?? ''
                  }
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="Replacements"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  fill="url(#revisionsGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
      {!empty && (
        <CardFooter className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold tabular-nums text-foreground">{total}</span>{' '}
            replacements total
            {recentWeek && (
              <>
                {' · '}
                <span className="tabular-nums text-foreground">{recentWeek.count}</span> this
                week
                {delta !== 0 && (
                  <>
                    {' ('}
                    <span className={delta > 0 ? 'text-brand-amber' : 'text-muted-foreground'}>
                      {delta > 0 ? '+' : ''}
                      {delta}
                    </span>
                    {')'}
                  </>
                )}
              </>
            )}
          </span>
        </CardFooter>
      )}
    </Card>
  );
}
