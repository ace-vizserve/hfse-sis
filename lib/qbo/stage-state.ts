// What a QuickBooks invoice does to the Registration / Fees stage.
// Spec: docs/superpowers/specs/2026-10-14-quickbooks-registration-fees-invoicing-design.md
// ("Status rules"). Pure — no database, no QuickBooks — so every row of the
// spec's two tables is a unit test.

export const QBO_STAGE_KEYS = ['registration', 'fees'] as const;
export type QboStageKey = (typeof QBO_STAGE_KEYS)[number];

export function isQboStageKey(v: string): v is QboStageKey {
  return (QBO_STAGE_KEYS as readonly string[]).includes(v);
}

export type InvoiceState = 'open' | 'paid' | 'voided';

export type StageSnapshot = {
  status: string | null;
  invoice: string | null;
  paymentDate: string | null;
  startDate: string | null;
};

export type StagePatch = {
  status?: string | null;
  invoice?: string | null;
  paymentDate?: string | null;
};

export const blank = (v: string | null | undefined) => !v || !v.trim();
const norm = (v: string | null | undefined) => (blank(v) ? null : v!.trim());
const sameDate = (a: string | null | undefined, b: string | null | undefined) =>
  (norm(a)?.slice(0, 10) ?? null) === (norm(b)?.slice(0, 10) ?? null);

/** Drop every key that already matches the stage; null when nothing is left. */
export function onlyChanges(
  patch: StagePatch,
  current: StageSnapshot
): StagePatch | null {
  const out: StagePatch = {};
  if (
    patch.status !== undefined &&
    norm(patch.status) !== norm(current.status)
  ) {
    out.status = patch.status;
  }
  if (
    patch.invoice !== undefined &&
    norm(patch.invoice) !== norm(current.invoice)
  ) {
    out.invoice = patch.invoice;
  }
  if (
    patch.paymentDate !== undefined &&
    !sameDate(patch.paymentDate, current.paymentDate)
  ) {
    out.paymentDate = patch.paymentDate;
  }
  return Object.keys(out).length > 0 ? out : null;
}
