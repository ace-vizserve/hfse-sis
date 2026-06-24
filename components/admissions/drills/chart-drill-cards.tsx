'use client';

import * as React from 'react';

import { AdmissionsDrillSheet } from '@/components/admissions/drills/admissions-drill-sheet';
import { AssessmentOutcomesChart } from '@/components/admissions/assessment-outcomes-chart';
import { ReferralSourceChart } from '@/components/admissions/referral-source-chart';
import { PipelineStageChart } from '@/components/sis/pipeline-stage-chart';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { ComparisonBarChart } from '@/components/dashboard/charts/comparison-bar-chart';
import type {
  AssessmentOutcomes,
  ReferralSource,
  TimeToEnrollBucket,
} from '@/lib/admissions/dashboard';
import type { DrillRow } from '@/lib/admissions/drill';
import type { PipelineStage as PipelineStageRow } from '@/lib/sis/dashboard';

// Per-target client wrappers that bundle a chart card with an admissions
// drill sheet. Each owns its own `<Sheet>` open state and dispatches a
// segment-click handler into the underlying chart.
//
// Lives in a single 'use client' module so the page (Server Component) can
// import and render the wrappers without serializing render-prop functions
// across the server/client boundary — that pattern triggers Next 16's
// "Functions are not valid as a child of Client Components" error.

type CommonDrillProps = {
  ayCode: string;
  rangeFrom?: string;
  rangeTo?: string;
  drillRows?: DrillRow[];
};

// ─── Pipeline ────────────────────────────────────────────────────────────────

export function PipelineDrillCard({
  data,
  ayCode,
  drillRows,
}: CommonDrillProps & { data: PipelineStageRow[] }) {
  const [segment, setSegment] = React.useState<string | null>(null);
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <PipelineStageChart data={data} onSegmentClick={setSegment} />
      {segment && (
        <AdmissionsDrillSheet
          target="pipeline-stage"
          segment={segment}
          ayCode={ayCode}
          initialRows={drillRows}
        />
      )}
    </Sheet>
  );
}

// ─── Assessment ──────────────────────────────────────────────────────────────

export function AssessmentDrillCard({
  data,
  ayCode,
  drillRows,
}: CommonDrillProps & { data: AssessmentOutcomes }) {
  const [segment, setSegment] = React.useState<string | null>(null);
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <AssessmentOutcomesChart data={data} onSegmentClick={setSegment} />
      {segment && (
        <AdmissionsDrillSheet
          target="assessment"
          segment={segment}
          ayCode={ayCode}
          initialRows={drillRows}
        />
      )}
    </Sheet>
  );
}

// ─── Referral ────────────────────────────────────────────────────────────────

export function ReferralDrillCard({
  data,
  ayCode,
  drillRows,
}: CommonDrillProps & { data: ReferralSource[] }) {
  const [segment, setSegment] = React.useState<string | null>(null);

  const handleSegmentClick = React.useCallback(
    (seg: string) => {
      if (seg === 'Other') {
        // Encode the named top-N sources so the drill can exclude them exactly
        // rather than guessing which sources were collapsed into "Other".
        const named = data
          .filter((d) => d.source !== 'Other')
          .map((d) => d.source)
          .join('|');
        setSegment(`__other__:${named}`);
      } else {
        setSegment(seg);
      }
    },
    [data]
  );

  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <ReferralSourceChart data={data} onSegmentClick={handleSegmentClick} />
      {segment && (
        <AdmissionsDrillSheet
          target="referral"
          segment={segment}
          ayCode={ayCode}
          initialRows={drillRows}
        />
      )}
    </Sheet>
  );
}

// ─── Time to enrol ───────────────────────────────────────────────────────────
// Revived (2026-06-24) on real `enrolledAt` column (migration 075).
// When all bucket counts are 0 (no enrolments stamped yet) a neutral
// "building" state is rendered instead of an empty chart.

export function TimeToEnrollDrillCard({
  data,
  ayCode,
  drillRows,
}: CommonDrillProps & { data: TimeToEnrollBucket[] }) {
  const [segment, setSegment] = React.useState<string | null>(null);
  const hasData = data.some((b) => b.count > 0);

  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <Card className="h-full">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Time to enrolment
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {hasData ? 'Days to close' : 'Days to close'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hasData ? (
            <ComparisonBarChart
              data={data.map((b) => ({ category: b.label, current: b.count }))}
              height={240}
              onSegmentClick={setSegment}
            />
          ) : (
            <div className="flex h-[240px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 text-center">
              <p className="font-serif text-base font-medium text-foreground">
                No enrolments tracked yet
              </p>
              <p className="max-w-[22ch] text-sm leading-relaxed text-muted-foreground">
                Days from application to enrolment will appear here once new
                enrolments are recorded.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      {segment && (
        <AdmissionsDrillSheet
          target="time-to-enroll-bucket"
          segment={segment}
          ayCode={ayCode}
          initialRows={drillRows}
        />
      )}
    </Sheet>
  );
}
