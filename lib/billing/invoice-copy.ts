// More actions → Make a copy (as QuickBooks): the invoice page puts this
// invoice's lines in the tab's sessionStorage and opens Create invoice on the
// customer page, which takes them once. Nothing is stored anywhere else.

export type InvoiceCopy = {
  /** The invoice copied, for the form's note. */
  from: string | null;
  lines: Array<{
    itemId: string;
    description: string;
    qty: number;
    unitPrice: number;
  }>;
  memo: string | null;
};

const key = (studentNumber: string) => `billing:invoice-copy:${studentNumber}`;

export function stashInvoiceCopy(studentNumber: string, copy: InvoiceCopy) {
  try {
    sessionStorage.setItem(key(studentNumber), JSON.stringify(copy));
  } catch {
    // Storage blocked: the form opens empty, as a new invoice.
  }
}

/** The copy waiting for this student's Create invoice, if any. Null on the
 *  server (no sessionStorage) and when storage is blocked. */
export function readInvoiceCopy(studentNumber: string): InvoiceCopy | null {
  try {
    const raw = sessionStorage.getItem(key(studentNumber));
    if (!raw) return null;
    const v = JSON.parse(raw) as InvoiceCopy;
    return Array.isArray(v?.lines) && v.lines.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Clears the copy once the form has it, so a later Create invoice opens empty. */
export function clearInvoiceCopy(studentNumber: string) {
  try {
    sessionStorage.removeItem(key(studentNumber));
  } catch {
    // Nothing stored.
  }
}
