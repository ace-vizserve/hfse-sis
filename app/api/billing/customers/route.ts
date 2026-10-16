import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import {
  connectedRealmId,
  qbEscape,
  qboErrorMessage,
  qboQuery,
} from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/billing/customers?q= — QuickBooks customers whose name contains q,
// for To review → Pick another. Never a sub-customer; each says which student
// already has it.
export async function GET(request: NextRequest) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ customers: [] });
  const service = createServiceClient();
  try {
    const realmId = await connectedRealmId(service);
    const found = await qboQuery<{
      Id: string;
      DisplayName: string;
      Job?: boolean;
      ParentRef?: unknown;
      FullyQualifiedName?: string;
    }>(
      service,
      'Customer',
      `Active = true and DisplayName LIKE '%${qbEscape(q)}%'`,
      'orderby DisplayName maxresults 50'
    );
    const students = found.filter(
      (c) =>
        !c.Job &&
        c.ParentRef == null &&
        !(c.FullyQualifiedName ?? '').includes(':')
    );
    const { data: held } = await service
      .from('qbo_customers')
      .select('qbo_customer_id, student_number')
      .eq('realm_id', realmId ?? '')
      .in(
        'qbo_customer_id',
        students.map((c) => c.Id)
      );
    const holder = new Map(
      (held ?? []).map((h) => [
        h.qbo_customer_id as string,
        h.student_number as string,
      ])
    );
    return NextResponse.json({
      customers: students.slice(0, 30).map((c) => ({
        id: c.Id,
        displayName: c.DisplayName,
        linkedTo: holder.get(c.Id) ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
