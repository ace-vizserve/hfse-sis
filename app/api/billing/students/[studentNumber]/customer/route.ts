import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { linkStudentToCustomer } from '@/lib/billing/link-student.server';
import { SIS_READ_FAILED } from '@/lib/billing/messages';
import { hfseCustomerName } from '@/lib/billing/review';
import {
  loadStudentInfo,
  type StudentInfo,
} from '@/lib/billing/students.server';
import {
  readCustomerForm,
  updateCustomer,
} from '@/lib/billing/customer-edit.server';
import {
  connectedRealmId,
  qbEscape,
  QboError,
  qboErrorMessage,
  QboNotConnectedError,
  qboQuery,
  qboRequest,
  WRITE_OUTCOME_UNKNOWN,
  writeOutcomeUnknown,
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
  let s: StudentInfo | undefined;
  try {
    s = (await loadStudentInfo(service, [studentNumber])).get(studentNumber);
  } catch (e) {
    console.error('[billing] add to QuickBooks, student lookup:', e);
    return NextResponse.json({ error: SIS_READ_FAILED }, { status: 500 });
  }
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
  // Already linked (another tab, another person): never add a second customer.
  let realmId: string | null;
  try {
    realmId = await connectedRealmId(service);
  } catch (e) {
    console.error('[billing] add to QuickBooks, connection lookup:', e);
    return NextResponse.json({ error: SIS_READ_FAILED }, { status: 500 });
  }
  if (!realmId)
    return NextResponse.json(
      { error: qboErrorMessage(new QboNotConnectedError()) },
      { status: 502 }
    );
  const { data: linked, error: linkedErr } = await service
    .from('qbo_customers')
    .select('qbo_customer_id')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (linkedErr) {
    console.error(
      '[billing] add to QuickBooks, link lookup:',
      linkedErr.message
    );
    return NextResponse.json({ error: SIS_READ_FAILED }, { status: 500 });
  }
  if (linked)
    return NextResponse.json(
      {
        error:
          'This student is already linked to a QuickBooks customer. Reload To review.',
      },
      { status: 409 }
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
  if (!r.ok) {
    console.error('[billing] add to QuickBooks, link failed:', r.error);
    return NextResponse.json(
      {
        error:
          "The customer was added to QuickBooks, but the SIS couldn't link it just now. Use Pick another and choose it — don't add it again.",
      },
      { status: r.status }
    );
  }
  return NextResponse.json({ ok: true, displayName: r.displayName });
}

const str = (max: number) => z.string().max(max).default('');
const CustomerFields = z.object({
  title: str(16),
  givenName: str(100),
  middleName: str(100),
  familyName: str(100),
  suffix: str(16),
  companyName: str(100),
  displayName: z
    .string()
    .trim()
    .min(1, 'Customer display name is required.')
    .max(500),
  email: z.union([z.literal(''), z.email('That is not an email address.')]),
  phone: str(30),
  mobile: str(30),
  fax: str(30),
  other: str(30),
  website: str(1000),
  billLine1: str(500),
  billLine2: str(500),
  billCity: str(255),
  billState: str(255),
  billPostalCode: str(30),
  billCountry: str(255),
  notes: str(2000),
});
const CustomerFormBody = CustomerFields.extend({
  /** The form as it opened (what changed is measured against it). */
  opened: z.record(z.string(), z.string()),
  /** The SyncToken of the version the form opened with. */
  syncToken: z.string().min(1).max(20),
  /** One id per Save; QuickBooks replays a repeated update. */
  requestId: z.string().uuid(),
});

/** The linked QuickBooks customer of a student, or a ready error response. */
async function linkedCustomer(studentNumber: string) {
  const service = createServiceClient();
  const realmId = await connectedRealmId(service).catch(() => null);
  if (!realmId)
    return {
      error: NextResponse.json(
        { error: qboErrorMessage(new QboNotConnectedError()) },
        { status: 502 }
      ),
    } as const;
  const { data, error } = await service
    .from('qbo_customers')
    .select('qbo_customer_id, display_name')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (error) {
    console.error('[billing] edit customer, link lookup:', error.message);
    return {
      error: NextResponse.json({ error: SIS_READ_FAILED }, { status: 500 }),
    } as const;
  }
  if (!data)
    return {
      error: NextResponse.json(
        { error: 'This student isn’t linked to a QuickBooks customer.' },
        { status: 404 }
      ),
    } as const;
  return {
    service,
    realmId,
    customerId: data.qbo_customer_id as string,
  } as const;
}

// GET /api/billing/students/[studentNumber]/customer — the customer's Edit
// form, read from QuickBooks.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber } = await params;
  const c = await linkedCustomer(studentNumber);
  if ('error' in c) return c.error;
  try {
    return NextResponse.json(await readCustomerForm(c.service, c.customerId));
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}

// PATCH /api/billing/students/[studentNumber]/customer — Edit → Save: the
// form written to the customer in QuickBooks (sparse update).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber } = await params;
  const parsed = CustomerFormBody.safeParse(
    (await request.json().catch(() => ({}))) ?? {}
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const c = await linkedCustomer(studentNumber);
  if ('error' in c) return c.error;
  const { requestId, syncToken, opened: openedRaw, ...form } = parsed.data;
  const opened = CustomerFields.parse(openedRaw);
  let result: Awaited<ReturnType<typeof updateCustomer>>;
  try {
    result = await updateCustomer(c.service, c.customerId, {
      form,
      opened,
      syncToken,
      requestId,
    });
  } catch (e) {
    if (writeOutcomeUnknown(e))
      return NextResponse.json(
        { error: WRITE_OUTCOME_UNKNOWN, keepRequestId: true },
        { status: 502 }
      );
    // QuickBooks' stale-object refusal: the customer changed there since the
    // form opened.
    if (e instanceof QboError && e.code === '5010')
      return NextResponse.json(
        {
          error:
            'This customer was changed in QuickBooks since you opened Edit. Close it and open Edit again to see the latest.',
        },
        { status: 409 }
      );
    const status = e instanceof QboError && e.status === 400 ? 422 : 502;
    return NextResponse.json({ error: qboErrorMessage(e) }, { status });
  }
  // QuickBooks has it; from here nothing reports failure.
  if (result.changed.length > 0) {
    if (result.saved.displayName !== opened.displayName) {
      const { error } = await c.service
        .from('qbo_customers')
        .update({ display_name: result.saved.displayName })
        .eq('qbo_customer_id', c.customerId)
        .eq('realm_id', c.realmId);
      if (error)
        console.error('[billing] edit customer, link name:', error.message);
    }
    await logAction({
      service: c.service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'qbo.customer.update',
      entityType: 'qbo_customer',
      entityId: c.customerId,
      context: {
        display_name: result.saved.displayName,
        student_number: studentNumber,
        changed: result.changed,
      },
    });
  }
  return NextResponse.json({ form: result.saved, changed: result.changed });
}
