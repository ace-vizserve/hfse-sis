import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  billingStageTone,
  type BillingStageTone,
} from '@/lib/billing/stage-card';
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
  Paid: 'success',
  Claimed: 'success',
  // Conditional / pending — needs admin action soon
  Pending: 'warning',
  Incomplete: 'warning',
  Uploaded: 'warning',
  'To follow': 'warning',
  'Partially paid': 'warning',
  // Hard-stop terminal failures
  Rejected: 'blocked',
  Expired: 'blocked',
  Overdue: 'blocked',
  // In-progress — currently being worked on
  'Ongoing Assessment': 'default',
  Generated: 'default',
  Sent: 'default',
  'Ready for invoicing': 'default',
  Unpaid: 'default',
  // Neutral terminal
  Cancelled: 'muted',
  Withdrawn: 'muted',
  Voided: 'muted',
  'Not required': 'muted',
};

// Registration and Fees (spec 2026-10-21): eight statuses, several of them
// money states that sit side by side on one card, so each gets its own §9.3
// wash — the gradient variants above would paint Ready for invoicing and
// Unpaid alike. Same recipes as Billing's invoice badges.
export const BILLING_STAGE_CHIP: Record<BillingStageTone, string> = {
  blank: 'border-dashed border-hairline-strong bg-background text-ink-4',
  ready: 'border-brand-indigo-soft bg-accent text-brand-indigo-deep',
  unpaid: 'border-brand-indigo/60 bg-background text-brand-indigo-deep',
  partial: 'border-brand-amber/50 bg-brand-amber/10 text-ink',
  overdue: 'border-destructive/40 bg-destructive/10 text-destructive',
  paid: 'border-brand-mint bg-brand-mint/30 text-ink',
  muted: 'border-hairline bg-muted text-ink-3',
};

export function StageStatusBadge({
  status,
  stage,
}: {
  status: string | null | undefined;
  /** Registration / Fees read their own chip recipes (blank = "Not set"). */
  stage?: string;
}) {
  const v = (status ?? '').trim();
  if (stage === 'registration' || stage === 'fees') {
    return (
      <Badge
        variant="outline"
        className={cn(
          'h-6 shadow-none',
          BILLING_STAGE_CHIP[billingStageTone(v)]
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
  const variant = STAGE_VARIANT[v] ?? 'muted';
  return <Badge variant={variant}>{v}</Badge>;
}
