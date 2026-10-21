import type { SupabaseClient } from '@supabase/supabase-js';

import type { ChangedEntity } from '@/lib/qbo/webhook';

type CdcEntity = { Id: string; CustomerRef?: { value?: string } };

export function changedIdsFromCdc(json: unknown): {
  invoiceIds: string[];
  paymentIds: string[];
  /** invoice id → its customer id, when the change carries one. */
  invoiceCustomers: Map<string, string>;
  /** payment id → its customer id, when the change carries one. */
  paymentCustomers: Map<string, string>;
} {
  const invoiceIds: string[] = [];
  const paymentIds: string[] = [];
  const invoiceCustomers = new Map<string, string>();
  const paymentCustomers = new Map<string, string>();
  const responses =
    (
      json as {
        CDCResponse?: Array<{ QueryResponse?: Array<Record<string, unknown>> }>;
      }
    )?.CDCResponse ?? [];
  for (const r of responses) {
    for (const qr of r.QueryResponse ?? []) {
      for (const inv of (qr.Invoice as CdcEntity[] | undefined) ?? []) {
        invoiceIds.push(inv.Id);
        if (inv.CustomerRef?.value)
          invoiceCustomers.set(inv.Id, inv.CustomerRef.value);
      }
      for (const p of (qr.Payment as CdcEntity[] | undefined) ?? []) {
        paymentIds.push(p.Id);
        if (p.CustomerRef?.value)
          paymentCustomers.set(p.Id, p.CustomerRef.value);
      }
    }
  }
  return { invoiceIds, paymentIds, invoiceCustomers, paymentCustomers };
}

/** The invoice ids not already refreshed (through a payment) in this run. */
export function notYetRefreshed(
  ids: string[],
  refreshed: Set<string>
): string[] {
  return ids.filter((id) => !refreshed.has(id));
}

/**
 * Refresh every invoice the changes touch. Never throws per item: one failing
 * invoice is recorded in `errors` and the rest still run. Otherwise a single
 * permanently failing invoice would block every later change, every hour.
 * `customers` (from the hourly check; the instant notice has none) lets a
 * change of a customer no student is linked to skip QuickBooks entirely.
 */
export async function processChanges(
  service: SupabaseClient,
  changes: ChangedEntity[],
  customers?: {
    invoiceCustomers?: Map<string, string>;
    paymentCustomers?: Map<string, string>;
  }
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
  if (!invoiceIds.size && !paymentIds.size) return { updated, errors };
  // The typed invoice numbers (for ties) are read once for the whole run.
  const { loadBillingMaps } = await import('@/lib/billing/maps.server');
  const maps = await loadBillingMaps(service);
  const refreshed = new Set<string>();
  // Payments first: they store the payment dates the invoices then read.
  for (const id of paymentIds) {
    try {
      const r = await refreshInvoicesForPayment(service, id, {
        customerId: customers?.paymentCustomers?.get(id),
        maps,
      });
      updated += r.updated;
      errors.push(...r.errors);
      for (const i of r.refreshedIds) refreshed.add(i);
    } catch (e) {
      errors.push(`Payment ${id}: ${qboErrorMessage(e)}`);
    }
  }
  for (const id of notYetRefreshed([...invoiceIds], refreshed)) {
    try {
      const r = await refreshInvoice(service, id, {
        customerId: customers?.invoiceCustomers?.get(id),
        maps,
      });
      if (r.known) updated++;
      if (r.stageError) errors.push(`Invoice ${id}: ${r.stageError}`);
    } catch (e) {
      errors.push(`Invoice ${id}: ${qboErrorMessage(e)}`);
    }
  }
  return { updated, errors };
}
