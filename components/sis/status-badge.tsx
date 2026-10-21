import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  BILLING_STAGE_LOOK,
  billingStageTone,
  billingStatusLook,
  isBillingStage,
} from '@/lib/sis/stage-tone';
import { cn } from '@/lib/utils';

// Status badges read severity at a glance through one of five semantic
// recipes. Per docs/context/09a-design-patterns.md §9.1 + §9.3 — gradient
// Badge variants (success / warning / blocked / default / muted) carry the
// non-flat status pill voice that's used app-wide for state pills
// (change-request status, lifecycle widget, attendance, etc).
//
// Mapping rules:
//   success  — healthy / verified / done / paid
//   default  — informational / in-progress (indigo gradient)
//   warning  — conditional / pending / needs attention
//   blocked  — rejected / failed / hard-stop
//   muted    — neutral terminal (withdrawn / archived / unknown)
//
// Anything not mapped falls through to MUTED so unfamiliar values surface
// rather than vanish.

type StatusVariant = NonNullable<BadgeProps['variant']>;

const STAGE_VARIANT: Record<string, StatusVariant> = {
  // Healthy / done states
  Finished: 'success',
  Signed: 'success',
  Valid: 'success',
  Verified: 'success',
  Claimed: 'success',
  // Conditional / pending — needs admin action soon
  Pending: 'warning',
  Incomplete: 'warning',
  Uploaded: 'warning',
  'To follow': 'warning',
  // Hard-stop terminal failures
  Rejected: 'blocked',
  Expired: 'blocked',
  // In-progress — currently being worked on
  'Ongoing Assessment': 'default',
  Generated: 'default',
  Sent: 'default',
  // Neutral terminal
  Withdrawn: 'muted',
};

// Registration and Fees statuses (Paid, Unpaid, Overdue, Ready for invoicing,
// …) read the one tone table, lib/sis/stage-tone.ts BILLING_STAGE_LOOK: its
// chip on a stage card, its `badge` variant anywhere else.
function variantOf(status: string): StatusVariant {
  return STAGE_VARIANT[status] ?? billingStatusLook(status)?.badge ?? 'muted';
}

export function StageStatusBadge({
  status,
  stage,
}: {
  status: string | null | undefined;
  /** Registration / Fees read their own chip recipes (blank = "Not set"). */
  stage?: string;
}) {
  const v = (status ?? '').trim();
  if (isBillingStage(stage)) {
    return (
      <Badge
        variant="outline"
        className={cn(
          'h-6 shadow-none',
          BILLING_STAGE_LOOK[billingStageTone(v)].chip
        )}
      >
        {v || 'Not set'}
      </Badge>
    );
  }
  if (!v) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        —
      </span>
    );
  }
  return <Badge variant={variantOf(v)}>{v}</Badge>;
}
