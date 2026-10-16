import { qboErrorMessage } from '@/lib/qbo/client';

/**
 * Record payment re-reads the customer before writing. Only a failed READ
 * (the history load threw — QuickBooks unreachable, or the SIS store refused)
 * stops the payment. Tile write problems (`errors`) don't: the balances and
 * credit were still read from QuickBooks, and the tiles are retried later.
 */
export function prePaymentRefusal(
  outcome: { errors: string[] } | Error
): string | null {
  if (outcome instanceof Error) return qboErrorMessage(outcome);
  return null;
}
