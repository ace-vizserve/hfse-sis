import { NextResponse } from 'next/server';

import { qboErrorMessage } from '@/lib/qbo/client';
import { processChanges } from '@/lib/qbo/cdc';
import { qboEnv } from '@/lib/qbo/env';
import { finishRun, startRun } from '@/lib/qbo/runs';
import { parseWebhookPayload, verifyIntuitSignature } from '@/lib/qbo/webhook';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/quickbooks/webhook — QuickBooks tells us an invoice or payment
// changed. Signed by Intuit (verifier token); unsigned calls are refused.
// The hourly check (/api/quickbooks/cdc) catches anything missed here.
export async function POST(request: Request) {
  const verifier = qboEnv()?.webhookVerifier;
  const raw = await request.text();
  if (
    !verifier ||
    !verifyIntuitSignature(
      raw,
      request.headers.get('intuit-signature'),
      verifier
    )
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const changes = parseWebhookPayload(json);
  if (changes.length === 0) return NextResponse.json({ ok: true });

  const service = createServiceClient();
  const runId = await startRun(service, 'webhook');
  try {
    const n = await processChanges(service, changes);
    await finishRun(service, runId, { invoicesUpdated: n, error: null });
  } catch (e) {
    console.error('[qbo webhook]', e);
    await finishRun(service, runId, {
      invoicesUpdated: 0,
      error: qboErrorMessage(e),
    });
  }
  // Always 200 once verified: a failure is recorded and the hourly check retries.
  return NextResponse.json({ ok: true });
}
