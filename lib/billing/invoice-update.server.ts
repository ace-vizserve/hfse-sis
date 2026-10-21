import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import type { QbInvoiceFull } from '@/lib/billing/invoice-row';
import {
  amountPaid,
  buildInvoiceUpdateBody,
  editRefusal,
  mergeInvoiceLines,
  updateErrorMessage,
  type UpdateInvoiceInput,
} from '@/lib/billing/invoice-update-body';
import { SIS_CATCH_UP, SIS_READ_FAILED } from '@/lib/billing/messages';
import { loadBillingMaps } from '@/lib/billing/maps.server';
import { upsertInvoice } from '@/lib/billing/store.server';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
import {
  connectedRealmId,
  qbEscape,
  QboError,
  qboQuery,
  qboRequest,
  QboNotConnectedError,
  WRITE_OUTCOME_UNKNOWN,
  writeOutcomeUnknown,
} from '@/lib/qbo/client';
import { buildInvoiceLines } from '@/lib/qbo/invoice-actions';

export type UpdateInvoiceResult =
  | { ok: true; docNumber: string | null; total: number; warnings: string[] }
  | { ok: false; status: number; error: string; keepRequestId?: true };

type LiveInvoice = QbInvoiceFull & {
  Deposit?: number;
  Line?: Array<Record<string, unknown>>;
};

/**
 * Edit invoice on the invoice page, as QuickBooks edits one: the lines, the
 * dates and the two notes of an open invoice of the student's linked
 * customer. QuickBooks first (read fresh for its SyncToken, then a sparse
 * update carrying every line); once QuickBooks has accepted it the SIS never
 * reports failure — it stores the new copy (its stage tie kept) and works the
 * tied stage out again, and a problem there is a note.
 */
export async function updateInvoiceForStudent(
  service: SupabaseClient,
  args: {
    studentNumber: string;
    qboInvoiceId: string;
    actor: { id: string; email: string | null; role: string };
    input: UpdateInvoiceInput;
  }
): Promise<UpdateInvoiceResult> {
  const { studentNumber, qboInvoiceId, actor, input } = args;
  const realmId = await connectedRealmId(service).catch(() => null);
  const { data: row, error } = await service
    .from('qbo_invoices')
    .select('qbo_invoice_id, student_number, qbo_customer_id')
    .eq('qbo_invoice_id', qboInvoiceId)
    .eq('realm_id', realmId ?? '')
    .maybeSingle();
  if (error) {
    console.error('[billing] edit invoice, invoice lookup:', error.message);
    return { ok: false, status: 500, error: SIS_READ_FAILED };
  }
  if (!row || !realmId || row.student_number !== studentNumber)
    return {
      ok: false,
      status: 404,
      error: 'That invoice is not one of this student’s.',
    };

  let updated: LiveInvoice;
  let paid = 0;
  let writing = false;
  try {
    const { Invoice: live } = await qboRequest<{ Invoice: LiveInvoice }>(
      service,
      'GET',
      `/invoice/${encodeURIComponent(qboInvoiceId)}`
    );
    paid = amountPaid(live);
    const refused = editRefusal(live, {
      customerId: (row.qbo_customer_id as string | null) ?? null,
      syncToken: input.syncToken,
    });
    if (refused) return { ok: false, ...refused };

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
    const lines = mergeInvoiceLines({
      built: buildInvoiceLines(
        input.lines,
        new Map(items.map((i) => [i.Id, i]))
      ),
      lineIds: input.lines.map((l) => l.lineId),
      live: live.Line ?? [],
    });
    writing = true;
    updated = (
      await qboRequest<{ Invoice: LiveInvoice }>(
        service,
        'POST',
        '/invoice',
        buildInvoiceUpdateBody({
          id: live.Id,
          syncToken: live.SyncToken,
          txnDate: input.txnDate,
          dueDate: input.dueDate,
          lines,
          memo: input.memo,
          statementMemo: input.statementMemo,
        }),
        // QuickBooks answers a repeated requestid with the original answer.
        { requestId: input.requestId }
      )
    ).Invoice;
  } catch (e) {
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
        : updateErrorMessage(e, paid);
    return { ok: false, status: 502, error: message };
  }

  // QuickBooks has it. Store the new copy — upsertInvoice keeps the tie it
  // already has — and work the tied stage out again (owed amount, status).
  const warnings: string[] = [];
  try {
    const maps = await loadBillingMaps(service, {
      studentNumbers: [studentNumber],
    });
    const placed = await upsertInvoice(service, {
      inv: updated,
      qboInvoiceId: updated.Id,
      studentNumber,
      realmId,
      maps,
    });
    const years = [
      ...new Set(
        [placed.before?.ayCode, placed.after.ayCode].filter(
          (y): y is string => !!y
        )
      ),
    ];
    if (years.length) {
      const t = await syncTilesForStudent(service, studentNumber, years, {
        realmId,
      });
      if (t.errors.length > 0) {
        console.error('[billing] tiles after edit invoice:', t.errors);
        warnings.push(SIS_CATCH_UP);
      }
    }
  } catch (e) {
    console.error(
      '[billing] invoice edited in QuickBooks, SIS save failed:',
      e
    );
    warnings.push(SIS_CATCH_UP);
  }
  await logAction({
    service,
    actor,
    action: 'qbo.invoice.update',
    entityType: 'qbo_invoice',
    entityId: updated.Id,
    context: {
      studentNumber,
      doc_number: updated.DocNumber ?? null,
      total: Number(updated.TotalAmt),
      lines: input.lines.length,
    },
  });
  return {
    ok: true,
    docNumber: updated.DocNumber ?? null,
    total: Number(updated.TotalAmt),
    warnings,
  };
}
