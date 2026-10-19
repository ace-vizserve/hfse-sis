import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ProductFormBody } from '@/lib/billing/product-form';
import {
  NotAServiceError,
  readProductForm,
  updateService,
} from '@/lib/billing/products.server';
import {
  connectedRealmId,
  QboError,
  qboErrorMessage,
  QboNotConnectedError,
  writeOutcomeUnknown,
} from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

async function connected(itemId: string) {
  if (!/^\d+$/.test(itemId))
    return {
      error: NextResponse.json(
        { error: 'There is no such product or service.' },
        { status: 404 }
      ),
    } as const;
  const service = createServiceClient();
  const realmId = await connectedRealmId(service).catch(() => null);
  if (!realmId)
    return {
      error: NextResponse.json(
        { error: qboErrorMessage(new QboNotConnectedError()) },
        { status: 502 }
      ),
    } as const;
  return { service } as const;
}

// GET /api/billing/products/[itemId] — the Edit form, read from QuickBooks.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { itemId } = await params;
  const c = await connected(itemId);
  if ('error' in c) return c.error;
  try {
    return NextResponse.json(await readProductForm(c.service, itemId));
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}

// PATCH /api/billing/products/[itemId] — Edit → Save on a Service item
// (sparse update).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { itemId } = await params;
  const parsed = ProductFormBody.safeParse(
    (await request.json().catch(() => ({}))) ?? {}
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const c = await connected(itemId);
  if ('error' in c) return c.error;
  const { requestId, ...form } = parsed.data;
  let result: { name: string; changed: string[] };
  try {
    result = await updateService(c.service, itemId, form, requestId);
  } catch (e) {
    if (e instanceof NotAServiceError)
      return NextResponse.json({ error: e.message }, { status: 422 });
    const status = e instanceof QboError && e.status === 400 ? 422 : 502;
    return NextResponse.json(
      { error: qboErrorMessage(e), keepRequestId: writeOutcomeUnknown(e) },
      { status }
    );
  }
  if (result.changed.length > 0)
    await logAction({
      service: c.service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'qbo.item.update',
      entityType: 'qbo_item',
      entityId: itemId,
      context: { name: result.name, changed: result.changed },
    });
  return NextResponse.json(result);
}
