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

import { chartLegendContent } from '@/components/dashboard/chart-legend-chip';
import type { AssessmentOutcomes } from '@/lib/admissions/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export type AssessmentOutcomesChartProps = {
  data: AssessmentOutcomes;
  onSegmentClick?: (segment: string) => void;
};

export function AssessmentOutcomesChart({
  data,
  onSegmentClick,
}: AssessmentOutcomesChartProps) {
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

  // Honest denominator: most applicants have no grade recorded (the assessment
  // columns are sparsely populated — ~15% in prod). Surface how many were
  // actually graded so the pass/fail split isn't misread as the whole cohort.
  const mathGraded = data.mathPass + data.mathFail;
  const engGraded = data.engPass + data.engFail;
  const cohort = data.mathPass + data.mathFail + data.mathUnknown;
  const gradedNote =
    cohort > 0
      ? `Grades recorded for ${mathGraded} math · ${engGraded} English of ${cohort.toLocaleString('en-SG')} applicants`
      : null;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Assessment outcomes
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Entrance assessment pass rate
        </CardTitle>
        {gradedNote && (
          <p className="text-xs text-muted-foreground">{gradedNote}</p>
        )}
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
            <p className="text-sm font-medium text-foreground">
              No assessment data
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Pass rates appear once applicants have been assessed.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
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
                content={chartLegendContent({
                  Pass: 'chart-5',
                  Fail: 'very-stale',
                  Unknown: 'chart-2',
                })}
              />
              <Bar
                dataKey="Pass"
                stackId="a"
                fill="var(--chart-5)"
                onClick={
                  onSegmentClick
                    ? (barData) => {
                        const subject = (
                          barData as unknown as { subject?: string }
                        ).subject;
                        onSegmentClick(
                          `${subject === 'English' ? 'eng' : 'math'}:pass`
                        );
                      }
                    : undefined
                }
                style={onSegmentClick ? { cursor: 'pointer' } : undefined}
              />
              <Bar
                dataKey="Fail"
                stackId="a"
                fill="var(--destructive)"
                onClick={
                  onSegmentClick
                    ? (barData) => {
                        const subject = (
                          barData as unknown as { subject?: string }
                        ).subject;
                        onSegmentClick(
                          `${subject === 'English' ? 'eng' : 'math'}:fail`
                        );
                      }
                    : undefined
                }
                style={onSegmentClick ? { cursor: 'pointer' } : undefined}
              />
              <Bar
                dataKey="Unknown"
                stackId="a"
                fill="var(--muted-foreground)"
                radius={[4, 4, 0, 0]}
                onClick={
                  onSegmentClick
                    ? (barData) => {
                        const subject = (
                          barData as unknown as { subject?: string }
                        ).subject;
                        onSegmentClick(
                          `${subject === 'English' ? 'eng' : 'math'}:unknown`
                        );
                      }
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
