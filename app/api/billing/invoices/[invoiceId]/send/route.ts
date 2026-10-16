import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { sendInvoice } from '@/lib/billing/invoice-send.server';
import { readCustomerProfile } from '@/lib/billing/live.server';
import { SIS_READ_FAILED } from '@/lib/billing/messages';
import { connectedRealmId, qboErrorMessage } from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = z.object({
  sendTo: z.email('That is not an email address.').optional(),
});

// POST /api/billing/invoices/[invoiceId]/send — email the invoice to the
// parents through QuickBooks. Only an invoice of a linked student's customer.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { invoiceId } = await params;
  const parsed = Body.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const service = createServiceClient();
  const realmId = await connectedRealmId(service).catch(() => null);
  const { data: row, error: rowError } = await service
    .from('qbo_invoices')
    .select('qbo_invoice_id, state, qbo_customer_id')
    .eq('qbo_invoice_id', invoiceId)
    .eq('realm_id', realmId ?? '')
    .maybeSingle();
  if (rowError) {
    console.error('[billing] send, invoice lookup:', rowError.message);
    return NextResponse.json({ error: SIS_READ_FAILED }, { status: 500 });
  }
  if (!row)
    return NextResponse.json(
      { error: 'That invoice is not one of a linked student’s.' },
      { status: 404 }
    );
  if (row.state === 'voided')
    return NextResponse.json(
      { error: 'A voided invoice can’t be sent.' },
      { status: 409 }
    );
  // No address given: send to the customer's email in QuickBooks, so an
  // invoice made without a billing email still reaches the parents.
  let sendTo = parsed.data.sendTo ?? null;
  if (!sendTo) {
    try {
      sendTo = row.qbo_customer_id
        ? (await readCustomerProfile(service, row.qbo_customer_id as string))
            .email
        : null;
    } catch (e) {
      return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
    }
    if (!sendTo)
      return NextResponse.json(
        { error: 'The QuickBooks customer has no email to send to.' },
        { status: 422 }
      );
  }
  try {
    const r = await sendInvoice(service, {
      qboInvoiceId: invoiceId,
      sendTo,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    });
    return NextResponse.json({ ok: true, sentTo: r.sentTo });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
