'use client';

import * as React from 'react';
import { Download } from 'lucide-react';

import { DonutChart } from '@/components/dashboard/charts/donut-chart';
import { CompletionByLevelChart } from '@/components/p-files/completion-by-level-chart';
import { PFilesDrillSheet } from '@/components/p-files/drills/pfiles-drill-sheet';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import type {
  LevelCompletionRow,
  SlotStatusMix,
} from '@/lib/p-files/dashboard';

// Per-target client wrappers for P-Files chart cards. Drill sheets lazy-fetch
// rows via /api/p-files/drill (per spec §6.2 — P-Files row volume is too
// large to pre-fetch). Each wrapper owns its own Sheet open-state.

type CommonProps = {
  ayCode: string;
};

// ─── Slot Status Mix → slot-by-status ───────────────────────────────────────

export function SlotStatusDrillCard({
  slotMix,
  ayCode,
}: CommonProps & { slotMix: SlotStatusMix }) {
  const [status, setStatus] = React.useState<string | null>(null);
  // Renewal-only donut (KD #71). ⚠ THE "Expired" SLICE USED TO BE
  // `slotMix.missing`, which counted expired AND never-provided together — so
  // a document nobody had ever sent was reported to the officer as expired.
  // The two are now separate slices: a renewal is a chase, a missing document
  // is a first ask. The centre shows total tracked slots so it reconciles with
  // per-student completeness.
  const slices = [
    { name: 'On file', value: slotMix.valid },
    { name: 'Expired', value: slotMix.expired },
    { name: 'Never provided', value: slotMix.missing },
  ];
  // All statuses count toward "tracked" — aligns denominator with the slot
  // universe.
  const total =
    slotMix.valid +
    slotMix.expired +
    slotMix.missing +
    slotMix.pending +
    slotMix.rejected;
  return (
    <Sheet open={!!status} onOpenChange={(o) => !o && setStatus(null)}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Slot status mix
          </CardDescription>
          <CardTitle className="font-serif text-xl">
            Where documents stand
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DonutChart
            data={slices}
            centerValue={total}
            centerLabel="tracked"
            onSegmentClick={setStatus}
          />
          {total > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px] tabular-nums text-muted-foreground">
              <dt>On file</dt>
              <dd className="text-right">{slotMix.valid}</dd>
              <dt>Expired</dt>
              <dd className="text-right">{slotMix.expired}</dd>
              <dt>Never provided</dt>
              <dd className="text-right">{slotMix.missing}</dd>
              <dt>Awaiting validation</dt>
              <dd className="text-right">{slotMix.pending}</dd>
              <dt>Rejected</dt>
              <dd className="text-right">{slotMix.rejected}</dd>
            </dl>
          )}
        </CardContent>
      </Card>
      {status && (
        <PFilesDrillSheet
          target="slot-by-status"
          segment={status}
          ayCode={ayCode}
        />
      )}
    </Sheet>
  );
}

// ─── Completion by Level → level-applicants ─────────────────────────────────

export function CompletionByLevelDrillCard({
  data,
  ayCode,
}: CommonProps & { data: LevelCompletionRow[] }) {
  const [level, setLevel] = React.useState<string | null>(null);
  return (
    <Sheet open={!!level} onOpenChange={(o) => !o && setLevel(null)}>
      <CompletionByLevelChart data={data} onSegmentClick={setLevel} />
      {level && (
        <PFilesDrillSheet
          target="level-applicants"
          segment={level}
          ayCode={ayCode}
        />
      )}
    </Sheet>
  );
}

// ─── Completeness Table CSV button ──────────────────────────────────────────
// The Completeness Table already drills via row link to /p-files/[enroleeNumber].
// This wrapper just adds an Export CSV button above the existing table.

export function CompletenessCsvButton({ ayCode }: CommonProps) {
  const csvHref = `/api/p-files/drill/all-docs?ay=${ayCode}&format=csv`;
  return (
    <div className="flex justify-end">
      <Button asChild variant="outline" size="sm">
        <a href={csvHref} download>
          <Download className="size-3.5" />
          Export CSV
        </a>
      </Button>
    </div>
  );
}
