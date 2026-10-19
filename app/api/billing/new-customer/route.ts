import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { SIS_READ_FAILED } from '@/lib/billing/messages';
import {
  listStudentsWithoutCustomer,
  newCustomerDraft,
} from '@/lib/billing/new-customer.server';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/billing/new-customer — the students with no QuickBooks customer.
// GET /api/billing/new-customer?student=H… — the New customer form for one,
// filled from their newest application. Read-only; the customer is added by
// POST /api/billing/students/[studentNumber]/customer.
export async function GET(request: Request) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const service = createServiceClient();
  const student = new URL(request.url).searchParams.get('student');
  try {
    if (!student)
      return NextResponse.json({
        students: await listStudentsWithoutCustomer(service),
      });
    const form = await newCustomerDraft(service, student);
    if (!form)
      return NextResponse.json(
        { error: 'There is no student with that student number.' },
        { status: 404 }
      );
    return NextResponse.json({ form });
  } catch (e) {
    console.error('[billing] new customer:', e);
    return NextResponse.json({ error: SIS_READ_FAILED }, { status: 500 });
  }
}
