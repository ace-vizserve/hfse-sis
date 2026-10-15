import { NextResponse, type NextRequest } from 'next/server';

import {
  QboNotConnectedError,
  qboErrorMessage,
  qboRequest,
} from '@/lib/qbo/client';
import { changedIdsFromCdc, processChanges } from '@/lib/qbo/cdc';
import { finishRun, startRun } from '@/lib/qbo/runs';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/quickbooks/cdc — Vercel Cron, hourly. Asks QuickBooks what changed
// since the last check (Change Data Capture) and refreshes those invoices.
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const service = createServiceClient();
  const { data: conn } = await service
    .from('qbo_connection')
    .select('last_cdc_at')
    .eq('id', 1)
    .maybeSingle();
  if (!conn) return NextResponse.json({ ok: true, skipped: 'not connected' });

  const startedAt = new Date();
  // QuickBooks only looks back 30 days; overlap the last check by 5 minutes.
  const floor = Date.now() - 29 * 24 * 3600 * 1000;
  const sinceMs = Math.max(
    floor,
    (conn.last_cdc_at
      ? Date.parse(conn.last_cdc_at)
      : Date.now() - 3600 * 1000) -
      5 * 60 * 1000
  );
  const runId = await startRun(service, 'hourly');
  let changed: ReturnType<typeof changedIdsFromCdc>;
  try {
    const json = await qboRequest<unknown>(
      service,
      'GET',
      `/cdc?entities=Invoice,Payment&changedSince=${encodeURIComponent(new Date(sinceMs).toISOString())}`
    );
    changed = changedIdsFromCdc(json);
  } catch (e) {
    // QuickBooks itself is unreachable: leave the cursor where it is, so the
    // next hourly run covers this same window again.
    const message =
      e instanceof QboNotConnectedError ? 'not connected' : qboErrorMessage(e);
    await finishRun(service, runId, { invoicesUpdated: 0, error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
  // The CDC fetch succeeded, so the window is covered. Per-invoice failures
  // are recorded on the run (SIS Admin shows them; staff use Refresh on the tile).
  try {
    const r = await processChanges(
      service,
      [
        ...changed.invoiceIds.map((id) => ({
          entity: 'Invoice' as const,
          id,
          operation: 'cdc',
        })),
        ...changed.paymentIds.map((id) => ({
          entity: 'Payment' as const,
          id,
          operation: 'cdc',
        })),
      ],
      {
        invoiceCustomers: changed.invoiceCustomers,
        paymentCustomers: changed.paymentCustomers,
      }
    );
    const { error: cursorErr } = await service
      .from('qbo_connection')
      .update({ last_cdc_at: startedAt.toISOString() })
      .eq('id', 1);
    if (cursorErr)
      throw new Error(
        `Saving the last-check time failed: ${cursorErr.message}`
      );
    await finishRun(service, runId, {
      invoicesUpdated: r.updated,
      error: r.errors.length ? r.errors.slice(0, 5).join(' · ') : null,
    });
    return NextResponse.json({
      ok: true,
      invoicesUpdated: r.updated,
      problems: r.errors.length,
    });
  } catch (e) {
    // Anything unexpected after the fetch is still recorded on the run.
    console.error('[qbo cdc]', e);
    const message = e instanceof Error ? e.message : qboErrorMessage(e);
    await finishRun(service, runId, { invoicesUpdated: 0, error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
