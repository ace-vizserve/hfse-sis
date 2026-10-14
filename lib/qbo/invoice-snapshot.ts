import type { InvoiceState } from '@/lib/qbo/stage-state';

/** The fields of a QuickBooks Invoice the SIS reads. */
export type QbInvoice = {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt: number;
  Balance: number;
  SyncToken: string;
  PrivateNote?: string;
  CustomerRef: { value: string; name?: string };
  LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
};

/**
 * Open / paid / voided, as QuickBooks shows it. A void zeroes the invoice and
 * prefixes its private note with "Voided" (seen in the sandbox spike, 2026-10-13).
 * `null` means QuickBooks no longer has it (deleted) — treated as voided.
 */
export function invoiceState(inv: QbInvoice | null): InvoiceState {
  if (!inv) return 'voided';
  if (Number(inv.TotalAmt) === 0 && /^voided/i.test(inv.PrivateNote ?? '')) {
    return 'voided';
  }
  if (Number(inv.Balance) === 0 && Number(inv.TotalAmt) > 0) return 'paid';
  return 'open';
}

export function linkedPaymentIds(inv: QbInvoice): string[] {
  return (inv.LinkedTxn ?? [])
    .filter((t) => t.TxnType === 'Payment')
    .map((t) => t.TxnId);
}

export function latestDate(
  dates: Array<string | null | undefined>
): string | null {
  const real = dates
    .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d))
    .map((d) => d.slice(0, 10))
    .sort();
  return real.length ? real[real.length - 1] : null;
}
