import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DOCUMENT_SLOTS } from "@/lib/p-files/document-config";
import {
  type SlotStatusKind,
  type RecipientCandidate,
  resolveRecipients,
  sendReminder,
} from "@/lib/notifications/email-pfile-reminder";
import { getActiveCooldown } from "@/lib/p-files/outreach";

// Shared orchestration used by both the single-slot notify route and the
// bulk fan-out wrapper. Per call: looks up the student + slot context,
// enforces enrolled-only + 24h cooldown gates, sends the reminder,
// inserts one p_file_outreach row per successful send.
//
// Returns a summary suitable for both surface and audit logging. Does
// not write the audit_log row itself — the caller does that so it can
// log a single bulk-totals entry instead of N per-item entries.

const ENROLLED_STATUSES = new Set(["Enrolled", "Enrolled (Conditional)"]);

const EXPIRING_SOON_DAYS = 60;

export type NotifyOutcome =
  | { ok: true; recipients: number; sent: number; failed: number }
  | {
      ok: false;
      reason:
        | "unknown_slot"
        | "no_application_row"
        | "no_status_row"
        | "not_enrolled"
        | "no_recipients"
        | "no_actionable_status"
        | "cooldown"
        | "send_failed";
      cooldownLastSentAt?: string;
      recipients?: number;
    };

export type NotifyContext = {
  ayCode: string;
  enroleeNumber: string;
  slotKey: string;
};

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, "").toLowerCase()}`;
}

function fullName(app: Record<string, unknown>): string {
  const last = (app.lastName as string | null) ?? "";
  const first = (app.firstName as string | null) ?? "";
  const middle = (app.middleName as string | null) ?? "";
  const composed = `${first}${middle ? ` ${middle}` : ""} ${last}`.trim();
  return composed || ((app.enroleeFullName as string | null) ?? "Student");
}

function classifyStatus(
  status: string | null,
  url: string | null,
  expiry: string | null,
): SlotStatusKind | null {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "rejected") return "rejected";
  if (s === "expired") return "expired";
  if (!url && !status) return "missing";
  // Only flag expiringSoon when slot is currently 'Valid' and within window.
  if (s === "valid" && expiry) {
    const diff = (new Date(expiry).getTime() - Date.now()) / 86_400_000;
    if (diff <= EXPIRING_SOON_DAYS && diff > -0.5) return "expiringSoon";
  }
  return null;
}

export async function runNotify(
  service: SupabaseClient,
  actor: { id: string; email: string | null },
  ctx: NotifyContext,
): Promise<NotifyOutcome> {
  const slot = DOCUMENT_SLOTS.find((s) => s.key === ctx.slotKey);
  if (!slot) return { ok: false, reason: "unknown_slot" };

  const prefix = prefixFor(ctx.ayCode);

  const [appRes, statusRes, docsRes] = await Promise.all([
    service
      .from(`${prefix}_enrolment_applications`)
      .select(
        '"enroleeNumber","firstName","middleName","lastName","enroleeFullName","motherEmail","fatherEmail","guardianEmail"',
      )
      .eq("enroleeNumber", ctx.enroleeNumber)
      .maybeSingle(),
    service
      .from(`${prefix}_enrolment_status`)
      .select('"applicationStatus","classLevel","classSection"')
      .eq("enroleeNumber", ctx.enroleeNumber)
      .maybeSingle(),
    service
      .from(`${prefix}_enrolment_documents`)
      .select(`"${ctx.slotKey}","${ctx.slotKey}Status"${slot.expires ? `,"${ctx.slotKey}Expiry"` : ""}`)
      .eq("enroleeNumber", ctx.enroleeNumber)
      .maybeSingle(),
  ]);

  if (!appRes.data) return { ok: false, reason: "no_application_row" };
  if (!statusRes.data) return { ok: false, reason: "no_status_row" };

  const app = appRes.data as unknown as Record<string, unknown>;
  const statusRow = statusRes.data as unknown as Record<string, unknown>;
  const docsRow = (docsRes.data ?? {}) as unknown as Record<string, unknown>;

  const applicationStatus = (statusRow.applicationStatus as string | null) ?? null;
  if (!applicationStatus || !ENROLLED_STATUSES.has(applicationStatus)) {
    return { ok: false, reason: "not_enrolled" };
  }

  const slotUrl = (docsRow[ctx.slotKey] as string | null) ?? null;
  const slotStatus = (docsRow[`${ctx.slotKey}Status`] as string | null) ?? null;
  const slotExpiry = slot.expires ? ((docsRow[`${ctx.slotKey}Expiry`] as string | null) ?? null) : null;

  const statusKind = classifyStatus(slotStatus, slotUrl, slotExpiry);
  if (!statusKind) return { ok: false, reason: "no_actionable_status" };

  const recipients: RecipientCandidate[] = resolveRecipients(ctx.slotKey, {
    motherEmail: (app.motherEmail as string | null) ?? null,
    fatherEmail: (app.fatherEmail as string | null) ?? null,
    guardianEmail: (app.guardianEmail as string | null) ?? null,
  });
  if (recipients.length === 0) return { ok: false, reason: "no_recipients" };

  const cooldown = await getActiveCooldown(ctx.ayCode, ctx.enroleeNumber, ctx.slotKey, service);
  if (cooldown) {
    return {
      ok: false,
      reason: "cooldown",
      cooldownLastSentAt: cooldown.lastSentAt,
      recipients: recipients.length,
    };
  }

  const result = await sendReminder(
    {
      studentName: fullName(app),
      level: (statusRow.classLevel as string | null) ?? null,
      section: (statusRow.classSection as string | null) ?? null,
      slotKey: ctx.slotKey,
      slotLabel: slot.label,
      statusKind,
      expiryDateIso: slotExpiry,
    },
    recipients,
  );

  if (result.sent === 0) {
    return { ok: false, reason: "send_failed", recipients: recipients.length };
  }

  // Insert one p_file_outreach row per successful send.
  const rows = result.outcomes
    .filter((o) => o.ok)
    .map((o) => ({
      ay_code: ctx.ayCode,
      enrolee_number: ctx.enroleeNumber,
      slot_key: ctx.slotKey,
      kind: "reminder" as const,
      channel: "email",
      recipient_email: o.recipient.email,
      created_by_user_id: actor.id,
      created_by_email: actor.email,
    }));

  if (rows.length > 0) {
    const { error } = await service.from("p_file_outreach").insert(rows);
    if (error) {
      // Email already went out — log and proceed. The audit row at the
      // route layer captures the send so we don't lose visibility.
      console.error("[p-files notify] outreach insert failed:", error.message);
    }
  }

  return { ok: true, recipients: recipients.length, sent: result.sent, failed: result.failed };
}
