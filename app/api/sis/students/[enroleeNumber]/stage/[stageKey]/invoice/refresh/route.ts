import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { qboErrorMessage } from '@/lib/qbo/client';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { finishRun, startRun } from '@/lib/qbo/runs';
import { isQboStageKey } from '@/lib/qbo/stage-state';
import { refreshInvoice } from '@/lib/qbo/sync';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice/refresh
// "Refresh from QuickBooks" on the tile — the same refresh the webhook and the
// hourly check run, for this stage's current invoice.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string; stageKey: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { enroleeNumber, stageKey } = await params;
  if (!isQboStageKey(stageKey)) {
    return NextResponse.json(
      { error: `Stage "${stageKey}" doesn't take QuickBooks invoices.` },
      { status: 400 }
    );
  }
  const parsed = z
    .object({ ayCode: z.string().regex(/^AY\d{4}$/i) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid ayCode' }, { status: 400 });
  const ayCode = parsed.data.ayCode.toUpperCase();
  const service = createServiceClient();
  const { data: row } = await service
    .from('qbo_invoices')
    .select('qbo_invoice_id')
    .eq('ay_code', ayCode)
    .eq('enrolee_number', enroleeNumber)
    .eq('stage_key', stageKey)
    .eq('is_current', true)
    .maybeSingle();
  if (!row)
    return NextResponse.json(
      { error: 'This stage has no QuickBooks invoice yet.' },
      { status: 404 }
    );

  const runId = await startRun(service, 'manual');
  try {
    const r = await refreshInvoice(service, row.qbo_invoice_id as string);
    await finishRun(service, runId, {
      invoicesUpdated: 1,
      error: r.stageError ?? null,
    });
    return NextResponse.json({
      ok: true,
      stageChanged: r.stageChanged,
      stageWarning: r.stageError
        ? `QuickBooks was read, but the stage wasn't updated: ${r.stageError}`
        : null,
    });
  } catch (e) {
    const message = qboErrorMessage(e);
    await finishRun(service, runId, { invoicesUpdated: 0, error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
