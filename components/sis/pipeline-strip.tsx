'use client';

import * as React from 'react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  BUCKET_FILL,
  BUCKET_LABEL,
} from '@/components/sis/stage-bucket-visuals';
import {
  bucketForAdmissionsStatus,
  type StageStatusBucket,
} from '@/lib/sis/process';
import { STAGE_KEYS, STAGE_LABELS, type StageKey } from '@/lib/schemas/sis';
import type { StudentListRow } from '@/lib/sis/queries';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────────────────────
// Per-row "pipeline progress strip" for the admissions applications table —
// 9 segments in STAGE_KEYS order, each filled by that stage's semantic
// bucket (done / in_progress / blocked / not_started). Click (or Enter/Space
// on the trigger) opens a popover with the literal per-stage status word +
// last-updated date. Segment fill and popover swatch read the SAME shared
// map (components/sis/stage-bucket-visuals.ts) — design system §10.2, no
// drift possible.
// ──────────────────────────────────────────────────────────────────────────

type StageAccessor = {
  status: (row: StudentListRow) => string | null;
  updatedAt: (row: StudentListRow) => string | null;
};

// Explicit per-stage field access — deliberately not a dynamic string index
// off STAGE_COLUMN_MAP, so a future field rename trips the TS compiler here
// instead of silently reading undefined.
const STAGE_ACCESSORS: Record<StageKey, StageAccessor> = {
  application: {
    status: (r) => r.applicationStatus,
    updatedAt: (r) => r.applicationUpdatedDate,
  },
  registration: {
    status: (r) => r.registrationStatus,
    updatedAt: (r) => r.registrationUpdateDate,
  },
  documents: {
    status: (r) => r.documentStatus,
    updatedAt: (r) => r.documentUpdatedDate,
  },
  assessment: {
    status: (r) => r.assessmentStatus,
    updatedAt: (r) => r.assessmentUpdatedDate,
  },
  contract: {
    status: (r) => r.contractStatus,
    updatedAt: (r) => r.contractUpdatedDate,
  },
  fees: {
    status: (r) => r.feeStatus,
    updatedAt: (r) => r.feeUpdatedDate,
  },
  class: {
    status: (r) => r.classStatus,
    updatedAt: (r) => r.classUpdatedDate,
  },
  supplies: {
    status: (r) => r.suppliesStatus,
    updatedAt: (r) => r.suppliesUpdatedDate,
  },
  orientation: {
    status: (r) => r.orientationStatus,
    updatedAt: (r) => r.orientationUpdatedDate,
  },
};

type StageEntry = {
  stageKey: StageKey;
  label: string;
  status: string | null;
  bucket: StageStatusBucket;
  updatedAt: string | null;
};

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

// Composes the trigger's accessible name — leads with what's notable
// (blocked, then in-progress stage names) so a screen reader / tooltip user
// gets the same "what needs attention" read a sighted user gets from color.
function summarize(entries: StageEntry[]): string {
  const blocked = entries.filter((e) => e.bucket === 'blocked');
  const inProgress = entries.filter((e) => e.bucket === 'in_progress');
  const doneCount = entries.filter((e) => e.bucket === 'done').length;
  const notStartedCount = entries.filter(
    (e) => e.bucket === 'not_started'
  ).length;

  const parts: string[] = [];
  if (blocked.length > 0) {
    parts.push(`${blocked.map((e) => e.label).join(', ')} blocked`);
  }
  if (inProgress.length > 0) {
    parts.push(`${inProgress.map((e) => e.label).join(', ')} in progress`);
  }
  if (doneCount > 0) parts.push(`${doneCount} done`);
  if (notStartedCount > 0) parts.push(`${notStartedCount} not started`);

  return parts.length > 0
    ? `Pipeline: ${parts.join(', ')}`
    : 'Pipeline: not started';
}

const BUCKET_ORDER: StageStatusBucket[] = [
  'done',
  'in_progress',
  'blocked',
  'not_started',
];

export type PipelineStripProps = {
  row: StudentListRow;
};

export function PipelineStrip({ row }: PipelineStripProps) {
  const entries = React.useMemo<StageEntry[]>(
    () =>
      STAGE_KEYS.map((stageKey) => {
        const accessor = STAGE_ACCESSORS[stageKey];
        const status = accessor.status(row);
        return {
          stageKey,
          label: STAGE_LABELS[stageKey],
          status,
          bucket: bucketForAdmissionsStatus(stageKey, status),
          updatedAt: accessor.updatedAt(row),
        };
      }),
    [row]
  );

  const summary = React.useMemo(() => summarize(entries), [entries]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={summary}
          title={summary}
          className="flex h-5 w-[160px] items-stretch gap-px overflow-hidden rounded-full outline-hidden transition-transform focus-visible:ring-2 focus-visible:ring-ring hover:scale-[1.02]"
        >
          {entries.map((entry) => (
            <span
              key={entry.stageKey}
              aria-hidden
              className={cn('flex-1', BUCKET_FILL[entry.bucket])}
            />
          ))}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Pipeline · 9 stages
          </p>
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li
                key={entry.stageKey}
                className="flex items-center justify-between gap-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      'size-2.5 shrink-0 rounded-full',
                      BUCKET_FILL[entry.bucket]
                    )}
                  />
                  <span className="truncate text-[13px] font-medium text-foreground">
                    {entry.label}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-right">
                  <span className="text-[12px] text-muted-foreground">
                    {entry.status ?? 'Not started'}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {formatUpdatedAt(entry.updatedAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline pt-2.5">
            {BUCKET_ORDER.map((bucket) => (
              <span key={bucket} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn('size-2 rounded-full', BUCKET_FILL[bucket])}
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  {BUCKET_LABEL[bucket]}
                </span>
              </span>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
