import { createHash } from 'node:crypto';

// QuickBooks caps a requestid at 50 characters.
const MAX_REQUEST_ID = 50;

/**
 * The requestid of one credit-payment update in Record payment / Use credit,
 * keyed by the credit payment's own id. A position-based id (`-c0`, `-c1`)
 * was unsafe: a retry re-plans from fresh QuickBooks figures, so `-c0` could
 * name a different credit payment than it did the first time, and QuickBooks
 * would replay the first answer for it — reporting a credit as applied when
 * it wasn't. Keyed by payment id, a replay is always of the same payment.
 * An id too long to fit is replaced by a stable short hash.
 */
export function creditRequestId(requestId: string, paymentId: string): string {
  const plain = `${requestId}-p${paymentId}`;
  if (plain.length <= MAX_REQUEST_ID) return plain;
  const hash = createHash('sha1').update(paymentId).digest('hex').slice(0, 8);
  return `${requestId}-p${hash}`;
}
