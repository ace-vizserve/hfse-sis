import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { SIS_READ_FAILED } from '@/lib/billing/messages';
import { sameItemsFrom, type SameItemsRow } from '@/lib/billing/same-items';
import {
  connectedRealmId,
  qboErrorMessage,
  QboNotConnectedError,
} from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/billing/stage-items?stage=registration|fees — Create invoice from a
// stage → "Same items as last time": the product lines of the most recent
// invoice tied to that stage, any student (spec 2026-10-21). Read from the
// Billing copy of the invoices. `{ from: null, lines: [] }` when there is none.
export async function GET(request: NextRequest) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const stage = new URL(request.url).searchParams.get('stage');
  if (stage !== 'registration' && stage !== 'fees')
    return NextResponse.json(
      { error: 'Say which stage: registration or fees.' },
      { status: 400 }
    );
  const service = createServiceClient();
  let realmId: string | null;
  try {
    realmId = await connectedRealmId(service);
  } catch (e) {
    console.error('[billing] same items, connection lookup:', e);
    return NextResponse.json({ error: SIS_READ_FAILED }, { status: 500 });
  }
  if (!realmId)
    return NextResponse.json(
      { error: qboErrorMessage(new QboNotConnectedError()) },
      { status: 502 }
    );
  // Newest first; the first few with product lines are enough.
  const { data, error } = await service
    .from('qbo_invoices')
    .select('doc_number, txn_date, state, stage_keys, lines')
    .eq('realm_id', realmId)
    .contains('stage_keys', [stage])
    .neq('state', 'voided')
    .order('txn_date', { ascending: false, nullsFirst: false })
    .limit(25);
  if (error) {
    console.error('[billing] same items:', error.message);
    return NextResponse.json({ error: SIS_READ_FAILED }, { status: 500 });
  }
  return NextResponse.json(
    sameItemsFrom((data ?? []) as SameItemsRow[], stage) ?? {
      from: null,
      lines: [],
    }
  );
}
