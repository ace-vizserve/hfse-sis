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
// for To review → Pick another and Create invoice's step 1. Never a
// sub-customer; each says which student already has it. Inactive customers are
// listed too (flagged `active: false`) — a name QuickBooks calls taken is often
// an inactive one, and staff need to see it to make it active there first.
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
      Active?: boolean;
      Job?: boolean;
      ParentRef?: unknown;
      FullyQualifiedName?: string;
    }>(
      service,
      'Customer',
      // QuickBooks leaves inactive records out unless the query names both.
      `Active IN (true, false) and DisplayName LIKE '%${qbEscape(q)}%'`,
      'orderby DisplayName maxresults 50'
    );
    const students = found
      .filter(
        (c) =>
          !c.Job &&
          c.ParentRef == null &&
          !(c.FullyQualifiedName ?? '').includes(':')
      )
      // Active ones first; the sort is stable, so each half keeps name order.
      .sort((a, b) => Number(a.Active === false) - Number(b.Active === false));
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
        active: c.Active !== false,
        linkedTo: holder.get(c.Id) ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
