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

export type InvoiceSnapshot = {
  docNumber: string;
  state: InvoiceState;
  paymentDate: string | null;
};

export type StagePatch = {
  status?: string | null;
  invoice?: string | null;
  paymentDate?: string | null;
};

const blank = (v: string | null | undefined) => !v || !v.trim();
const norm = (v: string | null | undefined) => (blank(v) ? null : v!.trim());
const sameDate = (a: string | null | undefined, b: string | null | undefined) =>
  (norm(a)?.slice(0, 10) ?? null) === (norm(b)?.slice(0, 10) ?? null);

/** Where the stage should end up for this invoice state, starting from `base`. */
function applyState(
  stage: QboStageKey,
  current: StageSnapshot,
  invoice: InvoiceSnapshot,
  base: StagePatch
): StagePatch {
  const status = base.status !== undefined ? base.status : current.status;

  if (invoice.state === 'voided') {
    return { status: 'Pending', invoice: null, paymentDate: null };
  }

  if (invoice.state === 'paid') {
    if (stage === 'registration') {
      return { ...base, status: 'Finished', paymentDate: invoice.paymentDate };
    }
    // Fees Paid needs a start date (STAGE_STATUS_REQUIRED_FIELDS). Without
    // one the payment date is still filled and the status waits.
    if (!blank(current.startDate)) {
      return { ...base, status: 'Paid', paymentDate: invoice.paymentDate };
    }
    return { ...base, paymentDate: invoice.paymentDate };
  }

  // Open. A stage that was finished on this invoice has reopened — a payment
  // was deleted or reduced in QuickBooks, and QuickBooks wins on money.
  if (stage === 'registration' && status === 'Finished') {
    return { ...base, status: 'Unpaid', paymentDate: null };
  }
  if (stage === 'fees' && status === 'Paid') {
    return { ...base, status: 'Invoiced', paymentDate: null };
  }
  return base;
}

/** Drop every key that already matches the stage; null when nothing is left. */
function onlyChanges(
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

/** Staff created or linked an invoice on this stage. */
export function stageOnNewInvoice(
  stage: QboStageKey,
  current: StageSnapshot,
  invoice: InvoiceSnapshot
): StagePatch | null {
  if (current.status === 'Cancelled') return null;
  const hadInvoice = !blank(current.invoice);
  const base: StagePatch = {
    status:
      stage === 'registration'
        ? 'Unpaid'
        : hadInvoice
          ? 'Re-invoiced'
          : 'Invoiced',
    invoice: invoice.docNumber,
    paymentDate: null,
  };
  return applyState(stage, current, invoice, base);
}

/** QuickBooks changed the stage's current invoice. */
export function stageOnInvoiceChange(
  stage: QboStageKey,
  current: StageSnapshot,
  invoice: InvoiceSnapshot
): StagePatch | null {
  if (current.status === 'Cancelled') return null;
  return onlyChanges(applyState(stage, current, invoice, {}), current);
}

/** Fees paid in QuickBooks, held back from Paid only by a missing start date. */
export function needsStartDate(
  stage: QboStageKey,
  current: StageSnapshot,
  state: InvoiceState | null
): boolean {
  return (
    stage === 'fees' &&
    state === 'paid' &&
    current.status !== 'Paid' &&
    current.status !== 'Cancelled' &&
    blank(current.startDate)
  );
}
