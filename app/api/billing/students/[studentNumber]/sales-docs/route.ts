import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { SalesDocBody } from '@/lib/billing/sales-doc-body';
import { createSalesDoc } from '@/lib/billing/sales-doc-create.server';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/billing/students/[studentNumber]/sales-docs — a Refund receipt or
// a Credit memo for the student's QuickBooks customer (`kind` in the body).
// QuickBooks first; `keepRequestId: true` in an error means QuickBooks may
// have saved it.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber } = await params;
  const parsed = SalesDocBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const r = await createSalesDoc(createServiceClient(), {
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
