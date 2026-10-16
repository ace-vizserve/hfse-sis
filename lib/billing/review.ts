// To review: why a student is there, the name a new QuickBooks customer gets,
// and which year group they show under. Pure.

import { ALREADY_LINKED_REASON } from '@/lib/billing/link-claims';

export type ReviewGroupKey = string;

export function reviewReason(candidates: Array<{ reason: string }>): string {
  if (candidates.length === 0) return 'No QuickBooks customer has this name';
  if (candidates.some((c) => c.reason === ALREADY_LINKED_REASON))
    return 'The matching customer is already linked to another student';
  if (candidates.some((c) => c.reason === 'typed invoice number'))
    return "The typed invoice number belongs to a customer with another name — often a sibling's";
  if (candidates.length > 1)
    return 'More than one QuickBooks customer has this name';
  return 'Needs a person to check';
}

/** HFSE's customer naming (production export): "SURNAME, Given M." */
export function hfseCustomerName(s: {
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
}): string | null {
  const last = s.lastName?.trim();
  const first = s.firstName?.trim();
  if (!last || !first) return null;
  const mi = s.middleName?.trim()
    ? ` ${s.middleName.trim()[0].toUpperCase()}.`
    : '';
  return `${last.toUpperCase()}, ${first}${mi}`;
}

/** The group a student shows under: the current or upcoming AY, else "earlier". */
export function groupForReview(args: {
  ayCode: string | null;
  current: string | null;
  upcoming: string | null;
}): ReviewGroupKey {
  if (
    args.ayCode &&
    (args.ayCode === args.current || args.ayCode === args.upcoming)
  )
    return args.ayCode;
  return 'earlier';
}
