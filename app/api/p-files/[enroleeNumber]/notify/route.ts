import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { requireCurrentAyCode } from "@/lib/academic-year";
import { logAction, type AuditAction } from "@/lib/audit/log-action";
import { createServiceClient } from "@/lib/supabase/service";
import { DOCUMENT_SLOTS } from "@/lib/p-files/document-config";
import { runNotify } from "@/lib/p-files/notify-helpers";

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
// On success: one row per recipient inserted into `p_file_outreach`,
// one audit row, JSON 200.
const MODULE_VALUES = new Set(["p-files", "admissions"]);

type ChaseModule = "p-files" | "admissions";

function resolveModule(raw: unknown): ChaseModule {
  if (typeof raw === "string" && MODULE_VALUES.has(raw)) return raw as ChaseModule;
  return "p-files";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ enroleeNumber: string }> },
) {
  // Role gate widened to allow admissions team when chasing pre-enrolment
  // documents (module='admissions'). P-Files renewal chase keeps the
  // existing p-file + superadmin scope. requireRole here is a union; the
  // module-aware not_enrolled check + audit action enforce the right scope
  // downstream.
  const auth = await requireRole([
    "p-file",
    "admissions",
    "registrar",
    "school_admin",
    "superadmin",
  ]);
  if ("error" in auth) return auth.error;

  const { enroleeNumber } = await params;
  const body = await request.json().catch(() => null);
  const slotKey = body && typeof body.slotKey === "string" ? body.slotKey.trim() : "";
  const moduleKey = resolveModule(body?.module);
  if (!slotKey) {
    return NextResponse.json({ error: "slotKey is required" }, { status: 400 });
  }
  if (!DOCUMENT_SLOTS.some((s) => s.key === slotKey)) {
    return NextResponse.json({ error: `invalid slotKey: ${slotKey}` }, { status: 400 });
  }

  const service = createServiceClient();
  const ayCode = await requireCurrentAyCode(service);

  const result = await runNotify(service, auth.user, {
    ayCode,
    enroleeNumber,
    slotKey,
    kind: moduleKey === "admissions" ? "initial-chase" : "renewal",
  });

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
      // Module-aware copy — for admissions, the gate is "active funnel
      // status" not "enrolled". Reuses the same outcome reason for
      // back-compat with existing P-Files callers.
      const message =
        moduleKey === "admissions"
          ? "Reminders are only available for applicants in the active funnel (Submitted / Ongoing Verification / Processing)."
          : "Reminders are only available for enrolled students.";
      return NextResponse.json({ error: message }, { status: 422 });
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

  const action: AuditAction =
    moduleKey === "admissions" ? "admissions.reminder.sent" : "pfile.reminder.sent";
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action,
    entityType: "enrolment_document",
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

  return NextResponse.json({
    ok: true,
    recipients: result.recipients,
    sent: result.sent,
    failed: result.failed,
  });
}
