import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { recordPayment } from '@/lib/billing/payment-record.server';
import { isRealDate } from '@/lib/billing/settings-helpers';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = z.object({
  amount: z.number().min(0).max(1_000_000),
  txnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealDate, 'That is not a real date.'),
  depositAccountId: z.string().min(1).nullable(),
  reference: z
    .string()
    .trim()
    .max(21, 'A reference is at most 21 characters in QuickBooks.')
    .optional(),
  invoiceIds: z.array(z.string().min(1)).max(100),
  // The Payment cells the person typed; absent = oldest first, as before.
  allocations: z
    .array(
      z.object({
        invoiceId: z.string().min(1),
        amount: z.number().positive().max(1_000_000),
      })
    )
    .max(100)
    .optional(),
  paymentMethodId: z.string().min(1).nullable().optional(),
  memo: z
    .string()
    .trim()
    .max(4000, 'A memo is at most 4000 characters in QuickBooks.')
    .optional(),
  useCredit: z.boolean(),
  requestId: z.string().uuid(),
});

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
