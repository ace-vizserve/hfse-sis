import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ProductFormBody } from '@/lib/billing/product-form';
import {
  createService,
  readProductFormOptions,
} from '@/lib/billing/products.server';
import {
  connectedRealmId,
  QboError,
  qboErrorMessage,
  QboNotConnectedError,
  WRITE_OUTCOME_UNKNOWN,
  writeOutcomeUnknown,
} from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

async function connected() {
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

// GET /api/billing/products — the New service / Edit form's pickers: the
// QuickBooks income accounts and product categories.
export async function GET() {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const c = await connected();
  if ('error' in c) return c.error;
  try {
    return NextResponse.json(await readProductFormOptions(c.service));
  } catch (e) {
    return NextResponse.json({ error: qboErrorMessage(e) }, { status: 502 });
  }
}

// POST /api/billing/products — New product/service → Service: a Service
// item created in QuickBooks.
export async function POST(request: Request) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const parsed = ProductFormBody.safeParse(
    (await request.json().catch(() => ({}))) ?? {}
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const c = await connected();
  if ('error' in c) return c.error;
  const { requestId, ...form } = parsed.data;
  let created: { id: string; name: string };
  try {
    created = await createService(c.service, form, requestId);
  } catch (e) {
    const status = e instanceof QboError && e.status === 400 ? 422 : 502;
    return NextResponse.json(
      writeOutcomeUnknown(e)
        ? { error: WRITE_OUTCOME_UNKNOWN, keepRequestId: true }
        : { error: qboErrorMessage(e) },
      { status }
    );
  }
  // QuickBooks has it; from here nothing reports failure.
  await logAction({
    service: c.service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: 'qbo.item.create',
    entityType: 'qbo_item',
    entityId: created.id,
    context: { name: created.name, type: 'Service' },
  });
  return NextResponse.json({ id: created.id, name: created.name });
}
