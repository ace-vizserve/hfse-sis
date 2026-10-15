import type { SupabaseClient } from '@supabase/supabase-js';
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

// True when the student number exists in any year's admissions applications.
// Newest year first; a year with no admissions table is skipped (PGRST205).
async function studentExists(
  service: SupabaseClient,
  studentNumber: string
): Promise<boolean> {
  const { data: years, error } = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  if (error) throw new Error(`Academic years lookup failed: ${error.message}`);
  for (const { ay_code } of (years ?? []) as Array<{ ay_code: string }>) {
    const prefix = `ay${ay_code.slice(2)}`;
    const { data, error: appError } = await service
      .from(`${prefix}_enrolment_applications`)
      .select('"studentNumber"')
      .eq('studentNumber', studentNumber)
      .limit(1);
    if (appError) {
      if (
        /PGRST205|42P01|Could not find the table|does not exist/i.test(
          appError.message
        )
      )
        continue;
      throw new Error(appError.message);
    }
    if ((data ?? []).length > 0) return true;
  }
  return false;
}

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
  try {
    if (!(await studentExists(service, studentNumber)))
      return NextResponse.json(
        { error: 'There is no student with that student number.' },
        { status: 404 }
      );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Student lookup failed.' },
      { status: 500 }
    );
  }
  let displayName: string;
  let realmId: string;
  try {
    const r = await connectedRealmId(service);
    if (!r) throw new QboNotConnectedError();
    realmId = r;
    const c = await qboRequest<{
      Customer: {
        DisplayName: string;
        FullyQualifiedName?: string;
        Job?: boolean;
        ParentRef?: unknown;
      };
    }>(
      service,
      'GET',
      `/customer/${encodeURIComponent(parsed.data.customerId)}`
    );
    displayName = c.Customer.DisplayName;
    // A sub-customer: a job under a parent (FullyQualifiedName "Parent:Job").
    if (
      (c.Customer.FullyQualifiedName ?? '').includes(':') ||
      c.Customer.Job === true ||
      c.Customer.ParentRef != null
    )
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
