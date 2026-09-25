'use client';

import * as React from 'react';
import { Download } from 'lucide-react';

import { RecordsDrillSheet } from '@/components/sis/drills/records-drill-sheet';
import { DocumentBacklogChart } from '@/components/sis/document-backlog-chart';
import { ExpiringDocumentsPanel } from '@/components/sis/expiring-documents-panel';
import { LevelDistributionChart } from '@/components/sis/level-distribution-chart';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import type {
  DocumentBacklogRow,
  ExpiringDocRow,
  LevelCount,
} from '@/lib/sis/dashboard';

// Per-target client wrappers for Records chart cards. Each owns its own
// `<Sheet>` open-state and dispatches a segment-click handler into the
// underlying chart. Lives in a single 'use client' module so the page
// (Server Component) can render the wrappers without serializing render-prop
// functions across the boundary.

type CommonProps = {
  ayCode: string;
  rangeFrom?: string;
  rangeTo?: string;
};

// ─── Document Backlog → backlog-by-document ─────────────────────────────────

export function DocumentBacklogDrillCard({
  data,
  ayCode,
  part,
}: CommonProps & {
  data: DocumentBacklogRow[];
  part: 'expiring' | 'once';
}) {
  const [segment, setSegment] = React.useState<string | null>(null);
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <DocumentBacklogChart
        data={data}
        part={part}
        onSegmentClick={setSegment}
      />
      {segment && (
        <RecordsDrillSheet
          target="backlog-by-document"
          segment={segment}
          ayCode={ayCode}
        />
      )}
    </Sheet>
  );
}

// ─── Level Distribution → students-by-level ─────────────────────────────────

export function LevelDistributionDrillCard({
  data,
  ayCode,
}: CommonProps & { data: LevelCount[] }) {
  const [level, setLevel] = React.useState<string | null>(null);
  return (
    <Sheet open={!!level} onOpenChange={(o) => !o && setLevel(null)}>
      <LevelDistributionChart data={data} onSegmentClick={setLevel} />
      {level && (
        <RecordsDrillSheet
          target="students-by-level"
          segment={level}
          ayCode={ayCode}
        />
      )}
    </Sheet>
  );
}

// ─── Expiring Documents Panel → expiring-docs (CSV button) ──────────────────

export function ExpiringDocsDrillCard({
  rows,
  ayCode,
}: CommonProps & { rows: ExpiringDocRow[] }) {
  const csvHref = `/api/records/drill/expiring-docs?ay=${ayCode}&scope=ay&format=csv`;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <a href={csvHref} download>
            <Download className="size-3.5" />
            Export CSV
          </a>
        </Button>
      </div>
      <ExpiringDocumentsPanel
        rows={rows}
        ayCode={ayCode}
        studentHrefBase="/records/students/by-enrolee"
        viewAllHref={`/records/students?ay=${ayCode}`}
      />
    </div>
  );
}
