import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { sendInvoice } from '@/lib/billing/invoice-send.server';
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
  const { data: row } = await service
    .from('qbo_invoices')
    .select('qbo_invoice_id, state')
    .eq('qbo_invoice_id', invoiceId)
    .eq('realm_id', realmId ?? '')
    .maybeSingle();
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
  try {
    const r = await sendInvoice(service, {
      qboInvoiceId: invoiceId,
      sendTo: parsed.data.sendTo ?? null,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    });
    return NextResponse.json({ ok: true, sentTo: r.sentTo });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
