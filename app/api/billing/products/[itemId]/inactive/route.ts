import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { makeItemInactive } from '@/lib/billing/products.server';
import {
  connectedRealmId,
  QboError,
  qboErrorMessage,
  QboNotConnectedError,
  writeOutcomeUnknown,
} from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = z.object({ requestId: z.string().uuid() });

// POST /api/billing/products/[itemId]/inactive — Make inactive, as QuickBooks
// does it: the item stays, with its history, but is no longer offered.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { itemId } = await params;
  if (!/^\d+$/.test(itemId))
    return NextResponse.json(
      { error: 'There is no such product or service.' },
      { status: 404 }
    );
  const parsed = Body.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  const service = createServiceClient();
  if (!(await connectedRealmId(service).catch(() => null)))
    return NextResponse.json(
      { error: qboErrorMessage(new QboNotConnectedError()) },
      { status: 502 }
    );
  let r: { name: string; changed: boolean };
  try {
    r = await makeItemInactive(service, itemId, parsed.data.requestId);
  } catch (e) {
    const status = e instanceof QboError && e.status === 400 ? 422 : 502;
    return NextResponse.json(
      { error: qboErrorMessage(e), keepRequestId: writeOutcomeUnknown(e) },
      { status }
    );
  }
  if (r.changed)
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'qbo.item.update',
      entityType: 'qbo_item',
      entityId: itemId,
      context: { name: r.name, changed: ['Made inactive'] },
    });
  return NextResponse.json(r);
}
