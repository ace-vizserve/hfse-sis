'use client';

import * as React from 'react';
import { BarChart3, Clock as ClockIcon } from 'lucide-react';

import { ComparisonBarChart } from '@/components/dashboard/charts/comparison-bar-chart';
import { TrendChart } from '@/components/dashboard/charts/trend-chart';
import { EvaluationDrillSheet } from '@/components/evaluation/drills/evaluation-drill-sheet';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import type { SectionWriteupRow, TimeToSubmitBucket, WriteupRow } from '@/lib/evaluation/drill';

type CommonProps = {
  ayCode: string;
  rangeFrom?: string;
  rangeTo?: string;
  initialWriteups?: WriteupRow[];
  initialBySection?: SectionWriteupRow[];
  initialBuckets?: TimeToSubmitBucket[];
};

type DailyPoint = { x: string; y: number };

// ─── Submission velocity trend → submission-velocity-day ────────────────────

export function SubmissionVelocityDrillCard({
  current,
  comparison,
  ayCode,
  rangeFrom,
  rangeTo,
  initialWriteups,
}: CommonProps & { current: DailyPoint[]; comparison: DailyPoint[] | null }) {
  const [segment, setSegment] = React.useState<string | null>(null);
  const recentDays = React.useMemo(() => current.slice(-14).filter((d) => d.y > 0).reverse(), [current]);
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Submission velocity
          </CardDescription>
          <CardTitle className="font-serif text-xl">Write-ups submitted per day</CardTitle>
          <CardAction>
            <details className="group relative">
              <summary className="cursor-pointer list-none">
                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-muted">
                  Drill day
                </span>
              </summary>
              <div className="absolute right-0 z-10 mt-1 w-[200px] rounded-md border border-border bg-popover p-1 shadow-lg">
                {recentDays.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">No submissions in range.</p>
                ) : recentDays.map((d) => (
                  <button
                    key={d.x}
                    type="button"
                    onClick={() => setSegment(d.x)}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent"
                  >
                    <span className="tabular-nums">{d.x}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">{Math.round(d.y)}</span>
                  </button>
                ))}
              </div>
            </details>
          </CardAction>
        </CardHeader>
        <CardContent>
          <TrendChart label="Submissions" current={current} comparison={comparison} />
        </CardContent>
      </Card>
      {segment && (
        <EvaluationDrillSheet
          target="submission-velocity-day"
          segment={segment}
          ayCode={ayCode}
          initialScope="range"
          initialFrom={rangeFrom}
          initialTo={rangeTo}
          initialWriteups={initialWriteups}
        />
      )}
    </Sheet>
  );
}

// ─── Writeups by section → writeups-by-section ──────────────────────────────

export function WriteupsBySectionCard({
  data,
  ayCode,
  rangeFrom,
  rangeTo,
  initialBySection,
  initialWriteups,
}: CommonProps & { data: SectionWriteupRow[] }) {
  const [open, setOpen] = React.useState(false);
  const empty = data.length === 0;
  const chartData = data.map((r) => ({ category: r.sectionName, current: r.submissionPct }));
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Writeups by section
          </CardDescription>
          <CardTitle className="font-serif text-xl">Submission % by section</CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <BarChart3 className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {empty ? (
            <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
              <BarChart3 className="size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">No sections with writeups yet</p>
            </div>
          ) : (
            <ComparisonBarChart
              data={chartData}
              orientation="horizontal"
              height={Math.min(420, Math.max(220, data.length * 26))}
              yFormat="percent"
              onSegmentClick={() => setOpen(true)}
            />
          )}
        </CardContent>
      </Card>
      {open && (
        <EvaluationDrillSheet
          target="writeups-by-section"
          ayCode={ayCode}
          initialScope="range"
          initialFrom={rangeFrom}
          initialTo={rangeTo}
          initialBySection={initialBySection}
          initialWriteups={initialWriteups}
        />
      )}
    </Sheet>
  );
}

// ─── Time-to-submit histogram → time-to-submit-bucket ───────────────────────

export function TimeToSubmitHistogramCard({
  data,
  ayCode,
  rangeFrom,
  rangeTo,
  initialBuckets,
  initialWriteups,
}: CommonProps & { data: TimeToSubmitBucket[] }) {
  const [segment, setSegment] = React.useState<string | null>(null);
  const empty = data.every((b) => b.count === 0);
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Time to submit
          </CardDescription>
          <CardTitle className="font-serif text-xl">Days from open to submission</CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <ClockIcon className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {empty ? (
            <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
              <ClockIcon className="size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">No submitted writeups yet</p>
            </div>
          ) : (
            <ComparisonBarChart
              data={data.map((b) => ({ category: b.label, current: b.count }))}
              height={220}
              onSegmentClick={setSegment}
            />
          )}
        </CardContent>
      </Card>
      {segment && (
        <EvaluationDrillSheet
          target="time-to-submit-bucket"
          segment={segment}
          ayCode={ayCode}
          initialScope="range"
          initialFrom={rangeFrom}
          initialTo={rangeTo}
          initialBuckets={initialBuckets}
          initialWriteups={initialWriteups}
        />
      )}
    </Sheet>
  );
}
