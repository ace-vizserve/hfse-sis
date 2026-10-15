import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { loadCustomerHistory } from '@/lib/billing/history.server';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
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
      // Only "this year has no admissions table" is skipped.
      if (
        /PGRST205|42P01|Could not find the table/i.test(
          `${appError.code ?? ''} ${appError.message}`
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
  // One customer belongs to one student.
  const { data: holders, error: holderError } = await service
    .from('qbo_customers')
    .select('student_number')
    .eq('qbo_customer_id', parsed.data.customerId)
    .eq('realm_id', realmId)
    .neq('student_number', studentNumber)
    .limit(1);
  if (holderError)
    return NextResponse.json({ error: holderError.message }, { status: 500 });
  if (holders && holders.length > 0)
    return NextResponse.json(
      {
        error: `That QuickBooks customer is already linked to student ${holders[0].student_number}.`,
      },
      { status: 409 }
    );
  const { data: prevLink, error: prevError } = await service
    .from('qbo_customers')
    .select('qbo_customer_id')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (prevError)
    return NextResponse.json({ error: prevError.message }, { status: 500 });
  const previousCustomerId =
    (prevLink as { qbo_customer_id: string } | null)?.qbo_customer_id ?? null;
  // history_loaded_at is cleared: the (new) customer's history is loaded below.
  const { error } = await service.from('qbo_customers').upsert({
    student_number: studentNumber,
    qbo_customer_id: parsed.data.customerId,
    display_name: displayName,
    matched_by: auth.user.email ?? 'staff',
    matched_at: new Date().toISOString(),
    realm_id: realmId,
    history_loaded_at: null,
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
    context: {
      display_name: displayName,
      customer_id: parsed.data.customerId,
      previous_customer_id: previousCustomerId,
    },
  });
  // Relinked to a different customer: the years the old customer's invoices
  // were on are recomputed too (tiles only count the new customer's invoices).
  let oldYears: string[] = [];
  if (previousCustomerId && previousCustomerId !== parsed.data.customerId) {
    const { data: oldRows, error: oldError } = await service
      .from('qbo_invoices')
      .select('ay_code')
      .eq('student_number', studentNumber)
      .eq('qbo_customer_id', previousCustomerId)
      .eq('realm_id', realmId)
      .not('ay_code', 'is', null);
    if (oldError)
      console.warn('[billing] could not read the old customer’s invoices', {
        student_number: studentNumber,
        error: oldError.message,
      });
    oldYears = [
      ...new Set(
        ((oldRows ?? []) as Array<{ ay_code: string }>).map((r) => r.ay_code)
      ),
    ];
  }
  const history = await loadCustomerHistory(service, studentNumber).catch(
    (e) => ({ errors: [qboErrorMessage(e)] })
  );
  const historyErrors = [...history.errors];
  if (oldYears.length) {
    const t = await syncTilesForStudent(service, studentNumber, oldYears, {
      realmId,
    }).catch((e) => ({ changed: 0, errors: [qboErrorMessage(e)] }));
    historyErrors.push(...t.errors);
  }
  return NextResponse.json({
    ok: true,
    displayName,
    historyErrors,
  });
}
