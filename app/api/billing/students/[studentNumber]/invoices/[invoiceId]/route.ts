import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { UpdateInvoiceBody as Body } from '@/lib/billing/invoice-update-body';
import { updateInvoiceForStudent } from '@/lib/billing/invoice-update.server';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/billing/students/[studentNumber]/invoices/[invoiceId] — Edit
// invoice on the invoice page, as in QuickBooks. QuickBooks first; nothing is
// saved unless it accepts. `keepRequestId: true` in an error means QuickBooks
// may have saved the edit.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ studentNumber: string; invoiceId: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber, invoiceId } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const r = await updateInvoiceForStudent(createServiceClient(), {
    studentNumber: decodeURIComponent(studentNumber),
    qboInvoiceId: decodeURIComponent(invoiceId),
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    input: parsed.data,
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
