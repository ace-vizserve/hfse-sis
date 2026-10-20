import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { PaymentBody } from '@/lib/billing/payment-body';
import { recordPayment } from '@/lib/billing/payment-record.server';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = PaymentBody;

// POST /api/billing/students/[studentNumber]/payments — Record payment and
// Use credit. QuickBooks first; nothing is saved unless it accepts.
// `keepRequestId: true` in an error means QuickBooks may have recorded it.
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
  const r = await recordPayment(createServiceClient(), {
    studentNumber,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    input: {
      ...parsed.data,
      depositAccountId: parsed.data.depositAccountId ?? null,
    },
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
