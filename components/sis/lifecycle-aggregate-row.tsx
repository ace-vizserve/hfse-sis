'use client';

import * as React from 'react';
import { ArrowRightIcon, CheckCircle2Icon, InboxIcon } from 'lucide-react';

import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { LifecycleDrillSheet } from '@/components/sis/drills/lifecycle-drill-sheet';
import { isLifecycleDrillTarget } from '@/lib/sis/drill';
import {
  LIFECYCLE_BUCKET_ICON,
  LIFECYCLE_SEVERITY_BADGE_COLOR,
  LIFECYCLE_SEVERITY_LABEL,
  LIFECYCLE_SEVERITY_TILE,
} from '@/components/sis/lifecycle-aggregate-card';
import type { LifecycleBlockerBucket } from '@/lib/sis/process';

/**
 * LifecycleAggregateRow — one row in the LifecycleAggregateCard. When the
 * bucket's drillTarget matches a known LifecycleDrillTarget AND the count is
 * non-zero, the row becomes a Sheet trigger that opens the LifecycleDrillSheet.
 * Otherwise it renders as a static `<li>` (used for the "All clear" empty
 * state and the awaiting-stp-completion bucket whose drill loader isn't wired
 * yet — falls through gracefully).
 */
export function LifecycleAggregateRow({
  bucket,
  iconKey,
  ayCode,
  titleOverride,
  bodyOverride,
  hideCount,
}: {
  bucket: LifecycleBlockerBucket;
  iconKey: string;
  ayCode?: string;
  titleOverride?: string;
  bodyOverride?: string;
  hideCount?: boolean;
}) {
  const title = titleOverride ?? bucket.label;
  const body =
    bodyOverride ??
    `${bucket.count.toLocaleString('en-SG')} student${bucket.count === 1 ? '' : 's'}`;

  const Icon =
    iconKey === 'check-circle'
      ? CheckCircle2Icon
      : (LIFECYCLE_BUCKET_ICON[iconKey] ?? InboxIcon);

  const isDrillable =
    !!ayCode &&
    bucket.count > 0 &&
    typeof bucket.drillTarget === 'string' &&
    isLifecycleDrillTarget(bucket.drillTarget);

  const inner = (
    <div className="flex items-start gap-4 px-5 py-4 transition-colors group-hover:bg-muted/30">
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-xl [&>svg]:size-[18px]',
          LIFECYCLE_SEVERITY_TILE[bucket.severity],
        )}
      >
        <Icon strokeWidth={2.25} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex items-center gap-1.5 font-serif text-[15px] font-semibold leading-snug text-foreground">
          {title}
          {isDrillable && (
            <ArrowRightIcon
              className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand-indigo"
              strokeWidth={2.25}
              aria-hidden
            />
          )}
        </p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {!hideCount && (
          <span className="font-mono text-xl font-bold tabular-nums text-foreground">
            {bucket.count.toLocaleString('en-SG')}
          </span>
        )}
        <ChartLegendChip
          color={LIFECYCLE_SEVERITY_BADGE_COLOR[bucket.severity]}
          label={LIFECYCLE_SEVERITY_LABEL[bucket.severity]}
        />
      </div>
    </div>
  );

  if (!isDrillable || !ayCode) {
    return <li className="group">{inner}</li>;
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <li className="group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40">
          {inner}
        </li>
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-4xl overflow-y-auto p-0 sm:max-w-4xl">
        <LifecycleDrillSheet
          target={bucket.drillTarget as Parameters<typeof LifecycleDrillSheet>[0]['target']}
          ayCode={ayCode}
        />
      </SheetContent>
    </Sheet>
  );
}
