import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { SIS_READ_FAILED } from '@/lib/billing/messages';
import {
  connectedRealmId,
  qboErrorMessage,
  qboRequest,
} from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/billing/invoices/[invoiceId]/pdf — QuickBooks' own PDF of the
// invoice (what "Print or download" gives in QuickBooks). Only an invoice of
// a linked student's customer. `?download=1` saves it instead of opening it.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { invoiceId } = await params;
  const service = createServiceClient();
  const realmId = await connectedRealmId(service).catch(() => null);
  const { data: row, error } = await service
    .from('qbo_invoices')
    .select('qbo_invoice_id, doc_number')
    .eq('qbo_invoice_id', invoiceId)
    .eq('realm_id', realmId ?? '')
    .maybeSingle();
  if (error) {
    console.error('[billing] invoice pdf, lookup:', error.message);
    return NextResponse.json({ error: SIS_READ_FAILED }, { status: 500 });
  }
  if (!row)
    return NextResponse.json(
      { error: 'That invoice is not one of a linked student’s.' },
      { status: 404 }
    );
  try {
    const pdf = await qboRequest<ArrayBuffer>(
      service,
      'GET',
      `/invoice/${encodeURIComponent(invoiceId)}/pdf`,
      undefined,
      { as: 'pdf' }
    );
    const name = `Invoice ${row.doc_number ?? invoiceId}.pdf`.replace(
      /[^\w .-]/g,
      ''
    );
    const download = new URL(request.url).searchParams.get('download');
    return new NextResponse(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}
