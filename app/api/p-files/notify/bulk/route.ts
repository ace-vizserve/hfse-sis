import { NextResponse, type NextRequest } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction, type AuditAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { runNotify, type NotifyOutcome } from '@/lib/p-files/notify-helpers';
import { resolveModule } from '@/lib/p-files/_shared';
import { BulkNotifySchema } from '@/lib/schemas/p-files';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

type BulkItem = { enroleeNumber: string; slotKey: string };

// POST /api/p-files/notify/bulk
// Body: {
//   items: Array<{ enroleeNumber: string; slotKey: string }>;
//   module?: 'p-files' | 'admissions';
// }
//
// Fans out single-slot notifies for the registrar's bulk action. Each
// item runs the same gating as the single endpoint (scope-status,
// actionable status, 24h cooldown). Cooldown / no-recipient / not-in-scope
// failures are tallied as 'skipped' rather than aborting the whole call.
// `module` (default 'p-files') selects audit action + email tone exactly
// like the single-slot route.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = BulkNotifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const moduleKey = resolveModule(parsed.data.module);
  const validItems: BulkItem[] = parsed.data.items;

  // Per-module gate, by capability — same holders as the role arrays this
  // replaces (see the single-slot notify route for the full note).
  const auth = await requireCapability(
    moduleKey === 'admissions'
      ? 'documents_pre_enrolment.chase'
      : 'documents_post_enrolment.chase'
  );
  if ('error' in auth) return auth.error;

  const service = createServiceClient();
  const ayCode = await requireCurrentAyCode(service);

  let sent = 0;
  let failed = 0;
  let skippedCooldown = 0;
  let skippedNotEnrolled = 0;
  let skippedNoRecipients = 0;
  let skippedNotActionable = 0;
  let recipientsTotal = 0;

  const CONCURRENCY = 8;
  const kind: 'initial-chase' | 'renewal' =
    moduleKey === 'admissions' ? 'initial-chase' : 'renewal';

  type RowResult = { item: BulkItem; outcome: NotifyOutcome };
  const rowResults: RowResult[] = [];

  for (let i = 0; i < validItems.length; i += CONCURRENCY) {
    const chunk = validItems.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (item) => {
        const outcome = await runNotify(service, auth.user, {
          ayCode,
          enroleeNumber: item.enroleeNumber,
          slotKey: item.slotKey,
          kind,
        });
        return { item, outcome } satisfies RowResult;
      })
    );
    rowResults.push(...chunkResults);

    for (const { outcome } of chunkResults) {
      if (outcome.ok) {
        sent += outcome.sent;
        failed += outcome.failed;
        recipientsTotal += outcome.recipients;
        continue;
      }
      switch (outcome.reason) {
        case 'cooldown':
          skippedCooldown += 1;
          break;
        case 'not_enrolled':
          skippedNotEnrolled += 1;
          break;
        case 'no_recipients':
          skippedNoRecipients += 1;
          break;
        case 'no_actionable_status':
          skippedNotActionable += 1;
          break;
        case 'send_failed':
          failed += outcome.recipients ?? 0;
          break;
        default:
          failed += 1;
      }
    }
  }

  const action: AuditAction =
    moduleKey === 'admissions'
      ? 'admissions.reminder.bulk'
      : 'pfile.reminder.bulk';
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action,
    entityType: 'enrolment_document',
    entityId: `${ayCode}:bulk`,
    context: {
      ay_code: ayCode,
      module: moduleKey,
      requested: validItems.length,
      sent,
      failed,
      recipients: recipientsTotal,
      skipped_cooldown: skippedCooldown,
      skipped_not_enrolled: skippedNotEnrolled,
      skipped_no_recipients: skippedNoRecipients,
      skipped_not_actionable: skippedNotActionable,
    },
  });

  if (sent > 0) {
    invalidateDrillTags(moduleKey, ayCode);
  }

  return NextResponse.json({
    ok: true,
    requested: validItems.length,
    sent,
    failed,
    recipients: recipientsTotal,
    skippedCooldown,
    skippedNotEnrolled,
    skippedNoRecipients,
    skippedNotActionable,
  });
}
