import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { linkStudentToCustomer } from '@/lib/billing/link-student.server';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = z.object({ customerId: z.string().min(1) });

// POST /api/billing/students/[studentNumber]/link — staff pick the student's
// QuickBooks customer (from To review, or when Create invoice finds none).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  const r = await linkStudentToCustomer(createServiceClient(), {
    studentNumber,
    customerId: parsed.data.customerId,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({
    ok: true,
    displayName: r.displayName,
    historyErrors: r.historyErrors,
  });
}
