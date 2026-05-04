import {
  CalendarClockIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  FileSignatureIcon,
  FileWarningIcon,
  InboxIcon,
  LayoutGridIcon,
  MailQuestionIcon,
  PlaneIcon,
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
import type { LifecycleBlockerBucket } from '@/lib/sis/process';
import { LifecycleAggregateRow } from '@/components/sis/lifecycle-aggregate-row';

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
  'awaiting-document-validation': ClipboardCheckIcon,
  'awaiting-promised-documents': MailQuestionIcon,
  'awaiting-stp-completion': PlaneIcon,
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
  'awaiting-document-validation',
  'awaiting-promised-documents',
  'awaiting-stp-completion',
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
  ayCode,
}: {
  buckets: LifecycleBlockerBucket[];
  ayCode?: string;
}) {
  const sorted = sortBuckets(buckets);
  const totalCount = sorted.reduce((acc, b) => acc + b.count, 0);
  const allClear = sorted.every((b) => b.count === 0);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Enrolment lifecycle · what&apos;s holding up enrolment
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          What&apos;s holding up the enrolment funnel
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
            <LifecycleAggregateRow
              bucket={{
                key: 'all-clear',
                label: 'All clear',
                count: 0,
                severity: 'good',
                drillTarget: 'noop',
              }}
              iconKey={'check-circle' as const}
              titleOverride="All clear"
              bodyOverride="The funnel is fully unblocked."
              hideCount
            />
          ) : (
            sorted.map((bucket) => (
              <LifecycleAggregateRow
                key={bucket.key}
                bucket={bucket}
                iconKey={bucket.key as never}
                ayCode={ayCode}
              />
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

export default LifecycleAggregateCard;

// Severity → tile + chip + label mappings — exported so the client row
// component renders identically to this card's design language.
export const LIFECYCLE_SEVERITY_TILE = SEVERITY_TILE;
export const LIFECYCLE_SEVERITY_BADGE_COLOR = SEVERITY_BADGE_COLOR;
export const LIFECYCLE_SEVERITY_LABEL = SEVERITY_LABEL;
export const LIFECYCLE_BUCKET_ICON = BUCKET_ICON;
