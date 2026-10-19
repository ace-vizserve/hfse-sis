import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { round2 } from '@/lib/billing/view';
import { fetchAllPages } from '@/lib/supabase/paginate';

// The customer page's left panel, as QuickBooks has it: every linked
// customer with their open balance, to search and jump between. Balances are
// added up from the SIS's copy of QuickBooks (the page itself reads the open
// customer live).

export type CustomerNavItem = {
  studentNumber: string;
  name: string;
  openBalance: number;
};

type Page<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

export async function loadCustomerNav(
  service: SupabaseClient,
  realmId: string
): Promise<CustomerNavItem[]> {
  type Link = {
    student_number: string;
    qbo_customer_id: string;
    display_name: string;
  };
  type Inv = { qbo_customer_id: string | null; balance: number };
  const [links, open] = await Promise.all([
    fetchAllPages<Link>(
      (from, to) =>
        service
          .from('qbo_customers')
          .select('student_number, qbo_customer_id, display_name')
          .eq('realm_id', realmId)
          .range(from, to) as unknown as Page<Link>,
      1000,
      { tieBreak: 'student_number' }
    ),
    fetchAllPages<Inv>(
      (from, to) =>
        service
          .from('qbo_invoices')
          .select('qbo_customer_id, balance')
          .eq('realm_id', realmId)
          .eq('state', 'open')
          .gt('balance', 0)
          .range(from, to) as unknown as Page<Inv>,
      1000,
      { tieBreak: 'qbo_invoice_id' }
    ),
  ]);
  const owed = new Map<string, number>();
  for (const i of open)
    if (i.qbo_customer_id)
      owed.set(
        i.qbo_customer_id,
        (owed.get(i.qbo_customer_id) ?? 0) + Number(i.balance)
      );
  const seen = new Set<string>();
  const out: CustomerNavItem[] = [];
  for (const l of links) {
    if (seen.has(l.qbo_customer_id)) continue;
    seen.add(l.qbo_customer_id);
    out.push({
      studentNumber: l.student_number,
      name: l.display_name,
      openBalance: round2(owed.get(l.qbo_customer_id) ?? 0),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
