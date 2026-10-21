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
  /** Memo on statement (PrivateNote); Make a copy carries it too. */
  statementMemo?: string | null;
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

/** An invoice's "Create a credit note" (QuickBooks' More actions): the
 *  invoice's lines and statement message, waiting for the Credit note form. */
export type CreditNoteStart = {
  from: string | null;
  lines: Array<{
    itemId: string;
    itemName?: string | null;
    description: string;
    qty: number;
    unitPrice: number;
  }>;
  statementMessage: string | null;
};

const cnKey = (studentNumber: string) =>
  `billing:credit-note-start:${studentNumber}`;

export function stashCreditNoteStart(
  studentNumber: string,
  start: CreditNoteStart
) {
  try {
    sessionStorage.setItem(cnKey(studentNumber), JSON.stringify(start));
  } catch {
    // Storage blocked: the form opens empty.
  }
}

export function readCreditNoteStart(
  studentNumber: string
): CreditNoteStart | null {
  try {
    const raw = sessionStorage.getItem(cnKey(studentNumber));
    if (!raw) return null;
    const v = JSON.parse(raw) as CreditNoteStart;
    return Array.isArray(v?.lines) && v.lines.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function clearCreditNoteStart(studentNumber: string) {
  try {
    sessionStorage.removeItem(cnKey(studentNumber));
  } catch {
    // Nothing stored.
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
