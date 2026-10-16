import { SIS_READ_FAILED } from '@/lib/billing/messages';
import {
  QboError,
  qboErrorMessage,
  QboNotConnectedError,
} from '@/lib/qbo/client';

/** A network-level failure reaching QuickBooks (fetch throws these). */
function isNetworkError(e: Error): boolean {
  return (
    e.name === 'TypeError' ||
    e.name === 'AbortError' ||
    e.name === 'TimeoutError'
  );
}

/**
 * Record payment re-reads the customer before writing. Only a failed READ
 * (the history load threw) stops the payment. Tile write problems (`errors`)
 * don't: the balances and credit were still read from QuickBooks, and the
 * tiles are retried later. A QuickBooks failure gets the QuickBooks sentence;
 * anything else (the SIS store refused) gets the SIS one.
 */
export function prePaymentRefusal(
  outcome: { errors: string[] } | Error
): string | null {
  if (!(outcome instanceof Error)) return null;
  if (
    outcome instanceof QboError ||
    outcome instanceof QboNotConnectedError ||
    isNetworkError(outcome)
  )
    return qboErrorMessage(outcome);
  return SIS_READ_FAILED;
}
