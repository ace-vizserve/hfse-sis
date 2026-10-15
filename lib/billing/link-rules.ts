// Which QuickBooks customer is this student? Spec "Linking customers":
// 1 typed invoice number → its customer; 2 several customers (a sibling's
// number was typed) → the one with the same name; 3 exactly one customer with
// the same name; 4 anything else → a person picks (review). Pure.

import { cleanDocNumber, customerNameKey, nameKey } from '@/lib/billing/names';

export { cleanDocNumber, customerNameKey, nameKey } from '@/lib/billing/names';

export type LinkCustomer = { id: string; displayName: string };
export type LinkIndex = {
  customers: Map<string, LinkCustomer>;
  byDocNumber: Map<string, string>;
  byNameKey: Map<string, string[]>;
};
export type LinkStudent = {
  studentNumber: string;
  lastName: string | null;
  firstName: string | null;
  typedNumbers: string[];
};
export type LinkReason = 'invoice' | 'sibling' | 'name';
export type LinkProposal =
  | { kind: 'link'; customerId: string; reason: LinkReason }
  | {
      kind: 'review';
      candidates: Array<{
        customerId: string;
        displayName: string;
        reason: string;
      }>;
    };

const isSub = (c: LinkCustomer) => c.displayName.includes(':');

export function buildLinkIndex(
  customers: LinkCustomer[],
  invoices: Array<{ docNumber: string | null; customerId: string }>
): LinkIndex {
  const map = new Map<string, LinkCustomer>();
  const byNameKey = new Map<string, string[]>();
  for (const c of customers) {
    if (isSub(c)) continue;
    map.set(c.id, c);
    const k = customerNameKey(c.displayName);
    if (k) byNameKey.set(k, [...(byNameKey.get(k) ?? []), c.id]);
  }
  const byDocNumber = new Map<string, string>();
  for (const inv of invoices) {
    const doc = cleanDocNumber(inv.docNumber);
    if (doc && map.has(inv.customerId)) byDocNumber.set(doc, inv.customerId);
  }
  return { customers: map, byDocNumber, byNameKey };
}

export function proposeLink(
  student: LinkStudent,
  index: LinkIndex
): LinkProposal {
  const key = nameKey(student.lastName, student.firstName);
  const sameName = (id: string) =>
    !!key && customerNameKey(index.customers.get(id)!.displayName) === key;

  const fromNumbers = new Set<string>();
  for (const raw of student.typedNumbers) {
    const doc = cleanDocNumber(raw);
    const id = doc ? index.byDocNumber.get(doc) : undefined;
    if (id) fromNumbers.add(id);
  }
  if (fromNumbers.size === 1) {
    const [id] = fromNumbers;
    // A single number can still be a sibling's: trust it only if the name
    // does not point at a different customer.
    const named = key ? (index.byNameKey.get(key) ?? []) : [];
    if (sameName(id) || named.length === 0)
      return { kind: 'link', customerId: id, reason: 'invoice' };
    if (named.length === 1)
      return { kind: 'link', customerId: named[0], reason: 'sibling' };
  }
  if (fromNumbers.size > 1) {
    const match = [...fromNumbers].filter(sameName);
    if (match.length === 1)
      return { kind: 'link', customerId: match[0], reason: 'sibling' };
  }
  const named = key ? (index.byNameKey.get(key) ?? []) : [];
  if (named.length === 1)
    return { kind: 'link', customerId: named[0], reason: 'name' };

  const candidates = new Map<string, string>();
  for (const id of named) candidates.set(id, 'same name');
  for (const id of fromNumbers)
    if (!candidates.has(id)) candidates.set(id, 'typed invoice number');
  return {
    kind: 'review',
    candidates: [...candidates].map(([customerId, reason]) => ({
      customerId,
      displayName: index.customers.get(customerId)!.displayName,
      reason,
    })),
  };
}
