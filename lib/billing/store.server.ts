import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyInvoice, type BillingMaps } from '@/lib/billing/classify';
import {
  invoiceLines,
  paymentApplied,
  type QbInvoiceFull,
  type QbPayment,
} from '@/lib/billing/invoice-row';
import { qboRequest } from '@/lib/qbo/client';
import { invoiceState } from '@/lib/qbo/invoice-snapshot';
import { paymentDateFor } from '@/lib/qbo/sync';

type Place = { ayCode: string | null; stageKeys: string[] };

/** Item → income account, reading QuickBooks for any item not cached yet. */
async function itemAccounts(
  service: SupabaseClient,
  inv: QbInvoiceFull,
  realmId: string
): Promise<Map<string, string | null>> {
  const ids = [
    ...new Set(
      (inv.Line ?? [])
        .map((l) => l.SalesItemLineDetail?.ItemRef?.value)
        .filter((v): v is string => !!v)
    ),
  ];
  const map = new Map<string, string | null>();
  if (!ids.length) return map;
  const { data, error } = await service
    .from('qbo_items')
    .select('qbo_item_id, income_account_id')
    .in('qbo_item_id', ids);
  if (error) throw new Error(`Items lookup failed: ${error.message}`);
  for (const r of data ?? []) map.set(r.qbo_item_id, r.income_account_id);
  for (const id of ids.filter((i) => !map.has(i))) {
    const { Item } = await qboRequest<{
      Item: {
        Id: string;
        Name: string;
        Active?: boolean;
        IncomeAccountRef?: { value: string; name?: string };
      };
    }>(service, 'GET', `/item/${id}`);
    map.set(id, Item.IncomeAccountRef?.value ?? null);
    const up = await service.from('qbo_items').upsert({
      qbo_item_id: Item.Id,
      name: Item.Name,
      income_account_id: Item.IncomeAccountRef?.value ?? null,
      income_account_name: Item.IncomeAccountRef?.name ?? null,
      active: Item.Active !== false,
      realm_id: realmId,
    });
    if (up.error) throw new Error(`Saving item failed: ${up.error.message}`);
  }
  return map;
}

export async function upsertInvoice(
  service: SupabaseClient,
  args: {
    inv: QbInvoiceFull | null;
    qboInvoiceId: string;
    studentNumber: string;
    realmId: string;
    maps: BillingMaps;
    source?: 'created' | 'synced';
    createdBy?: { id: string; email: string | null };
  }
): Promise<{ before: Place | null; after: Place }> {
  const { data: prev, error: prevErr } = await service
    .from('qbo_invoices')
    .select('id, ay_code, stage_keys, lines, txn_date')
    .eq('qbo_invoice_id', args.qboInvoiceId)
    .maybeSingle();
  if (prevErr) throw new Error(`Invoice lookup failed: ${prevErr.message}`);
  const before: Place | null = prev
    ? { ayCode: prev.ay_code, stageKeys: prev.stage_keys ?? [] }
    : null;

  if (!args.inv) {
    // Deleted in QuickBooks: keep the row, mark it voided, keep its place so
    // the tile it was on is recomputed.
    if (prev) {
      const up = await service
        .from('qbo_invoices')
        .update({
          state: 'voided',
          balance: 0,
          synced_at: new Date().toISOString(),
        })
        .eq('id', prev.id);
      if (up.error)
        throw new Error(`Invoice update failed: ${up.error.message}`);
    }
    return { before, after: before ?? { ayCode: null, stageKeys: [] } };
  }

  const inv = args.inv;
  const lines = invoiceLines(
    inv,
    await itemAccounts(service, inv, args.realmId)
  );
  const place = classifyInvoice(lines, inv.TxnDate ?? null, args.maps);
  const state = invoiceState(inv);
  const row = {
    qbo_invoice_id: inv.Id,
    qbo_customer_id: inv.CustomerRef.value,
    student_number: args.studentNumber,
    doc_number: inv.DocNumber ?? null,
    txn_date: inv.TxnDate ?? null,
    due_date: inv.DueDate ?? null,
    total: Number(inv.TotalAmt),
    balance: Number(inv.Balance),
    state,
    payment_date: state === 'paid' ? await paymentDateFor(service, inv) : null,
    lines,
    memo: inv.CustomerMemo?.value ?? null,
    private_note: inv.PrivateNote ?? null,
    ay_code: place.ayCode,
    stage_keys: place.stageKeys,
    sync_token: inv.SyncToken,
    synced_at: new Date().toISOString(),
    realm_id: args.realmId,
  };
  const res = prev
    ? await service.from('qbo_invoices').update(row).eq('id', prev.id)
    : await service.from('qbo_invoices').insert({
        ...row,
        source: args.source ?? 'synced',
        is_current: false,
        created_by: args.createdBy?.id ?? null,
        created_by_email: args.createdBy?.email ?? null,
      });
  if (res.error)
    throw new Error(
      `Saving invoice ${inv.DocNumber ?? inv.Id} failed: ${res.error.message}`
    );
  return { before, after: place };
}

export async function upsertPayment(
  service: SupabaseClient,
  args: {
    p: QbPayment;
    studentNumber: string;
    realmId: string;
    createdBy?: { id: string; email: string | null };
  }
): Promise<string[]> {
  const applied = paymentApplied(args.p);
  const { error } = await service.from('qbo_payments').upsert({
    qbo_payment_id: args.p.Id,
    qbo_customer_id: args.p.CustomerRef.value,
    student_number: args.studentNumber,
    txn_date: args.p.TxnDate ?? null,
    total: Number(args.p.TotalAmt),
    deposit_account_id: args.p.DepositToAccountRef?.value ?? null,
    deposit_account_name: args.p.DepositToAccountRef?.name ?? null,
    reference: args.p.PaymentRefNum ?? null,
    applied,
    ...(args.createdBy
      ? {
          created_by: args.createdBy.id,
          created_by_email: args.createdBy.email,
        }
      : {}),
    synced_at: new Date().toISOString(),
    realm_id: args.realmId,
  });
  if (error) throw new Error(`Saving payment failed: ${error.message}`);
  return applied.map((a) => a.invoiceId);
}
