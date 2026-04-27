import Link from 'next/link';
import { AlertTriangleIcon } from 'lucide-react';

import {
  ChartLegendChip,
  type ChartLegendChipColor,
} from '@/components/dashboard/chart-legend-chip';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { EnrollmentHistoryEntry } from '@/lib/sis/queries';
import type {
  LifecycleStageRow,
  StageStatusBucket,
  StudentLifecycleSnapshot,
} from '@/lib/sis/process';

// ──────────────────────────────────────────────────────────────────────────
// Bucket → ChartLegendChip + dot color tables. The chip carries the bucket
// label across the rest of the app's visual language; the dot on the rail is
// just the chip's gradient compressed to a 12px disc.
// ──────────────────────────────────────────────────────────────────────────

const BUCKET_CHIP_COLOR: Record<StageStatusBucket, ChartLegendChipColor> = {
  done: 'fresh',
  in_progress: 'primary',
  blocked: 'very-stale',
  not_started: 'neutral',
};

const BUCKET_LABEL: Record<StageStatusBucket, string> = {
  done: 'Done',
  in_progress: 'In progress',
  blocked: 'Blocked',
  not_started: 'Not started',
};

// Rail-dot gradient — same gradient pair the chip uses, but rendered as a
// solid disc so the timeline reads as a connected progression.
const BUCKET_DOT: Record<StageStatusBucket, string> = {
  done: 'bg-gradient-to-b from-chart-5 to-chart-3 ring-2 ring-chart-5/30',
  in_progress: 'bg-gradient-to-b from-brand-indigo to-brand-navy ring-2 ring-brand-indigo/25',
  blocked: 'bg-gradient-to-b from-destructive to-destructive/80 ring-2 ring-destructive/30',
  not_started: 'bg-ink-3 ring-2 ring-ink-3/30',
};

function formatTimestamp(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

export type StudentLifecycleTimelineProps = {
  snapshot: StudentLifecycleSnapshot;
  history?: EnrollmentHistoryEntry[];
  // Optional title override; defaults to "Student lifecycle".
  title?: string;
};

export function StudentLifecycleTimeline({
  snapshot,
  history = [],
  title = 'Student lifecycle',
}: StudentLifecycleTimelineProps) {
  const isWithdrawn = !!snapshot.withdrawn;
  const completedRows = snapshot.rows.filter((r) => r.bucket === 'done').length;

  // Other-AY chips — exclude the current AY entry. Sort newest-first so prior
  // years line up reading right-to-left in chronological feel.
  const otherAyEntries = history
    .filter((h) => h.ayCode !== snapshot.ayCode)
    .sort((a, b) => b.ayCode.localeCompare(a.ayCode));

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Lifecycle · {snapshot.ayCode} · {completedRows}/{snapshot.rows.length} stages done
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        <CardAction>
          <ChartLegendChip
            color={isWithdrawn ? 'very-stale' : 'primary'}
            label={isWithdrawn ? 'Withdrawn' : (snapshot.applicationStatus ?? 'In funnel')}
          />
        </CardAction>
      </CardHeader>

      {/* Cross-AY chip strip — only when the student has been in prior years.
          Each chip deep-links to that AY's enroleeNumber detail page. */}
      {otherAyEntries.length > 0 && (
        <div className="border-t border-hairline bg-muted/20 px-5 py-2.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Prior years
            </span>
            {otherAyEntries.map((entry) => (
              <Link
                key={entry.ayCode + entry.enroleeNumber}
                href={`/admissions/applications/${entry.enroleeNumber}`}
                className="group inline-flex items-center gap-1.5 rounded-md border border-hairline bg-card px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground transition-colors hover:border-brand-indigo/40 hover:bg-muted/40"
              >
                <span>{entry.ayCode}</span>
                {entry.level && (
                  <span className="text-muted-foreground">· {entry.level}</span>
                )}
                {entry.status && (
                  <span className="text-muted-foreground">· {entry.status}</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Withdrawn pill — top-pinned amber alert when applicable. */}
      {isWithdrawn && (
        <div className="border-t border-hairline bg-brand-amber/10 px-5 py-3">
          <div className="flex items-start gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-amber text-ink shadow-brand-tile-amber">
              <AlertTriangleIcon className="size-4" strokeWidth={2.25} />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="font-serif text-[14px] font-semibold leading-snug text-foreground">
                Withdrawn
                {snapshot.withdrawn?.date
                  ? ` on ${formatTimestamp(snapshot.withdrawn.date) ?? snapshot.withdrawn.date}`
                  : ''}
              </p>
              {snapshot.withdrawn?.reason && (
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  {snapshot.withdrawn.reason}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Optional fetchWarnings — small muted strip surfaces partial-data
          conditions without tearing down the timeline. */}
      {snapshot.fetchWarnings.length > 0 && (
        <div className="border-t border-hairline bg-muted/20 px-5 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Partial data · {snapshot.fetchWarnings.length} source{snapshot.fetchWarnings.length === 1 ? '' : 's'} unreachable
        </div>
      )}

      <CardContent className="p-0">
        <ol className={cn('divide-y divide-hairline', isWithdrawn && 'opacity-60')}>
          {snapshot.rows.map((row, i) => (
            <TimelineRow
              key={`${row.stageKey}-${i}`}
              row={row}
              isLast={i === snapshot.rows.length - 1}
            />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Row — left rail dot + line, right column label + chip + detail.
// ──────────────────────────────────────────────────────────────────────────

function TimelineRow({ row, isLast }: { row: LifecycleStageRow; isLast: boolean }) {
  const timestamp = formatTimestamp(row.updatedAt);
  return (
    <li className="relative px-5 py-3.5 transition-colors hover:bg-muted/30">
      <div className="flex items-start gap-4">
        {/* Rail column — vertical line + dot. The dot's color encodes bucket;
            the line is a hairline that connects all rows into a single timeline. */}
        <div className="relative flex w-3 shrink-0 justify-center">
          {!isLast && (
            <span
              className="absolute left-1/2 top-3.5 h-[calc(100%+_1.5rem)] w-px -translate-x-1/2 bg-hairline"
              aria-hidden
            />
          )}
          <span
            className={cn(
              'relative z-10 size-3 shrink-0 rounded-full',
              BUCKET_DOT[row.bucket],
            )}
            aria-hidden
          />
        </div>

        {/* Content column — label + chip + detail + timestamp. */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-serif text-[14px] font-semibold leading-snug text-foreground">
              {row.label}
            </span>
            <ChartLegendChip
              color={BUCKET_CHIP_COLOR[row.bucket]}
              label={BUCKET_LABEL[row.bucket]}
            />
            {timestamp && (
              <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
                {timestamp}
              </span>
            )}
          </div>
          {row.detail && (
            <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
              {row.detail}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
