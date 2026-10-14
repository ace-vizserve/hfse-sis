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

/**
 * Refresh every invoice the changes touch. Never throws per item: one failing
 * invoice is recorded in `errors` and the rest still run. Otherwise a single
 * permanently failing invoice would block every later change, every hour.
 */
export async function processChanges(
  service: SupabaseClient,
  changes: ChangedEntity[]
): Promise<{ updated: number; errors: string[] }> {
  // Imported here, not at the top, so the pure `changedIdsFromCdc` test does
  // not pull in server-only modules.
  const { refreshInvoice, refreshInvoicesForPayment } =
    await import('@/lib/qbo/sync');
  const { qboErrorMessage } = await import('@/lib/qbo/client');
  const invoiceIds = new Set(
    changes.filter((c) => c.entity === 'Invoice').map((c) => c.id)
  );
  const paymentIds = new Set(
    changes.filter((c) => c.entity === 'Payment').map((c) => c.id)
  );
  let updated = 0;
  const errors: string[] = [];
  for (const id of invoiceIds) {
    try {
      const r = await refreshInvoice(service, id);
      if (r.known) updated++;
      if (r.stageError) errors.push(`Invoice ${id}: ${r.stageError}`);
    } catch (e) {
      errors.push(`Invoice ${id}: ${qboErrorMessage(e)}`);
    }
  }
  for (const id of paymentIds) {
    try {
      updated += await refreshInvoicesForPayment(service, id);
    } catch (e) {
      errors.push(`Payment ${id}: ${qboErrorMessage(e)}`);
    }
  }
  return { updated, errors };
}
