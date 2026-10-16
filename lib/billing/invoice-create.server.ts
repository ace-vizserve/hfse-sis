import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import type { QbInvoiceFull } from '@/lib/billing/invoice-row';
import { sendInvoice } from '@/lib/billing/invoice-send.server';
import { loadBillingMaps } from '@/lib/billing/settings.server';
import { upsertInvoice } from '@/lib/billing/store.server';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
import {
  connectedRealmId,
  qbEscape,
  QboError,
  qboErrorMessage,
  qboQuery,
  qboRequest,
  QboNotConnectedError,
} from '@/lib/qbo/client';
import {
  buildInvoiceLines,
  createdButNotSaved,
} from '@/lib/qbo/invoice-actions';

export type CreateInvoiceInput = {
  lines: Array<{
    itemId: string;
    description?: string;
    qty: number;
    unitPrice: number;
  }>;
  txnDate: string;
  dueDate: string | null;
  memo?: string;
  docNumber?: string;
  send: boolean;
};

export type CreateInvoiceResult =
  | {
      ok: true;
      qboInvoiceId: string;
      docNumber: string | null;
      sentTo: string | null;
      warnings: string[];
    }
  | { ok: false; status: number; error: string };

/**
 * Create Invoice from the customer page (spec "Drawers"). QuickBooks FIRST;
 * the SIS stores the invoice and recomputes the student's tiles only once
 * QuickBooks has it. The customer is always the student's linked one.
 */
export async function createInvoiceForStudent(
  service: SupabaseClient,
  args: {
    studentNumber: string;
    actor: { id: string; email: string | null; role: string };
    input: CreateInvoiceInput;
  }
): Promise<CreateInvoiceResult> {
  const { studentNumber, actor, input } = args;
  let realmId: string;
  let customer: { id: string; name: string; email: string | null };
  let invoice: QbInvoiceFull;
  try {
    const r = await connectedRealmId(service);
    if (!r) throw new QboNotConnectedError();
    realmId = r;
    const { data: link, error } = await service
      .from('qbo_customers')
      .select('qbo_customer_id, display_name')
      .eq('student_number', studentNumber)
      .eq('realm_id', realmId)
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: error.message };
    if (!link)
      return {
        ok: false,
        status: 422,
        error:
          'This student is not linked to a QuickBooks customer yet. Link them from To review first.',
      };
    const { Customer } = await qboRequest<{
      Customer: {
        Id: string;
        DisplayName: string;
        PrimaryEmailAddr?: { Address?: string };
      };
    }>(service, 'GET', `/customer/${encodeURIComponent(link.qbo_customer_id)}`);
    customer = {
      id: Customer.Id,
      name: Customer.DisplayName,
      email: Customer.PrimaryEmailAddr?.Address?.trim() || null,
    };
    if (input.send && !customer.email)
      return {
        ok: false,
        status: 422,
        error: `${customer.name} has no email in QuickBooks, so the invoice can't be emailed. Untick "Email it now", or add the email in QuickBooks first.`,
      };

    const docNumber = input.docNumber?.trim() || null;
    if (docNumber) {
      // QuickBooks' API accepts a repeated number, so check first.
      const taken = await qboQuery<{ Id: string }>(
        service,
        'Invoice',
        `DocNumber = '${qbEscape(docNumber)}'`,
        'maxresults 1'
      );
      if (taken.length > 0)
        return {
          ok: false,
          status: 409,
          error: `Invoice ${docNumber} already exists in QuickBooks. Type a different number, or leave it blank.`,
        };
    }
    const ids = [...new Set(input.lines.map((l) => l.itemId))];
    const items = await qboQuery<{
      Id: string;
      Name: string;
      SalesTaxCodeRef?: { value: string };
    }>(
      service,
      'Item',
      `Id in (${ids.map((i) => `'${qbEscape(i)}'`).join(', ')})`
    );
    const lines = buildInvoiceLines(
      input.lines,
      new Map(items.map((i) => [i.Id, i]))
    );
    const { data: who } = await service.auth.admin.getUserById(actor.id);
    const staffName =
      (who?.user?.user_metadata?.full_name as string | undefined) ??
      actor.email ??
      'staff';
    invoice = (
      await qboRequest<{ Invoice: QbInvoiceFull }>(
        service,
        'POST',
        '/invoice',
        {
          CustomerRef: { value: customer.id },
          TxnDate: input.txnDate,
          ...(input.dueDate ? { DueDate: input.dueDate } : {}),
          Line: lines,
          ...(input.memo?.trim()
            ? { CustomerMemo: { value: input.memo.trim() } }
            : {}),
          ...(customer.email ? { BillEmail: { Address: customer.email } } : {}),
          PrivateNote: `Created from SIS by ${staffName}`,
          ...(docNumber ? { DocNumber: docNumber } : { AutoDocNumber: true }),
        }
      )
    ).Invoice;
  } catch (e) {
    // buildInvoiceLines throws a plain Error with a sentence meant for staff.
    const message =
      e instanceof Error &&
      !(e instanceof QboError) &&
      !(e instanceof QboNotConnectedError) &&
      e.message.startsWith('One of the items')
        ? e.message
        : qboErrorMessage(e);
    return { ok: false, status: 502, error: message };
  }

  // QuickBooks has it. Store it and move the tiles; a failure here does not
  // undo the invoice, it is reported.
  const warnings: string[] = [];
  try {
    const maps = await loadBillingMaps(service);
    const placed = await upsertInvoice(service, {
      inv: invoice,
      qboInvoiceId: invoice.Id,
      studentNumber,
      realmId,
      maps,
      source: 'created',
      createdBy: { id: actor.id, email: actor.email },
    });
    if (placed.after.ayCode) {
      const t = await syncTilesForStudent(
        service,
        studentNumber,
        [placed.after.ayCode],
        { realmId }
      );
      warnings.push(...t.errors.map((e) => `The stage wasn't updated: ${e}`));
    }
  } catch (e) {
    console.error('[billing] invoice saved in QuickBooks, SIS save failed:', e);
    warnings.push(createdButNotSaved(invoice.DocNumber));
  }
  await logAction({
    service,
    actor,
    action: 'qbo.invoice.create',
    entityType: 'qbo_invoice',
    entityId: invoice.Id,
    context: {
      studentNumber,
      doc_number: invoice.DocNumber ?? null,
      total: Number(invoice.TotalAmt),
      customer: customer.name,
    },
  });

  let sentTo: string | null = null;
  if (input.send) {
    try {
      sentTo = (await sendInvoice(service, { qboInvoiceId: invoice.Id, actor }))
        .sentTo;
    } catch (e) {
      warnings.push(
        `The invoice was created, but it wasn't emailed: ${qboErrorMessage(e)} Use Send on the invoice page.`
      );
    }
  }
  return {
    ok: true,
    qboInvoiceId: invoice.Id,
    docNumber: invoice.DocNumber ?? null,
    sentTo,
    warnings,
  };
}
