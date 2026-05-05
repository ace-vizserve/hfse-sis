import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { requireCurrentAyCode } from "@/lib/academic-year";
import { logAction, type AuditAction } from "@/lib/audit/log-action";
import { createServiceClient } from "@/lib/supabase/service";
import { DOCUMENT_SLOTS } from "@/lib/p-files/document-config";
import { runNotify, type NotifyOutcome } from "@/lib/p-files/notify-helpers";

const MAX_BULK_ITEMS = 50;

type BulkItem = { enroleeNumber: string; slotKey: string };

const MODULE_VALUES = new Set(["p-files", "admissions"]);

type ChaseModule = "p-files" | "admissions";

function resolveModule(raw: unknown): ChaseModule {
  if (typeof raw === "string" && MODULE_VALUES.has(raw)) return raw as ChaseModule;
  return "p-files";
}

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
  const auth = await requireRole([
    "p-file",
    "admissions",
    "registrar",
    "school_admin",
    "superadmin",
  ]);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const items = body && Array.isArray(body.items) ? (body.items as unknown[]) : null;
  const moduleKey = resolveModule(body?.module);
  if (!items || items.length === 0) {
    return NextResponse.json({ error: "items[] is required" }, { status: 400 });
  }
  if (items.length > MAX_BULK_ITEMS) {
    return NextResponse.json(
      { error: `Too many items (max ${MAX_BULK_ITEMS}).` },
      { status: 400 },
    );
  }

  const slotKeySet = new Set(DOCUMENT_SLOTS.map((s) => s.key));
  const validItems: BulkItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "Invalid item shape" }, { status: 400 });
    }
    const item = raw as Record<string, unknown>;
    const enroleeNumber = typeof item.enroleeNumber === "string" ? item.enroleeNumber.trim() : "";
    const slotKey = typeof item.slotKey === "string" ? item.slotKey.trim() : "";
    if (!enroleeNumber || !slotKey || !slotKeySet.has(slotKey)) {
      return NextResponse.json(
        { error: `Invalid item: ${JSON.stringify(item)}` },
        { status: 400 },
      );
    }
    validItems.push({ enroleeNumber, slotKey });
  }

  const service = createServiceClient();
  const ayCode = await requireCurrentAyCode(service);

  let sent = 0;
  let failed = 0;
  let skippedCooldown = 0;
  let skippedNotEnrolled = 0;
  let skippedNoRecipients = 0;
  let skippedNotActionable = 0;
  let recipientsTotal = 0;

  type RowResult = { item: BulkItem; outcome: NotifyOutcome };
  const rowResults: RowResult[] = [];
  for (const item of validItems) {
    const outcome = await runNotify(service, auth.user, {
      ayCode,
      enroleeNumber: item.enroleeNumber,
      slotKey: item.slotKey,
      kind: moduleKey === "admissions" ? "initial-chase" : "renewal",
    });
    rowResults.push({ item, outcome });

    if (outcome.ok) {
      sent += outcome.sent;
      failed += outcome.failed;
      recipientsTotal += outcome.recipients;
      continue;
    }
    switch (outcome.reason) {
      case "cooldown":
        skippedCooldown += 1;
        break;
      case "not_enrolled":
        skippedNotEnrolled += 1;
        break;
      case "no_recipients":
        skippedNoRecipients += 1;
        break;
      case "no_actionable_status":
        skippedNotActionable += 1;
        break;
      case "send_failed":
        failed += outcome.recipients ?? 0;
        break;
      default:
        // unknown_slot / no_application_row / no_status_row — count as failed.
        failed += 1;
    }
  }

  const action: AuditAction =
    moduleKey === "admissions" ? "admissions.reminder.bulk" : "pfile.reminder.bulk";
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action,
    entityType: "enrolment_document",
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
