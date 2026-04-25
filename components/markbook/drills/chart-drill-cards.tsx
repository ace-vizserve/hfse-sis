'use client';

import * as React from 'react';

import { MarkbookDrillSheet } from '@/components/markbook/drills/markbook-drill-sheet';
import { GradeDistributionChart } from '@/components/markbook/grade-distribution-chart';
import { PublicationCoverageChart } from '@/components/markbook/publication-coverage-chart';
import { SheetProgressChart } from '@/components/markbook/sheet-progress-chart';
import { Sheet } from '@/components/ui/sheet';
import type { GradeBucket, TermLockProgress, TermPubCoverage } from '@/lib/markbook/dashboard';
import type { ChangeRequestRow, GradeEntryRow, SheetRow } from '@/lib/markbook/drill';

// Per-target client wrappers for Markbook chart cards. Each owns its own
// `<Sheet>` open-state and dispatches a segment-click handler into the
// underlying chart. The drill sheet's `target` prop drives the column set +
// row-shape + filter behavior.

type CommonDrillProps = {
  ayCode: string;
  rangeFrom?: string;
  rangeTo?: string;
  initialSheets?: SheetRow[];
  initialChangeRequests?: ChangeRequestRow[];
};

// ─── Grade Distribution → grade-bucket-entries ──────────────────────────────
// Lazy-fetches entries via /api/markbook/drill on drill open (entry-kind row
// shape is too large to pre-fetch at scale — see KD #56).

export function GradeDistributionDrillCard({
  data,
  termLabel,
  ayCode,
  rangeFrom,
  rangeTo,
}: CommonDrillProps & { data: GradeBucket[]; termLabel: string }) {
  const [segment, setSegment] = React.useState<string | null>(null);
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <GradeDistributionChart data={data} termLabel={termLabel} onSegmentClick={setSegment} />
      {segment && (
        <MarkbookDrillSheet
          target="grade-bucket-entries"
          segment={segment}
          ayCode={ayCode}
          initialScope="range"
          initialFrom={rangeFrom}
          initialTo={rangeTo}
        />
      )}
    </Sheet>
  );
}

// ─── Sheet Progress → term-sheet-status ─────────────────────────────────────

export function SheetProgressDrillCard({
  data,
  ayCode,
  initialSheets,
}: CommonDrillProps & { data: TermLockProgress[] }) {
  const [segment, setSegment] = React.useState<string | null>(null);
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <SheetProgressChart data={data} onSegmentClick={setSegment} />
      {segment && (
        <MarkbookDrillSheet
          target="term-sheet-status"
          segment={segment}
          ayCode={ayCode}
          initialScope="ay"
          initialSheets={initialSheets}
        />
      )}
    </Sheet>
  );
}

// ─── Publication Coverage → term-publication-status ─────────────────────────

export function PublicationCoverageDrillCard({
  data,
  ayCode,
  initialSheets,
}: CommonDrillProps & { data: TermPubCoverage[] }) {
  const [segment, setSegment] = React.useState<string | null>(null);
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <PublicationCoverageChart data={data} onSegmentClick={setSegment} />
      {segment && (
        <MarkbookDrillSheet
          target="term-publication-status"
          segment={segment}
          ayCode={ayCode}
          initialScope="ay"
          initialSheets={initialSheets}
        />
      )}
    </Sheet>
  );
}
