import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { voidInvoice } from '@/lib/billing/invoice-void.server';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = z.object({
  /** One id per confirm; QuickBooks replays a repeated void. */
  requestId: z.string().uuid(),
});

// POST /api/billing/invoices/[invoiceId]/void — More actions → Void, as in
// QuickBooks. Only an unpaid invoice of a linked student's customer.
// `keepRequestId: true` in an error means QuickBooks may have voided it.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { invoiceId } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const r = await voidInvoice(createServiceClient(), {
    qboInvoiceId: invoiceId,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    requestId: parsed.data.requestId,
  });
  if (!r.ok)
    return NextResponse.json(
      {
        error: r.error,
        ...(r.keepRequestId ? { keepRequestId: true } : {}),
      },
      { status: r.status }
    );
  return NextResponse.json(r);
}
