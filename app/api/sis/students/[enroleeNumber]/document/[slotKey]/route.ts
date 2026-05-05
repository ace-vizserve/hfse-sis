import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { DocumentValidationSchema } from '@/lib/schemas/sis';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';
import { createServiceClient } from '@/lib/supabase/service';

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
  { params }: { params: Promise<{ enroleeNumber: string; slotKey: string }> },
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { enroleeNumber, slotKey } = await params;
  if (!enroleeNumber.trim()) {
    return NextResponse.json({ error: 'Missing enroleeNumber' }, { status: 400 });
  }
  if (!SLOT_KEYS.has(slotKey)) {
    return NextResponse.json({ error: 'Unknown slotKey' }, { status: 400 });
  }

  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json({ error: 'Invalid or missing ay query param' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = DocumentValidationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
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
  const selectCols = [statusCol, urlCol, ...(expiryCol ? [expiryCol] : [])].join(', ');
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
    return NextResponse.json({ error: 'No document row for this enrolee in this AY' }, { status: 404 });
  }
  const beforeRow = before as unknown as Record<string, unknown>;
  const priorStatus = (beforeRow[statusCol] as string | null) ?? null;
  const fileUrl = (beforeRow[urlCol] as string | null) ?? null;
  const priorExpiry = expiryCol ? ((beforeRow[expiryCol] as string | null) ?? null) : null;

  if (!fileUrl) {
    return NextResponse.json(
      { error: 'Cannot validate a slot with no uploaded file' },
      { status: 400 },
    );
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
        { status: 422 },
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

  const rejectionReason =
    parsed.data.status === 'Rejected' ? parsed.data.rejectionReason : null;

  await logAction({
    service: supabase,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: parsed.data.status === 'Valid' ? 'sis.document.approve' : 'sis.document.reject',
    entityType: 'enrolment_document',
    entityId: `${enroleeNumber}:${slotKey}`,
    context: {
      ay_code: ayCode,
      slot_key: slotKey,
      prior_status: priorStatus,
      new_status: parsed.data.status,
      ...(rejectionReason ? { rejection_reason: rejectionReason } : {}),
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  return NextResponse.json({ ok: true });
}
