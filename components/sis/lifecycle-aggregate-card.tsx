import {
  CalendarClockIcon,
  CheckCircle2Icon,
  FileSignatureIcon,
  FileWarningIcon,
  InboxIcon,
  LayoutGridIcon,
  SparklesIcon,
  WalletIcon,
  type LucideIcon,
} from 'lucide-react';

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
import type { LifecycleBlockerBucket } from '@/lib/sis/process';

/**
 * LifecycleAggregateCard — top-level "What's blocking the funnel" card for
 * the SIS hub. Composes off `getLifecycleAggregate()`'s 7-bucket payload from
 * `lib/sis/process.ts`.
 *
 * Visual language follows `<InsightsPanel>`: editorial rows with size-10 §7.4
 * gradient icon tile on the left, serif label + small muted body in the middle,
 * large tabular-nums count + severity ChartLegendChip on the right. Severity
 * mapping mirrors InsightsPanel so the two cards read as siblings.
 *
 * Sort: `ungated-to-enroll` (positive signal) is pinned to the top, then
 * blockers descend bad → warn → info.
 */

type Severity = LifecycleBlockerBucket['severity'];

// §7.4 crafted gradient icon tile per severity — matches InsightsPanel exactly.
const SEVERITY_TILE: Record<Severity, string> = {
  good: 'bg-gradient-to-br from-brand-mint to-brand-sky text-ink shadow-brand-tile-mint',
  warn: 'bg-brand-amber text-ink shadow-brand-tile-amber',
  bad: 'bg-destructive text-destructive-foreground shadow-brand-tile-destructive',
  info: 'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile',
};

const SEVERITY_BADGE_COLOR: Record<Severity, ChartLegendChipColor> = {
  good: 'fresh',
  warn: 'stale',
  bad: 'very-stale',
  info: 'primary',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  good: 'Good',
  warn: 'Watch',
  bad: 'Alert',
  info: 'Info',
};

// Per-bucket Lucide icon — semantic match to the bucket's intent.
const BUCKET_ICON: Record<string, LucideIcon> = {
  'awaiting-fee-payment': WalletIcon,
  'awaiting-document-revalidation': FileWarningIcon,
  'awaiting-assessment-schedule': CalendarClockIcon,
  'awaiting-contract-signature': FileSignatureIcon,
  'missing-class-assignment': LayoutGridIcon,
  'ungated-to-enroll': SparklesIcon,
  'new-applications': InboxIcon,
};

// Sort order after the ungated-to-enroll pin. Ordered bad → warn → info,
// roughly "most urgent funnel blocker first".
const REMAINDER_ORDER: string[] = [
  'awaiting-document-revalidation',
  'missing-class-assignment',
  'awaiting-fee-payment',
  'awaiting-contract-signature',
  'awaiting-assessment-schedule',
  'new-applications',
];

function sortBuckets(buckets: LifecycleBlockerBucket[]): LifecycleBlockerBucket[] {
  const byKey = new Map(buckets.map((b) => [b.key, b] as const));
  const ordered: LifecycleBlockerBucket[] = [];
  const ungated = byKey.get('ungated-to-enroll');
  if (ungated) ordered.push(ungated);
  for (const key of REMAINDER_ORDER) {
    const b = byKey.get(key);
    if (b) ordered.push(b);
  }
  // Append any unrecognised keys at the end so additions don't drop silently.
  for (const b of buckets) {
    if (!ordered.includes(b)) ordered.push(b);
  }
  return ordered;
}

export function LifecycleAggregateCard({
  buckets,
}: {
  buckets: LifecycleBlockerBucket[];
}) {
  const sorted = sortBuckets(buckets);
  const totalCount = sorted.reduce((acc, b) => acc + b.count, 0);
  const allClear = sorted.every((b) => b.count === 0);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Lifecycle · pipeline blockers
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          What&apos;s blocking the funnel
        </CardTitle>
        <CardAction>
          <ChartLegendChip
            color={allClear ? 'fresh' : 'primary'}
            label={allClear ? 'All clear' : `${totalCount} flagged`}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-hairline">
          {allClear ? (
            <BucketRow
              bucket={{
                key: 'all-clear',
                label: 'All clear',
                count: 0,
                severity: 'good',
                drillTarget: 'noop',
              }}
              icon={CheckCircle2Icon}
              titleOverride="All clear"
              bodyOverride="The funnel is fully unblocked."
              hideCount
            />
          ) : (
            sorted.map((bucket) => (
              <BucketRow
                key={bucket.key}
                bucket={bucket}
                icon={BUCKET_ICON[bucket.key] ?? InboxIcon}
              />
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

export default LifecycleAggregateCard;

function BucketRow({
  bucket,
  icon: Icon,
  titleOverride,
  bodyOverride,
  hideCount,
}: {
  bucket: LifecycleBlockerBucket;
  icon: LucideIcon;
  titleOverride?: string;
  bodyOverride?: string;
  hideCount?: boolean;
}) {
  // TODO: wire to drill API in Wave 3 — drillTarget: ${bucket.drillTarget}
  const title = titleOverride ?? bucket.label;
  const body =
    bodyOverride ??
    `${bucket.count.toLocaleString('en-SG')} student${bucket.count === 1 ? '' : 's'}`;

  return (
    <li className="group flex items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/30">
      {/* Crafted gradient icon tile — §7.4 pattern, severity-mapped. */}
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-xl [&>svg]:size-[18px]',
          SEVERITY_TILE[bucket.severity],
        )}
      >
        <Icon strokeWidth={2.25} />
      </div>
      {/* Middle column — serif label + muted body. */}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-serif text-[15px] font-semibold leading-snug text-foreground">
          {title}
        </p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
      {/* Right column — large tabular-nums count + severity chip. */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {!hideCount && (
          <span className="font-mono text-xl font-bold tabular-nums text-foreground">
            {bucket.count.toLocaleString('en-SG')}
          </span>
        )}
        <ChartLegendChip
          color={SEVERITY_BADGE_COLOR[bucket.severity]}
          label={SEVERITY_LABEL[bucket.severity]}
        />
      </div>
    </li>
  );
}
