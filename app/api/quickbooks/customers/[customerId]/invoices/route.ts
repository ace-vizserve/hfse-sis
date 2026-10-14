import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import {
  connectedRealmId,
  qbEscape,
  qboErrorMessage,
  qboQuery,
} from '@/lib/qbo/client';
import type { QbInvoice } from '@/lib/qbo/invoice-snapshot';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/quickbooks/customers/[customerId]/invoices — that customer's open
// invoices that no stage has linked yet, newest first.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { customerId } = await params;
  const service = createServiceClient();
  try {
    const invoices = await qboQuery<QbInvoice>(
      service,
      'Invoice',
      `CustomerRef = '${qbEscape(customerId)}' and Balance > '0'`,
      'orderby TxnDate desc maxresults 50'
    );
    if (invoices.length === 0) return NextResponse.json({ invoices: [] });
    const realmId = await connectedRealmId(service);
    const { data: linked } = await service
      .from('qbo_invoices')
      .select('qbo_invoice_id')
      .eq('realm_id', realmId ?? '')
      .in(
        'qbo_invoice_id',
        invoices.map((i) => i.Id)
      );
    const taken = new Set(
      (linked ?? []).map((r) => r.qbo_invoice_id as string)
    );
    return NextResponse.json({
      invoices: invoices
        .filter((i) => !taken.has(i.Id))
        .map((i) => ({
          id: i.Id,
          docNumber: i.DocNumber ?? null,
          txnDate: i.TxnDate ?? null,
          total: Number(i.TotalAmt),
          balance: Number(i.Balance),
        })),
    });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
