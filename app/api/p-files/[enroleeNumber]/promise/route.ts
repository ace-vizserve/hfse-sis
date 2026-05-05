import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { requireCurrentAyCode } from "@/lib/academic-year";
import { logAction, type AuditAction } from "@/lib/audit/log-action";
import { createServiceClient } from "@/lib/supabase/service";
import { DOCUMENT_SLOTS } from "@/lib/p-files/document-config";

// PATCH /api/p-files/[enroleeNumber]/promise
// Body: {
//   slotKey: string;
//   promisedUntil: string (YYYY-MM-DD);
//   note?: string;
//   module?: 'p-files' | 'admissions';
// }
//
// Records that the parent has committed to re-uploading by `promisedUntil`.
// Flips the slot's status to 'To follow' (canonical KD #60 status, surfaces
// in the existing chase strip "promised" bucket). Inserts one
// p_file_outreach row with kind='promise'. `module` (default 'p-files')
// selects the audit action + scope gate:
//   - 'p-files' → 'pfile.mark.promised' + Enrolled / Enrolled (Conditional)
//   - 'admissions' → 'admissions.mark.promised' + active funnel statuses

const ENROLLED_STATUSES = new Set(["Enrolled", "Enrolled (Conditional)"]);
const ADMISSIONS_FUNNEL_STATUSES = new Set([
  "Submitted",
  "Ongoing Verification",
  "Processing",
]);
const MAX_PROMISE_HORIZON_DAYS = 90;

const MODULE_VALUES = new Set(["p-files", "admissions"]);
type ChaseModule = "p-files" | "admissions";
function resolveModule(raw: unknown): ChaseModule {
  if (typeof raw === "string" && MODULE_VALUES.has(raw)) return raw as ChaseModule;
  return "p-files";
}

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, "").toLowerCase()}`;
}

function isFutureWithinHorizon(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const target = new Date(`${iso}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diffDays = (target - today.getTime()) / 86_400_000;
  return diffDays >= 0 && diffDays <= MAX_PROMISE_HORIZON_DAYS;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ enroleeNumber: string }> },
) {
  const auth = await requireRole([
    "p-file",
    "admissions",
    "registrar",
    "school_admin",
    "superadmin",
  ]);
  if ("error" in auth) return auth.error;

  const { enroleeNumber } = await params;
  if (!enroleeNumber.trim()) {
    return NextResponse.json({ error: "Missing enroleeNumber" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const slotKey = body && typeof body.slotKey === "string" ? body.slotKey.trim() : "";
  const promisedUntil = body && typeof body.promisedUntil === "string" ? body.promisedUntil.trim() : "";
  const noteRaw = body && typeof body.note === "string" ? body.note.trim() : "";
  const note = noteRaw.length > 0 ? noteRaw.slice(0, 500) : null;
  const moduleKey = resolveModule(body?.module);

  if (!slotKey) {
    return NextResponse.json({ error: "slotKey is required" }, { status: 400 });
  }
  const slot = DOCUMENT_SLOTS.find((s) => s.key === slotKey);
  if (!slot) {
    return NextResponse.json({ error: `invalid slotKey: ${slotKey}` }, { status: 400 });
  }
  if (!isFutureWithinHorizon(promisedUntil)) {
    return NextResponse.json(
      { error: `promisedUntil must be a YYYY-MM-DD date in the future (≤ ${MAX_PROMISE_HORIZON_DAYS} days).` },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const ayCode = await requireCurrentAyCode(service);
  const prefix = prefixFor(ayCode);

  const [statusRes, docsRes] = await Promise.all([
    service
      .from(`${prefix}_enrolment_status`)
      .select('"applicationStatus"')
      .eq("enroleeNumber", enroleeNumber)
      .maybeSingle(),
    service
      .from(`${prefix}_enrolment_documents`)
      .select(`"${slotKey}","${slotKey}Status"`)
      .eq("enroleeNumber", enroleeNumber)
      .maybeSingle(),
  ]);

  if (!statusRes.data) {
    return NextResponse.json({ error: "Student status row not found" }, { status: 404 });
  }
  const applicationStatus = (statusRes.data as { applicationStatus: string | null }).applicationStatus;
  const allowedStatuses =
    moduleKey === "admissions" ? ADMISSIONS_FUNNEL_STATUSES : ENROLLED_STATUSES;
  if (!applicationStatus || !allowedStatuses.has(applicationStatus)) {
    const message =
      moduleKey === "admissions"
        ? "Promises can only be recorded for applicants in the active funnel (Submitted / Ongoing Verification / Processing)."
        : "Promises can only be recorded for enrolled students.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
  if (!docsRes.data) {
    return NextResponse.json({ error: "Document row not found for this enrolee" }, { status: 404 });
  }

  const docRow = docsRes.data as unknown as Record<string, unknown>;
  const priorStatus = ((docRow[`${slotKey}Status`] as string | null) ?? null)?.toLowerCase() ?? "";
  const priorUrl = (docRow[slotKey] as string | null) ?? null;

  // Only allow promises against expired / rejected / missing slots —
  // never overwrite a Valid / Uploaded / To follow slot.
  const allowed = priorStatus === "expired" || priorStatus === "rejected" || (!priorUrl && !priorStatus);
  if (!allowed) {
    return NextResponse.json(
      {
        error:
          "Promises can only be recorded for slots that are expired, rejected, or missing. Use the existing status workflow otherwise.",
        priorStatus: priorStatus || null,
      },
      { status: 422 },
    );
  }

  const { error: upErr } = await service
    .from(`${prefix}_enrolment_documents`)
    .update({ [`${slotKey}Status`]: "To follow" })
    .eq("enroleeNumber", enroleeNumber);
  if (upErr) {
    console.error("[p-files promise] status update failed:", upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const { error: insErr } = await service.from("p_file_outreach").insert({
    ay_code: ayCode,
    enrolee_number: enroleeNumber,
    slot_key: slotKey,
    kind: "promise",
    promised_until: promisedUntil,
    note,
    created_by_user_id: auth.user.id,
    created_by_email: auth.user.email ?? null,
  });
  if (insErr) {
    console.error("[p-files promise] outreach insert failed:", insErr.message);
    // Status was already flipped — don't revert. Fail loud so the UI
    // knows the badge won't render but the chase strip count is correct.
    return NextResponse.json(
      { error: `Promise recorded as 'To follow' but tracking insert failed: ${insErr.message}` },
      { status: 500 },
    );
  }

  const action: AuditAction =
    moduleKey === "admissions" ? "admissions.mark.promised" : "pfile.mark.promised";
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
      promised_until: promisedUntil,
      prior_status: priorStatus || null,
      ...(note ? { note } : {}),
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');

  return NextResponse.json({
    ok: true,
    enroleeNumber,
    slotKey,
    promisedUntil,
    newStatus: "To follow",
  });
}
