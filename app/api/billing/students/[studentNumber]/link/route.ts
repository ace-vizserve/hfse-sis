import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import {
  connectedRealmId,
  QboError,
  qboErrorMessage,
  qboRequest,
  QboNotConnectedError,
} from '@/lib/qbo/client';
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
  const service = createServiceClient();
  let displayName: string;
  let realmId: string;
  try {
    const r = await connectedRealmId(service);
    if (!r) throw new QboNotConnectedError();
    realmId = r;
    const c = await qboRequest<{
      Customer: { DisplayName: string; FullyQualifiedName?: string };
    }>(
      service,
      'GET',
      `/customer/${encodeURIComponent(parsed.data.customerId)}`
    );
    displayName = c.Customer.DisplayName;
    if ((c.Customer.FullyQualifiedName ?? '').includes(':'))
      return NextResponse.json(
        { error: "That is not a student's customer." },
        { status: 409 }
      );
  } catch (e) {
    // 610: QuickBooks has no customer with this id (Object Not Found).
    if (e instanceof QboError && e.code === '610')
      return NextResponse.json(
        { error: 'QuickBooks has no customer with that id.' },
        { status: 404 }
      );
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
  const { error } = await service.from('qbo_customers').upsert({
    student_number: studentNumber,
    qbo_customer_id: parsed.data.customerId,
    display_name: displayName,
    matched_by: auth.user.email ?? 'staff',
    matched_at: new Date().toISOString(),
    realm_id: realmId,
  });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  // The link is saved either way; a review row that survives is only a stale
  // suggestion, so a failed delete is logged and the request still succeeds.
  const { error: reviewError } = await service
    .from('billing_link_review')
    .delete()
    .eq('student_number', studentNumber);
  if (reviewError)
    console.warn('[billing] could not clear billing_link_review row', {
      student_number: studentNumber,
      error: reviewError.message,
    });
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: 'qbo.customer.link',
    entityType: 'qbo_customer',
    entityId: studentNumber,
    context: { display_name: displayName, customer_id: parsed.data.customerId },
  });
  return NextResponse.json({ ok: true, displayName });
}
