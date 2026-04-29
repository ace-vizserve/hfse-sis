import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { requireCurrentAyCode } from "@/lib/academic-year";
import { logAction } from "@/lib/audit/log-action";
import { createServiceClient } from "@/lib/supabase/service";
import { DOCUMENT_SLOTS } from "@/lib/p-files/document-config";
import { runNotify } from "@/lib/p-files/notify-helpers";

// POST /api/p-files/[enroleeNumber]/notify
// Body: { slotKey: string }
//
// Sends a single-slot renewal reminder email to the student's parents /
// guardian. Enforces:
//   - Caller is `p-file` or `superadmin`.
//   - Student is currently Enrolled / Enrolled (Conditional) (P-Files
//     scope per KD #31; this is not a SIS document review surface).
//   - Slot is in an actionable state (expired / rejected / missing /
//     expiring within 60 days).
//   - 24h cooldown since the last reminder for the same (student, slot).
//
// On success: one row per recipient inserted into `p_file_outreach`,
// one `pfile.reminder.sent` audit row, JSON 200.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ enroleeNumber: string }> },
) {
  const auth = await requireRole(["p-file", "superadmin"]);
  if ("error" in auth) return auth.error;

  const { enroleeNumber } = await params;
  const body = await request.json().catch(() => null);
  const slotKey = body && typeof body.slotKey === "string" ? body.slotKey.trim() : "";
  if (!slotKey) {
    return NextResponse.json({ error: "slotKey is required" }, { status: 400 });
  }
  if (!DOCUMENT_SLOTS.some((s) => s.key === slotKey)) {
    return NextResponse.json({ error: `invalid slotKey: ${slotKey}` }, { status: 400 });
  }

  const service = createServiceClient();
  const ayCode = await requireCurrentAyCode(service);

  const result = await runNotify(service, auth.user, { ayCode, enroleeNumber, slotKey });

  if (!result.ok) {
    if (result.reason === "cooldown") {
      return NextResponse.json(
        {
          error:
            "A reminder for this slot was sent within the last 24 hours. Please wait before re-sending.",
          lastSentAt: result.cooldownLastSentAt,
        },
        { status: 429 },
      );
    }
    if (result.reason === "not_enrolled") {
      return NextResponse.json(
        { error: "Reminders are only available for enrolled students." },
        { status: 422 },
      );
    }
    if (result.reason === "no_recipients") {
      return NextResponse.json(
        { error: "No parent or guardian email is on file for this slot." },
        { status: 422 },
      );
    }
    if (result.reason === "no_actionable_status") {
      return NextResponse.json(
        { error: "This slot is not currently in an expired / rejected / missing / expiring state." },
        { status: 422 },
      );
    }
    if (result.reason === "send_failed") {
      return NextResponse.json(
        { error: "All reminder sends failed. Please retry shortly." },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: `Unable to send reminder: ${result.reason}` },
      { status: 422 },
    );
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: "pfile.reminder.sent",
    entityType: "enrolment_document",
    entityId: `${enroleeNumber}:${slotKey}`,
    context: {
      ay_code: ayCode,
      slot_key: slotKey,
      recipients: result.recipients,
      sent: result.sent,
      failed: result.failed,
    },
  });

  return NextResponse.json({
    ok: true,
    recipients: result.recipients,
    sent: result.sent,
    failed: result.failed,
  });
}
