import { NextResponse, type NextRequest } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction, type AuditAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { runNotify } from '@/lib/p-files/notify-helpers';
import { resolveModule } from '@/lib/p-files/_shared';
import { NotifySchema } from '@/lib/schemas/p-files';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

// POST /api/p-files/[enroleeNumber]/notify
// Body: { slotKey: string; module?: 'p-files' | 'admissions' }
//
// Sends a single-slot reminder email to the student's parents / guardian.
// `module` (default 'p-files') selects the audit action + email tone:
//   - 'p-files' → 'pfile.reminder.sent' + renewal-tone email; gated to
//     Enrolled / Enrolled (Conditional) per KD #31.
//   - 'admissions' → 'admissions.reminder.sent' + initial-chase-tone
//     email; gated to active funnel statuses per KD #51.
//
// Other gates (24h cooldown, actionable status, recipient resolution)
// are unchanged across modules.
//
// On success: one outreach row inserted into `p_file_outreach`,
// one audit row, JSON 200.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  const { enroleeNumber } = await params;
  const body = await request.json().catch(() => null);
  const parsed = NotifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { slotKey } = parsed.data;
  const moduleKey = resolveModule(parsed.data.module);

  // Per-module gate, now by capability. Chasing an applicant and chasing an
  // enrolled student are different permissions, held by different people, and
  // one person can hold both — which is the whole point.
  //
  // Same holders as the role arrays this replaces: pre-enrolment chase is the
  // admissions team plus the coordinator and school_admin; post-enrolment chase
  // is the documents officer plus superadmin. A test pins that equivalence.
  //
  // Pre-existing ordering note, deliberately unchanged: the gate runs after the
  // body is parsed, because `moduleKey` comes from the body — so an
  // unauthenticated caller sees 400 before 401. Reordering would change status
  // codes, which belongs in its own change, not this migration.
  const auth = await requireCapability(
    moduleKey === 'admissions'
      ? 'documents_pre_enrolment.chase'
      : 'documents_post_enrolment.chase'
  );
  if ('error' in auth) return auth.error;

  const service = createServiceClient();
  const ayCode = await requireCurrentAyCode(service);

  const result = await runNotify(service, auth.user, {
    ayCode,
    enroleeNumber,
    slotKey,
    kind: moduleKey === 'admissions' ? 'initial-chase' : 'renewal',
  });

  if (!result.ok) {
    if (result.reason === 'cooldown') {
      return NextResponse.json(
        {
          error:
            'A reminder for this slot was sent within the last 24 hours. Please wait before re-sending.',
          lastSentAt: result.cooldownLastSentAt,
        },
        { status: 429 }
      );
    }
    if (result.reason === 'not_enrolled') {
      // Module-aware copy — for admissions, the gate is "active funnel
      // status" not "enrolled". Reuses the same outcome reason for
      // back-compat with existing P-Files callers.
      const message =
        moduleKey === 'admissions'
          ? 'Reminders are only available for applicants in the active funnel (Submitted / Ongoing Verification / Processing).'
          : 'Reminders are only available for enrolled students.';
      return NextResponse.json({ error: message }, { status: 422 });
    }
    if (result.reason === 'no_recipients') {
      return NextResponse.json(
        {
          error: 'No parent or guardian email is on file for this slot.',
          kind: 'no_recipients',
        },
        { status: 422 }
      );
    }
    if (result.reason === 'no_actionable_status') {
      return NextResponse.json(
        {
          error:
            'This slot is not currently in an expired / rejected / missing / expiring state.',
        },
        { status: 422 }
      );
    }
    if (result.reason === 'send_failed') {
      return NextResponse.json(
        { error: 'All reminder sends failed. Please retry shortly.' },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: `Unable to send reminder: ${result.reason}` },
      { status: 422 }
    );
  }

  const action: AuditAction =
    moduleKey === 'admissions'
      ? 'admissions.reminder.sent'
      : 'pfile.reminder.sent';
  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action,
    entityType: 'enrolment_document',
    entityId: `${enroleeNumber}:${slotKey}`,
    context: {
      ay_code: ayCode,
      slot_key: slotKey,
      module: moduleKey,
      recipients: result.recipients,
      sent: result.sent,
      failed: result.failed,
    },
  });

  invalidateDrillTags(moduleKey, ayCode);

  return NextResponse.json({
    ok: true,
    recipients: result.recipients,
    sent: result.sent,
    failed: result.failed,
  });
}
