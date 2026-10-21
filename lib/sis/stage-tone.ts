// Stage status → visual tone, for the Enrollment tab's stripes, journey-rail
// discs and group counts. Matched on EXACT status values (a pattern match
// once read "Partially paid" and "Unpaid" as paid). Pure.
//
// Registration / Fees (spec 2026-10-21): Paid and Not required are done;
// Ready for invoicing reads as waiting to be invoiced, and Overdue / Voided
// need someone too (pending); Unpaid / Partially paid are in flight.

export type StageTone = 'done' | 'failed' | 'pending' | 'active' | 'empty';

const TONE_BY_STATUS: Record<string, StageTone> = {
  Finished: 'done',
  Verified: 'done',
  Paid: 'done',
  'Not required': 'done',
  Signed: 'done',
  Claimed: 'done',
  Enrolled: 'done',
  'Enrolled (Conditional)': 'done',
  Cancelled: 'failed',
  Withdrawn: 'failed',
  Rejected: 'failed',
  Expired: 'failed',
  Pending: 'pending',
  Incomplete: 'pending',
  'Ready for invoicing': 'pending',
  Overdue: 'pending',
  Voided: 'pending',
  Submitted: 'active',
  'Ongoing Verification': 'active',
  Processing: 'active',
  'Ongoing Assessment': 'active',
  Generated: 'active',
  Sent: 'active',
  Unpaid: 'active',
  'Partially paid': 'active',
};

export function stageTone(status: string | null | undefined): StageTone {
  const s = (status ?? '').trim();
  if (!s) return 'empty';
  return TONE_BY_STATUS[s] ?? 'empty';
}
