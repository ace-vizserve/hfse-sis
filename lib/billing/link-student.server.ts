import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { loadCustomerHistory } from '@/lib/billing/history.server';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
import {
  connectedRealmId,
  QboError,
  qboErrorMessage,
  qboRequest,
  QboNotConnectedError,
} from '@/lib/qbo/client';

export type LinkResult =
  | { ok: true; displayName: string; historyErrors: string[] }
  | { ok: false; status: number; error: string };

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
    const { data, error: appError } = await service
      .from(`ay${ay_code.slice(2)}_enrolment_applications`)
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

/**
 * Link a student to a QuickBooks customer (To review, Pick another, Add to
 * QuickBooks). One customer belongs to one student; a sub-customer is never a
 * student's. Linking loads the customer's whole history and recomputes the
 * tiles, including the years an old customer's invoices were on.
 */
export async function linkStudentToCustomer(
  service: SupabaseClient,
  args: {
    studentNumber: string;
    customerId: string;
    actor: { id: string; email: string | null; role: string };
  }
): Promise<LinkResult> {
  const { studentNumber, customerId, actor } = args;
  try {
    if (!(await studentExists(service, studentNumber)))
      return {
        ok: false,
        status: 404,
        error: 'There is no student with that student number.',
      };
  } catch (e) {
    return {
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : 'Student lookup failed.',
    };
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
    }>(service, 'GET', `/customer/${encodeURIComponent(customerId)}`);
    displayName = c.Customer.DisplayName;
    // A sub-customer: a job under a parent (FullyQualifiedName "Parent:Job").
    if (
      (c.Customer.FullyQualifiedName ?? '').includes(':') ||
      c.Customer.Job === true ||
      c.Customer.ParentRef != null
    )
      return {
        ok: false,
        status: 409,
        error: "That is not a student's customer.",
      };
  } catch (e) {
    // 610: QuickBooks has no customer with this id (Object Not Found).
    if (e instanceof QboError && e.code === '610')
      return {
        ok: false,
        status: 404,
        error: 'QuickBooks has no customer with that id.',
      };
    return { ok: false, status: 502, error: qboErrorMessage(e) };
  }
  // One customer belongs to one student.
  const { data: holders, error: holderError } = await service
    .from('qbo_customers')
    .select('student_number')
    .eq('qbo_customer_id', customerId)
    .eq('realm_id', realmId)
    .neq('student_number', studentNumber)
    .limit(1);
  if (holderError)
    return { ok: false, status: 500, error: holderError.message };
  if (holders && holders.length > 0)
    return {
      ok: false,
      status: 409,
      error: `That QuickBooks customer is already linked to student ${holders[0].student_number}.`,
    };
  const { data: prevLink, error: prevError } = await service
    .from('qbo_customers')
    .select('qbo_customer_id')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (prevError) return { ok: false, status: 500, error: prevError.message };
  const previousCustomerId =
    (prevLink as { qbo_customer_id: string } | null)?.qbo_customer_id ?? null;
  // history_loaded_at is cleared: the (new) customer's history is loaded below.
  const { error } = await service.from('qbo_customers').upsert({
    student_number: studentNumber,
    qbo_customer_id: customerId,
    display_name: displayName,
    matched_by: actor.email ?? 'staff',
    matched_at: new Date().toISOString(),
    realm_id: realmId,
    history_loaded_at: null,
  });
  if (error) return { ok: false, status: 500, error: error.message };
  // The link is saved either way; a review row that survives is only a stale
  // suggestion, so a failed delete is logged and the link still succeeds.
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
    actor,
    action: 'qbo.customer.link',
    entityType: 'qbo_customer',
    entityId: studentNumber,
    context: {
      display_name: displayName,
      customer_id: customerId,
      previous_customer_id: previousCustomerId,
    },
  });
  // Relinked to a different customer: the years the old customer's invoices
  // were on are recomputed too (tiles only count the new customer's invoices).
  let oldYears: string[] = [];
  if (previousCustomerId && previousCustomerId !== customerId) {
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
    }).catch((e) => ({
      changed: 0,
      errors: [qboErrorMessage(e)],
    }));
    historyErrors.push(...t.errors);
  }
  return { ok: true, displayName, historyErrors };
}
