import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import type { QbInvoiceFull } from '@/lib/billing/invoice-row';
import { SIS_CATCH_UP, SIS_READ_FAILED } from '@/lib/billing/messages';
import { loadBillingMaps } from '@/lib/billing/maps.server';
import { upsertInvoice } from '@/lib/billing/store.server';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
import {
  connectedRealmId,
  qboErrorMessage,
  qboRequest,
  WRITE_OUTCOME_UNKNOWN,
  writeOutcomeUnknown,
} from '@/lib/qbo/client';
import { invoiceState, linkedPaymentIds } from '@/lib/qbo/invoice-snapshot';

export type VoidInvoiceResult =
  | { ok: true; docNumber: string | null; warnings: string[] }
  | { ok: false; status: number; error: string; keepRequestId?: true };

/**
 * More actions → Void on the invoice page, as QuickBooks voids an invoice:
 * the invoice stays, its amounts go to zero. Only an UNPAID invoice of a
 * linked student's customer — one with a payment is voided in QuickBooks,
 * where the payment is dealt with too. QuickBooks first; once it has voided
 * the invoice the SIS never reports failure (its copy catches up).
 */
export async function voidInvoice(
  service: SupabaseClient,
  args: {
    qboInvoiceId: string;
    actor: { id: string; email: string | null; role: string };
    requestId: string;
  }
): Promise<VoidInvoiceResult> {
  const realmId = await connectedRealmId(service).catch(() => null);
  const { data: row, error } = await service
    .from('qbo_invoices')
    .select('qbo_invoice_id, student_number, qbo_customer_id')
    .eq('qbo_invoice_id', args.qboInvoiceId)
    .eq('realm_id', realmId ?? '')
    .maybeSingle();
  if (error) {
    console.error('[billing] void, invoice lookup:', error.message);
    return { ok: false, status: 500, error: SIS_READ_FAILED };
  }
  if (!row || !realmId)
    return {
      ok: false,
      status: 404,
      error: 'That invoice is not one of a linked student’s.',
    };

  let voided: QbInvoiceFull;
  let writing = false;
  let alreadyVoided = false;
  try {
    // Live: the SyncToken QuickBooks wants, and whether it is still unpaid.
    const { Invoice: live } = await qboRequest<{ Invoice: QbInvoiceFull }>(
      service,
      'GET',
      `/invoice/${encodeURIComponent(args.qboInvoiceId)}`
    );
    // Moved in QuickBooks to another customer since the SIS last read it:
    // not this student's to void any more.
    if (
      live.CustomerRef?.value &&
      row.qbo_customer_id &&
      live.CustomerRef.value !== row.qbo_customer_id
    )
      return {
        ok: false,
        status: 409,
        error:
          'This invoice now belongs to another QuickBooks customer. Refresh the page.',
      };
    // Already voided — most often our own earlier attempt whose answer was
    // lost. QuickBooks has it voided, so finish the SIS side and report it.
    if (invoiceState(live) === 'voided') {
      voided = live;
      alreadyVoided = true;
    } else if (
      linkedPaymentIds(live).length > 0 ||
      Number(live.Balance) !== Number(live.TotalAmt)
    ) {
      return {
        ok: false,
        status: 409,
        error:
          'This invoice has a payment on it, so it can only be voided in QuickBooks.',
      };
    } else {
      writing = true;
      voided = (
        await qboRequest<{ Invoice: QbInvoiceFull }>(
          service,
          'POST',
          '/invoice?operation=void',
          { Id: live.Id, SyncToken: live.SyncToken, sparse: true },
          // QuickBooks answers a repeated requestid with the original answer.
          { requestId: args.requestId }
        )
      ).Invoice;
    }
  } catch (e) {
    if (writing && writeOutcomeUnknown(e))
      return {
        ok: false,
        status: 502,
        error: WRITE_OUTCOME_UNKNOWN,
        keepRequestId: true,
      };
    return { ok: false, status: 502, error: qboErrorMessage(e) };
  }

  // QuickBooks has voided it. Store the voided copy and reset the tile; a
  // failure here is a note, never a failure — the hourly check catches up.
  const warnings: string[] = [];
  const studentNumber = row.student_number as string;
  try {
    const maps = await loadBillingMaps(service, {
      studentNumbers: [studentNumber],
    });
    const placed = await upsertInvoice(service, {
      inv: voided,
      qboInvoiceId: voided.Id,
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
        console.error('[billing] tiles after void:', t.errors);
        warnings.push(SIS_CATCH_UP);
      }
    }
  } catch (e) {
    console.error(
      '[billing] invoice voided in QuickBooks, SIS save failed:',
      e
    );
    warnings.push(SIS_CATCH_UP);
  }
  await logAction({
    service,
    actor: args.actor,
    action: 'qbo.invoice.void',
    entityType: 'qbo_invoice',
    entityId: voided.Id,
    context: {
      studentNumber,
      doc_number: voided.DocNumber ?? null,
      ...(alreadyVoided ? { already_voided: true } : {}),
    },
  });
  return { ok: true, docNumber: voided.DocNumber ?? null, warnings };
}
