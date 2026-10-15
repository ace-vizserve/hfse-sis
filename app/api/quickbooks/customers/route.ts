import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import {
  connectedRealmId,
  qbEscape,
  QboError,
  qboErrorMessage,
  qboQuery,
  qboRequest,
} from '@/lib/qbo/client';
import {
  exactMatches,
  newCustomerName,
  normalizeName,
  studentNameForms,
} from '@/lib/qbo/customer-match';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

type QbCustomer = { Id: string; DisplayName: string };
const view = (c: QbCustomer) => ({ id: c.Id, displayName: c.DisplayName });

// GET /api/quickbooks/customers?ay&enrolee[&q][&fresh=1]
// The stored match first (only one remembered from the QuickBooks company
// connected now); otherwise QuickBooks customers sharing the student's last
// name, split into exact full-name matches and the rest. `q` searches by any
// text the person types instead; `fresh=1` skips the stored match.
export async function GET(request: NextRequest) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  const enrolee = (url.searchParams.get('enrolee') ?? '').trim();
  const q = (url.searchParams.get('q') ?? '').trim();
  const fresh = url.searchParams.get('fresh') === '1';
  if (!/^AY\d{4}$/i.test(ayCode) || !enrolee) {
    return NextResponse.json(
      { error: 'Missing ay or enrolee' },
      { status: 400 }
    );
  }

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const { data: app } = await createAdmissionsClient()
    .from(`${prefix}_enrolment_applications`)
    .select('studentNumber, enroleeFullName, firstName, middleName, lastName')
    .eq('enroleeNumber', enrolee)
    .maybeSingle();
  if (!app)
    return NextResponse.json(
      { error: 'Application not found' },
      { status: 404 }
    );
  const a = app as {
    studentNumber: string | null;
    enroleeFullName: string | null;
    firstName: string | null;
    middleName: string | null;
    lastName: string | null;
  };

  const service = createServiceClient();
  // `fresh=1` — staff clicked Change on the remembered customer: skip it and
  // show the matches by last name instead.
  if (!q && !fresh && a.studentNumber) {
    let realmId: string | null;
    try {
      realmId = await connectedRealmId(service);
    } catch (e) {
      return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
    }
    const { data: stored } = await service
      .from('qbo_customers')
      .select('qbo_customer_id, display_name, realm_id')
      .eq('student_number', a.studentNumber)
      .maybeSingle();
    // A match remembered from a different QuickBooks company is not used.
    if (stored && realmId && stored.realm_id === realmId) {
      return NextResponse.json({
        linked: {
          id: stored.qbo_customer_id,
          displayName: stored.display_name,
        },
        exact: [],
        similar: [],
      });
    }
  }

  try {
    const newName = newCustomerName(a);
    const term = q || (a.lastName ?? '').trim();
    if (!term)
      return NextResponse.json({
        linked: null,
        exact: [],
        similar: [],
        newName,
      });
    const found = await qboQuery<QbCustomer>(
      service,
      'Customer',
      `Active = true and DisplayName LIKE '%${qbEscape(term)}%'`,
      'maxresults 50'
    );
    const exact = q ? [] : exactMatches(found, studentNameForms(a));
    const exactIds = new Set(exact.map((c) => c.Id));
    const similar = found
      .filter((c) => !exactIds.has(c.Id))
      .sort((x, y) =>
        normalizeName(x.DisplayName).localeCompare(normalizeName(y.DisplayName))
      )
      .slice(0, 20);
    return NextResponse.json({
      linked: null,
      exact: exact.map(view),
      similar: similar.map(view),
      newName,
    });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}

// POST /api/quickbooks/customers { ayCode, enroleeNumber }
// Adds the student to QuickBooks as a customer under their full name, for the
// Create invoice sheet when no customer has it yet. Nothing is stored in the
// SIS here — the invoice save remembers the customer, as for a picked one.
export async function POST(request: NextRequest) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const body = (await request.json().catch(() => null)) as {
    ayCode?: unknown;
    enroleeNumber?: unknown;
  } | null;
  const ayCode = typeof body?.ayCode === 'string' ? body.ayCode.trim() : '';
  const enrolee =
    typeof body?.enroleeNumber === 'string' ? body.enroleeNumber.trim() : '';
  if (!/^AY\d{4}$/i.test(ayCode) || !enrolee) {
    return NextResponse.json(
      { error: 'Missing ayCode or enroleeNumber' },
      { status: 400 }
    );
  }

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const { data: app } = await createAdmissionsClient()
    .from(`${prefix}_enrolment_applications`)
    .select('studentNumber, enroleeFullName, firstName, middleName, lastName')
    .eq('enroleeNumber', enrolee)
    .maybeSingle();
  if (!app)
    return NextResponse.json(
      { error: 'Application not found' },
      { status: 404 }
    );
  const a = app as {
    studentNumber: string | null;
    enroleeFullName: string | null;
    firstName: string | null;
    middleName: string | null;
    lastName: string | null;
  };
  const name = newCustomerName(a);
  if (!name) {
    return NextResponse.json(
      { error: 'This student has no name on record to give the customer.' },
      { status: 422 }
    );
  }

  const service = createServiceClient();
  try {
    // QuickBooks refuses a second customer with the same name, active or not.
    const same = await qboQuery<QbCustomer & { Active: boolean }>(
      service,
      'Customer',
      `Active IN (true, false) and DisplayName = '${qbEscape(name)}'`,
      'maxresults 1'
    );
    if (same[0]?.Active) return NextResponse.json({ customer: view(same[0]) });
    if (same[0]) {
      return NextResponse.json(
        {
          error: `QuickBooks has an inactive customer named “${name}”. Make it active in QuickBooks, then pick it here.`,
        },
        { status: 409 }
      );
    }

    const created = await qboRequest<{ Customer: QbCustomer }>(
      service,
      'POST',
      '/customer',
      {
        DisplayName: name,
        ...(a.firstName?.trim() ? { GivenName: a.firstName.trim() } : {}),
        ...(a.middleName?.trim() ? { MiddleName: a.middleName.trim() } : {}),
        ...(a.lastName?.trim() ? { FamilyName: a.lastName.trim() } : {}),
      }
    );
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'qbo.customer.create',
      entityType: 'qbo_customer',
      entityId: created.Customer.Id,
      context: {
        display_name: created.Customer.DisplayName,
        student_number: a.studentNumber,
        enrolee_number: enrolee,
        ay_code: ayCode.toUpperCase(),
      },
    });
    return NextResponse.json({ customer: view(created.Customer) });
  } catch (e) {
    // 6240: the name is taken by a vendor or employee, which the check above
    // can't see.
    if (e instanceof QboError && e.code === '6240') {
      return NextResponse.json(
        {
          error: `QuickBooks already uses the name “${name}” for a vendor or employee. Add the customer in QuickBooks under a different name, then pick it here.`,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
