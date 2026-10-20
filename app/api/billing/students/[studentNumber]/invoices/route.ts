import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { CreateInvoiceBody as Body } from '@/lib/billing/invoice-create-body';
import { createInvoiceForStudent } from '@/lib/billing/invoice-create.server';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/billing/students/[studentNumber]/invoices — Create invoice from
// the customer page. QuickBooks first; nothing is saved unless it accepts.
// `keepRequestId: true` in an error means QuickBooks may have created it.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const r = await createInvoiceForStudent(createServiceClient(), {
    studentNumber,
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
