import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { buildInvoiceBody } from '@/lib/billing/invoice-create-body';
import type { QbInvoiceFull } from '@/lib/billing/invoice-row';
import { sendInvoice } from '@/lib/billing/invoice-send.server';
import { SIS_READ_FAILED, STAGE_NOT_UPDATED } from '@/lib/billing/messages';
import { loadBillingMaps } from '@/lib/billing/maps.server';
import { staffDisplayName } from '@/lib/billing/staff-name.server';
import { upsertInvoice } from '@/lib/billing/store.server';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
import {
  connectedRealmId,
  qbEscape,
  QboError,
  qboErrorMessage,
  qboQuery,
  qboReasonOnly,
  qboRequest,
  QboNotConnectedError,
  WRITE_OUTCOME_UNKNOWN,
  writeOutcomeUnknown,
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
  /** Note to customer (CustomerMemo). */
  memo?: string;
  /** Memo on statement (PrivateNote); "Created from SIS by …" follows it. */
  statementMemo?: string;
  docNumber?: string;
  send: boolean;
  /** One id per submit; QuickBooks de-duplicates retries on it. */
  requestId: string;
};

export type CreateInvoiceResult =
  | {
      ok: true;
      qboInvoiceId: string;
      docNumber: string | null;
      sentTo: string | null;
      warnings: string[];
    }
  | {
      ok: false;
      status: number;
      error: string;
      /** QuickBooks may have created it: the retry must reuse the requestid. */
      keepRequestId?: true;
    };

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
  let writing = false;
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
    if (error) {
      console.error('[billing] create invoice, link lookup:', error.message);
      return { ok: false, status: 500, error: SIS_READ_FAILED };
    }
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
    const staffName = await staffDisplayName(service, actor);
    writing = true;
    invoice = (
      await qboRequest<{ Invoice: QbInvoiceFull }>(
        service,
        'POST',
        '/invoice',
        buildInvoiceBody({
          customerId: customer.id,
          customerEmail: customer.email,
          txnDate: input.txnDate,
          dueDate: input.dueDate,
          lines,
          memo: input.memo,
          statementMemo: input.statementMemo,
          docNumber,
          staffName,
        }),
        // QuickBooks returns the original invoice for a repeated requestid,
        // so a retry of the same submit never creates it twice.
        { requestId: input.requestId }
      )
    ).Invoice;
  } catch (e) {
    // The create itself got no definite answer: QuickBooks may have the
    // invoice, so the sheet keeps the requestid and a retry is de-duplicated.
    if (writing && writeOutcomeUnknown(e))
      return {
        ok: false,
        status: 502,
        error: WRITE_OUTCOME_UNKNOWN,
        keepRequestId: true,
      };
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
    const maps = await loadBillingMaps(service, {
      studentNumbers: [studentNumber],
    });
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
      if (t.errors.length > 0) {
        console.error('[billing] tiles after create invoice:', t.errors);
        warnings.push(STAGE_NOT_UPDATED);
      }
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
      // Whether a Memo on statement was typed — not its text.
      statement_memo: !!input.statementMemo?.trim(),
    },
  });

  let sentTo: string | null = null;
  if (input.send) {
    try {
      sentTo = (
        await sendInvoice(service, {
          qboInvoiceId: invoice.Id,
          actor,
          requestId: `${input.requestId}-s`,
        })
      ).sentTo;
    } catch (e) {
      console.error('[billing] send after create invoice:', e);
      warnings.push(
        `The invoice was created, but it wasn't emailed (${qboReasonOnly(e)}). Use Send on the invoice page.`
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
