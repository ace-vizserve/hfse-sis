import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { createInvoiceForStudent } from '@/lib/billing/invoice-create.server';
import { isRealDate } from '@/lib/billing/settings-helpers';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Date10 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, 'That is not a real date.');
const Body = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        description: z.string().max(4000).optional(),
        qty: z.number().positive(),
        unitPrice: z.number().nonnegative(),
      })
    )
    .min(1, 'Add at least one line.')
    .max(50),
  txnDate: Date10,
  dueDate: Date10.nullable(),
  memo: z.string().max(1000).optional(),
  docNumber: z
    .string()
    .trim()
    .max(21, 'An invoice number is at most 21 characters in QuickBooks.')
    .optional(),
  send: z.boolean(),
  requestId: z.string().uuid(),
});

// POST /api/billing/students/[studentNumber]/invoices — Create invoice from
// the customer page. QuickBooks first; nothing is saved unless it accepts.
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
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
