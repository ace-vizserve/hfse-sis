import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import {
  connectedRealmId,
  qbEscape,
  qboErrorMessage,
  qboQuery,
} from '@/lib/qbo/client';
import {
  exactMatches,
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
    const term = q || (a.lastName ?? '').trim();
    if (!term)
      return NextResponse.json({ linked: null, exact: [], similar: [] });
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
    });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
