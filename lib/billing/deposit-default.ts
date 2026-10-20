/**
 * Receive payment's Deposit to starts where QuickBooks starts it: the account
 * the company last deposited a payment to. Only Bank accounts are offered, so
 * if that account isn't one of them (Undeposited Funds, inactive, none, query
 * failed) the first Bank account is used.
 */
export function pickDefaultDeposit<T extends { id: string }>(
  choices: T[],
  lastUsedId: string | null | undefined
): T | undefined {
  return choices.find((c) => c.id === lastUsedId) ?? choices[0];
}
