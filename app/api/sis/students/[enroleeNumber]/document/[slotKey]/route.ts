import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import {
  resolveRecipients,
  sendReminder,
} from '@/lib/notifications/email-pfile-reminder';
import { DocumentValidationSchema } from '@/lib/schemas/sis';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';
import { isStudentEnrolled } from '@/lib/p-files/queries';
import { createServiceClient } from '@/lib/supabase/service';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

// Allowlist of valid slot keys — guards against writing arbitrary
// `${anythingStatus}` columns via the URL segment.
const SLOT_KEYS = new Set(DOCUMENT_SLOTS.map((s) => s.key));
const SLOT_META = new Map(DOCUMENT_SLOTS.map((s) => [s.key, s]));

// PATCH /api/sis/students/[enroleeNumber]/document/[slotKey]?ay=AY2026
//
// Writes {slotKey}Status on ay{YY}_enrolment_documents to 'Valid' or
// 'Rejected'. SIS is the sole writer of 'Rejected' per the cross-module
// contract — P-Files stays a repository.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string; slotKey: string }> }
) {
  // 'admissions' added Sprint 37 (KD #70). 'p-file' added alongside the P-Files
  // document-validation page so officers can approve / reject enrolled-student slots.
  // 'registrar' added per KD #37: Records is the sole writer of 'Rejected' for
  // enrolled students; 'school_admin' intentionally excluded (read-only oversight,
  // KD #74 + KD #31).
  const auth = await requireRole([
    'academic_coordinator',
    'superadmin',
    'admissions',
    'p_file_officer',
  ]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber, slotKey } = await params;
  if (!enroleeNumber.trim()) {
    return NextResponse.json(
      { error: 'Missing enroleeNumber' },
      { status: 400 }
    );
  }
  if (!SLOT_KEYS.has(slotKey)) {
    return NextResponse.json({ error: 'Unknown slotKey' }, { status: 400 });
  }

  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json(
      { error: 'Invalid or missing ay query param' },
      { status: 400 }
    );
  }

  // Document-axis ownership handoff at enrolment (module-ownership rule). The
  // document lifecycle is Admissions' before enrolment and P-Files' after.
  // `registrar`/`superadmin` may validate either side (KD #37 — Records is the
  // sole writer of 'Rejected' for enrolled students; superadmin = break-glass).
  // But the role-specific writers must stay on their side of the handoff:
  //   • enrolled student  → `admissions` is rejected (post-enrolment docs are
  //     P-Files territory; the UI already routes them to /p-files).
  //   • un-enrolled student → `p-file` is rejected (pre-enrolment validation is
  //     the admissions funnel's job).
  // Closes the gap where the shared UI queues were split but the write route
  // wasn't (an admissions user could approve/reject an enrolled student's doc).
  if (auth.role === 'admissions' || auth.role === 'p_file_officer') {
    const enrolled = await isStudentEnrolled(ayCode, enroleeNumber);
    if (enrolled && auth.role === 'admissions') {
      return NextResponse.json(
        {
          error:
            "This student is enrolled — their documents are managed in P-Files. The admissions document queue only covers applicants who haven't enrolled yet.",
          code: 'enrolled_documents_pfiles_only',
        },
        { status: 403 }
      );
    }
    if (!enrolled && auth.role === 'p_file_officer') {
      return NextResponse.json(
        {
          error:
            'This applicant has not enrolled yet — pre-enrolment document validation is handled in the Admissions module.',
          code: 'unenrolled_documents_admissions_only',
        },
        { status: 403 }
      );
    }
  }

  const body = await request.json().catch(() => null);
  const parsed = DocumentValidationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const slot = SLOT_META.get(slotKey)!;
  const statusCol = slot.statusCol;
  const urlCol = slot.urlCol;
  const expiryCol = slot.expiryCol;

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const table = `${prefix}_enrolment_documents`;
  const supabase = createServiceClient();

  // Pre-fetch prior status + url + (when applicable) expiry. The expiry
  // is only present on expiring slots (`expiryCol` defined in
  // DOCUMENT_SLOTS) — KD #60 distinguishes the two flows.
  const selectCols = [
    statusCol,
    urlCol,
    ...(expiryCol ? [expiryCol] : []),
  ].join(', ');
  const { data: before, error: beforeErr } = await supabase
    .from(table)
    .select(selectCols)
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (beforeErr) {
    console.error('[sis document PATCH] pre-fetch failed:', beforeErr.message);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json(
      { error: 'No document row for this enrolee in this AY' },
      { status: 404 }
    );
  }
  const beforeRow = before as unknown as Record<string, unknown>;
  const priorStatus = (beforeRow[statusCol] as string | null) ?? null;
  const fileUrl = (beforeRow[urlCol] as string | null) ?? null;
  const priorExpiry = expiryCol
    ? ((beforeRow[expiryCol] as string | null) ?? null)
    : null;

  if (!fileUrl) {
    return NextResponse.json(
      { error: 'Cannot validate a slot with no uploaded file' },
      { status: 400 }
    );
  }

  // No-op short-circuit. Re-approving an already-'Valid' slot or re-rejecting
  // an already-'Rejected' slot would re-run the update, write a duplicate
  // audit row, AND re-send the parent rejection email. Bail out before any of
  // that when the status isn't actually changing.
  if (priorStatus === parsed.data.status) {
    return NextResponse.json({ ok: true, changed: false });
  }

  // Block manual approval of an expired document. Per KD #60, expiring
  // slots flow null → 'Valid' → 'Expired' (auto-flip when expiry passes);
  // the proper recovery is parent re-upload, which auto-sets the status
  // back to 'Valid' with a fresh expiry. Manually flipping Expired →
  // Valid here would resurrect a stale doc and bypass the re-upload
  // signal. We catch two cases:
  //   1. priorStatus === 'Expired' (auto-flip already ran)
  //   2. priorStatus === 'Valid' but the expiry has already passed (the
  //      auto-flip's 60s cache hasn't expired yet, but the document is
  //      logically expired)
  if (parsed.data.status === 'Valid') {
    const expiryPassed =
      priorExpiry !== null && new Date(priorExpiry).getTime() < Date.now();
    if (priorStatus === 'Expired' || expiryPassed) {
      return NextResponse.json(
        {
          error:
            'Cannot approve an expired document. Parent must re-upload before re-validation.',
          priorStatus,
          expiry: priorExpiry,
        },
        { status: 422 }
      );
    }
  }

  const { error: upErr } = await supabase
    .from(table)
    .update({ [statusCol]: parsed.data.status })
    .eq('enroleeNumber', enroleeNumber);
  if (upErr) {
    console.error('[sis document PATCH] update failed:', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const rejectedData = parsed.data.status === 'Rejected' ? parsed.data : null;
  const isRejection = rejectedData !== null;
  const rejectionReason = rejectedData?.rejectionReason ?? null;

  // Fire rejection email before logAction so we can capture notified: bool in audit.
  let notified = false;
  if (isRejection && rejectionReason) {
    try {
      const appsTable = `${prefix}_enrolment_applications`;
      const statusTable = `${prefix}_enrolment_status`;
      const [{ data: appRow }, { data: statusRow }] = await Promise.all([
        supabase
          .from(appsTable)
          .select(
            'enroleeFullName, motherEmail, fatherEmail, guardianEmail, levelApplied'
          )
          .eq('enroleeNumber', enroleeNumber)
          .maybeSingle(),
        supabase
          .from(statusTable)
          .select('classSection')
          .eq('enroleeNumber', enroleeNumber)
          .maybeSingle(),
      ]);
      if (appRow) {
        const appData = appRow as {
          enroleeFullName: string;
          motherEmail: string | null;
          fatherEmail: string | null;
          guardianEmail: string | null;
          levelApplied: string | null;
        };
        const classSection =
          (statusRow as { classSection: string | null } | null)?.classSection ??
          null;
        const slotMeta = SLOT_META.get(slotKey)!;
        const envelope = resolveRecipients(slotKey, {
          motherEmail: appData.motherEmail,
          fatherEmail: appData.fatherEmail,
          guardianEmail: appData.guardianEmail,
        });
        if (envelope.kind !== 'none') {
          const result = await sendReminder(
            {
              kind: 'rejection',
              studentName: appData.enroleeFullName,
              level: appData.levelApplied,
              section: classSection,
              slotKey,
              slotLabel: slotMeta.label,
              statusKind: 'rejected',
              expiryDateIso: null,
              rejectionReason,
              enroleeNumber,
              ayCode,
            },
            envelope
          );
          notified = result.sent > 0;
        }
      }
    } catch (e) {
      console.error(
        '[sis document PATCH] rejection email failed (non-fatal):',
        e
      );
    }
  }

  await logAction({
    service: supabase,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action:
      parsed.data.status === 'Valid'
        ? 'sis.document.approve'
        : 'sis.document.reject',
    entityType: 'enrolment_document',
    entityId: `${enroleeNumber}:${slotKey}`,
    context: {
      ay_code: ayCode,
      slot_key: slotKey,
      prior_status: priorStatus,
      new_status: parsed.data.status,
      ...(rejectionReason
        ? { rejection_reason: rejectionReason, notified }
        : {}),
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  // Document validation feeds both the admissions completeness panels and
  // the P-Files renewal queue; records also drills on doc-related counts.
  invalidateDrillTags('admissions', ayCode);
  invalidateDrillTags('p-files', ayCode);
  invalidateDrillTags('records', ayCode);
  return NextResponse.json({ ok: true });
}
