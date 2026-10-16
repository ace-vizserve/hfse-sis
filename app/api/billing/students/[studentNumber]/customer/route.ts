import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { linkStudentToCustomer } from '@/lib/billing/link-student.server';
import { hfseCustomerName } from '@/lib/billing/review';
import { loadStudentInfo } from '@/lib/billing/students.server';
import {
  qbEscape,
  QboError,
  qboErrorMessage,
  qboQuery,
  qboRequest,
} from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/billing/students/[studentNumber]/customer — To review → Add to
// QuickBooks: the student really has no customer yet. Created the way HFSE
// names customers ("SURNAME, Given M.", parents in Company name), then linked.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber } = await params;
  const service = createServiceClient();
  const s = (await loadStudentInfo(service, [studentNumber])).get(
    studentNumber
  );
  if (!s)
    return NextResponse.json(
      { error: 'There is no student with that student number.' },
      { status: 404 }
    );
  const name = hfseCustomerName(s);
  if (!name)
    return NextResponse.json(
      {
        error:
          'This student has no first and last name on record to name the customer.',
      },
      { status: 422 }
    );
  const company = [s.fatherFullName, s.motherFullName]
    .map((n) => n?.trim())
    .filter(Boolean)
    .join(' / ');
  let customerId: string;
  try {
    // QuickBooks refuses a second customer with the same name, active or not.
    const same = await qboQuery<{ Id: string; Active: boolean }>(
      service,
      'Customer',
      `Active IN (true, false) and DisplayName = '${qbEscape(name)}'`,
      'maxresults 1'
    );
    if (same[0])
      return NextResponse.json(
        {
          error: same[0].Active
            ? `QuickBooks already has a customer named “${name}”. Use Pick another and choose it.`
            : `QuickBooks has an inactive customer named “${name}”. Make it active in QuickBooks, then use Pick another.`,
        },
        { status: 409 }
      );
    const created = await qboRequest<{
      Customer: { Id: string; DisplayName: string };
    }>(service, 'POST', '/customer', {
      DisplayName: name,
      ...(s.firstName?.trim() ? { GivenName: s.firstName.trim() } : {}),
      ...(s.middleName?.trim() ? { MiddleName: s.middleName.trim() } : {}),
      ...(s.lastName?.trim() ? { FamilyName: s.lastName.trim() } : {}),
      ...(company ? { CompanyName: company.slice(0, 100) } : {}),
    });
    customerId = created.Customer.Id;
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'qbo.customer.create',
      entityType: 'qbo_customer',
      entityId: customerId,
      context: {
        display_name: created.Customer.DisplayName,
        student_number: studentNumber,
        ay_code: s.ayCode,
      },
    });
  } catch (e) {
    if (e instanceof QboError && e.code === '6240')
      return NextResponse.json(
        {
          error: `QuickBooks already uses the name “${name}” for a supplier or employee. Add the customer in QuickBooks under a different name, then use Pick another.`,
        },
        { status: 409 }
      );
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
  const r = await linkStudentToCustomer(service, {
    studentNumber,
    customerId,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
  });
  if (!r.ok)
    return NextResponse.json(
      { error: `Added to QuickBooks, but not linked: ${r.error}` },
      { status: r.status }
    );
  return NextResponse.json({ ok: true, displayName: r.displayName });
}
