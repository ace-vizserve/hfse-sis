import type { SupabaseClient } from '@supabase/supabase-js';

import type { ChangedEntity } from '@/lib/qbo/webhook';

export function changedIdsFromCdc(json: unknown): {
  invoiceIds: string[];
  paymentIds: string[];
} {
  const invoiceIds: string[] = [];
  const paymentIds: string[] = [];
  const responses =
    (
      json as {
        CDCResponse?: Array<{ QueryResponse?: Array<Record<string, unknown>> }>;
      }
    )?.CDCResponse ?? [];
  for (const r of responses) {
    for (const qr of r.QueryResponse ?? []) {
      for (const inv of (qr.Invoice as Array<{ Id: string }> | undefined) ?? [])
        invoiceIds.push(inv.Id);
      for (const p of (qr.Payment as Array<{ Id: string }> | undefined) ?? [])
        paymentIds.push(p.Id);
    }
  }
  return { invoiceIds, paymentIds };
}

/** Refresh every invoice the changes touch. Returns how many known invoices were refreshed. */
export async function processChanges(
  service: SupabaseClient,
  changes: ChangedEntity[]
): Promise<number> {
  // Imported here, not at the top, so the pure `changedIdsFromCdc` test does
  // not pull in server-only modules.
  const { refreshInvoice, refreshInvoicesForPayment } =
    await import('@/lib/qbo/sync');
  const invoiceIds = new Set(
    changes.filter((c) => c.entity === 'Invoice').map((c) => c.id)
  );
  const paymentIds = new Set(
    changes.filter((c) => c.entity === 'Payment').map((c) => c.id)
  );
  let n = 0;
  for (const id of invoiceIds)
    if ((await refreshInvoice(service, id)).known) n++;
  for (const id of paymentIds)
    n += await refreshInvoicesForPayment(service, id);
  return n;
}
