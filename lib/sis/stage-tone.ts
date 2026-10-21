// Stage status → visual tone, for the Enrollment tab's stripes, journey-rail
// discs and group counts, the Records checklist stripes and the stage chips.
// Matched on the status value, trimmed and case-insensitive (a pattern match
// once read "Partially paid" and "Unpaid" as paid; legacy rows on other stages
// still hold lowercase values). Pure and client-safe.

export type StageTone = 'done' | 'failed' | 'pending' | 'active' | 'empty';

const key = (status: string | null | undefined) =>
  (status ?? '').trim().toLowerCase();

const TONE_BY_STATUS: Record<string, StageTone> = {
  finished: 'done',
  verified: 'done',
  paid: 'done',
  'not required': 'done',
  signed: 'done',
  claimed: 'done',
  enrolled: 'done',
  'enrolled (conditional)': 'done',
  cancelled: 'failed',
  withdrawn: 'failed',
  rejected: 'failed',
  expired: 'failed',
  pending: 'pending',
  incomplete: 'pending',
  'ready for invoicing': 'pending',
  overdue: 'pending',
  voided: 'pending',
  submitted: 'active',
  'ongoing verification': 'active',
  processing: 'active',
  'ongoing assessment': 'active',
  generated: 'active',
  sent: 'active',
  unpaid: 'active',
  'partially paid': 'active',
};

/** The count bucket of a stage status (done / pending / active / …). */
export function stageTone(status: string | null | undefined): StageTone {
  const s = key(status);
  if (!s) return 'empty';
  return TONE_BY_STATUS[s] ?? 'empty';
}

// ── Registration / Fees (spec 2026-10-21) ─────────────────────────────────
//
// THE ONE TONE TABLE for the two billing stages. The chip, the Enrollment tab
// stripe + rail disc, the Records checklist stripe and the plain status badge
// all read BILLING_STAGE_LOOK, so they can't disagree:
//   Paid, Not required → done (mint)     Overdue → destructive
//   Partially paid     → amber           Unpaid  → in progress (indigo)
//   Ready for invoicing → pending (amber, outline only — waiting to be billed)
//   Voided, Cancelled  → muted           Not set → blank

export type BillingStageTone =
  | 'blank'
  | 'ready'
  | 'unpaid'
  | 'partial'
  | 'overdue'
  | 'paid'
  | 'muted';

const BILLING_TONE_BY_STATUS: Record<string, BillingStageTone> = {
  'ready for invoicing': 'ready',
  unpaid: 'unpaid',
  'partially paid': 'partial',
  overdue: 'overdue',
  paid: 'paid',
  'not required': 'paid',
  voided: 'muted',
  cancelled: 'muted',
};

export function billingStageTone(
  status: string | null | undefined
): BillingStageTone {
  const s = key(status);
  if (!s) return 'blank';
  return BILLING_TONE_BY_STATUS[s] ?? 'muted';
}

/** A Registration / Fees status's look everywhere it shows. */
export type BillingStageLook = {
  /** Classes for the outline chip (StageStatusBadge with a billing stage). */
  chip: string;
  /** The 1-unit left stripe on a stage tile / checklist row. */
  stripe: string;
  /** Which journey-rail disc recipe it wears. */
  disc: StageTone;
  /** The gradient Badge variant when a plain status badge shows it. */
  badge: 'success' | 'default' | 'warning' | 'blocked' | 'muted';
};

export const BILLING_STAGE_LOOK: Record<BillingStageTone, BillingStageLook> = {
  blank: {
    chip: 'border-dashed border-hairline-strong bg-background text-ink-4',
    stripe: 'bg-border',
    disc: 'empty',
    badge: 'muted',
  },
  ready: {
    chip: 'border-brand-amber/60 bg-background text-ink',
    stripe: 'bg-brand-amber',
    disc: 'pending',
    badge: 'warning',
  },
  unpaid: {
    chip: 'border-brand-indigo/60 bg-background text-brand-indigo-deep',
    stripe: 'bg-brand-indigo',
    disc: 'active',
    badge: 'default',
  },
  partial: {
    chip: 'border-brand-amber/50 bg-brand-amber/10 text-ink',
    stripe: 'bg-brand-amber',
    disc: 'pending',
    badge: 'warning',
  },
  overdue: {
    chip: 'border-destructive/40 bg-destructive/10 text-destructive',
    stripe: 'bg-destructive',
    disc: 'failed',
    badge: 'blocked',
  },
  paid: {
    chip: 'border-brand-mint bg-brand-mint/30 text-ink',
    stripe: 'bg-brand-mint',
    disc: 'done',
    badge: 'success',
  },
  muted: {
    chip: 'border-hairline bg-muted text-ink-3',
    stripe: 'bg-muted-foreground/30',
    disc: 'empty',
    badge: 'muted',
  },
};

/** The stage keys whose status follows Billing. */
export function isBillingStage(
  stage: string | null | undefined
): stage is 'registration' | 'fees' {
  return stage === 'registration' || stage === 'fees';
}

/**
 * The look of a status that only Registration / Fees use (Cancelled too, which
 * reads muted everywhere it shows outside the Enrollment tab's buckets); null
 * for any other status.
 */
export function billingStatusLook(
  status: string | null | undefined
): BillingStageLook | null {
  const t = BILLING_TONE_BY_STATUS[key(status)];
  return t ? BILLING_STAGE_LOOK[t] : null;
}
