import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireAnyCapability } from '@/lib/auth/require-capability';
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
  // Gate on holding EITHER side's validate capability; which one is actually
  // required is decided below by whether the student has enrolled.
  //
  // `school_admin` holds neither and is stopped here — read-only oversight,
  // KD #74 + KD #31. That has always been true of this route; what changed is
  // that the queue UI now knows it too, instead of rendering them
  // Approve/Reject buttons that landed on this 403.
  const auth = await requireAnyCapability([
    'documents_pre_enrolment.validate',
    'documents_post_enrolment.validate',
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
  // document lifecycle is Admissions' before enrolment and P-Files' after, and
  // that rule is UNCHANGED — what changed is that it is now expressed as a
  // capability the enrolment state selects, rather than as two named roles.
  //
  // Why that matters: at HFSE one person does both jobs, and a person holds
  // exactly one role. Under the old shape they could not be given both sides
  // without a code change. Now a superadmin ticks both boxes and this block
  // lets them through, while anyone holding only one side is still stopped on
  // the wrong side of the line.
  //
  // Note the enrolment lookup now runs for EVERY caller, where before it was
  // skipped for the two roles that could validate either side. One extra read
  // on a route that already does several, in exchange for a rule that has no
  // role-shaped exceptions in it.
  {
    const enrolled = await isStudentEnrolled(ayCode, enroleeNumber);
    const required = enrolled
      ? 'documents_post_enrolment.validate'
      : 'documents_pre_enrolment.validate';

    if (!auth.capabilities.includes(required)) {
      // Codes unchanged — clients switch on these. The messages now describe
      // the permission rather than naming a module, matching the queue tabs
      // ("Applicants" / "Enrolled students").
      return enrolled
        ? NextResponse.json(
            {
              error:
                "This student has enrolled, so their documents belong with the enrolled students' queue — which you don't have permission to review.",
              code: 'enrolled_documents_pfiles_only',
            },
            { status: 403 }
          )
        : NextResponse.json(
            {
              error:
                "This applicant hasn't enrolled yet, so their documents belong with the applicants' queue — which you don't have permission to review.",
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

  // The status change IS the claim. Matching on the prior status means exactly
  // one of two concurrent requests can transition the slot; the loser matches
  // zero rows and returns without emailing.
  //
  // The no-op short-circuit above already covers a SEQUENTIAL double-click
  // (the second request reads the new status and bails). What it cannot cover
  // is two requests that both read `priorStatus` before either writes — and
  // the side effect here is a rejection email to a parent, so "rare" isn't
  // good enough. `.is(col, null)` handles the null case, which `.eq()` cannot.
  const claim = supabase
    .from(table)
    .update({ [statusCol]: parsed.data.status })
    .eq('enroleeNumber', enroleeNumber);
  const { data: claimed, error: upErr } = await (
    priorStatus === null
      ? claim.is(statusCol, null)
      : claim.eq(statusCol, priorStatus)
  ).select('enroleeNumber');
  if (upErr) {
    console.error('[sis document PATCH] update failed:', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  if (!Array.isArray(claimed) || claimed.length === 0) {
    // Another request transitioned this slot between our read and our write.
    // Same response as the sequential no-op: the end state is what the caller
    // asked for, we just weren't the one who applied it.
    return NextResponse.json({ ok: true, changed: false });
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
