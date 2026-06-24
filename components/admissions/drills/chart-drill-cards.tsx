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
import type {
  AssessmentOutcomes,
  ReferralSource,
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

// `TimeToEnrollDrillCard` removed (2026-06-24) — see dashboard.ts tombstone.
