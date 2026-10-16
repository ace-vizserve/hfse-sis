import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { qboRequest } from '@/lib/qbo/client';

/**
 * Email an invoice to the parents through QuickBooks (always the QuickBooks
 * API, Mr Ace 2026-10-16). Without `sendTo`, QuickBooks uses the invoice's
 * billing email. QuickBooks records the delivery on the invoice; the SIS
 * records who sent it.
 */
export async function sendInvoice(
  service: SupabaseClient,
  args: {
    qboInvoiceId: string;
    sendTo?: string | null;
    actor: { id: string; email: string | null; role: string };
    /** QuickBooks replays the original send for a repeated id. */
    requestId?: string;
  }
): Promise<{ sentTo: string | null }> {
  const to = args.sendTo?.trim() || null;
  const path = `/invoice/${encodeURIComponent(args.qboInvoiceId)}/send${to ? `?sendTo=${encodeURIComponent(to)}` : ''}`;
  const { Invoice } = await qboRequest<{
    Invoice: {
      Id: string;
      DocNumber?: string;
      BillEmail?: { Address?: string };
    };
  }>(service, 'POST', path, undefined, {
    contentType: 'application/octet-stream',
    ...(args.requestId ? { requestId: args.requestId } : {}),
  });
  const sentTo = to ?? Invoice.BillEmail?.Address ?? null;
  await logAction({
    service,
    actor: args.actor,
    action: 'qbo.invoice.send',
    entityType: 'qbo_invoice',
    entityId: Invoice.Id,
    context: { doc_number: Invoice.DocNumber ?? null, sent_to: sentTo },
  });
  return { sentTo };
}
