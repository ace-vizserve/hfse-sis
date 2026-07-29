import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';

// POST /api/grading-sheets/[id]/unlock — registrar+ only.
// Unlocking restores teacher edit access. The audit log is NEVER purged;
// unlocking simply gates future edits off the approval_reference check.
//
// Pending-CR gate: if any change request on this sheet is still `pending`,
// the request is rejected (409) so the registrar resolves them first —
// approving + applying or rejecting them — instead of leaving teachers'
// requests orphaned by the unlock. `approved` CRs don't block: the approval
// decision is closed, and an unlock is a deliberate registrar override of
// the pending apply step. Break-glass: pass `?force=true` to unlock anyway;
// the audit log records the pending count under a distinct action so the
// override is traceable.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const service = createServiceClient();

  const url = new URL(request.url);
  const force = url.searchParams.get('force') === 'true';

  // Grading deadline gate — if the term's grading_lock_date is in the past
  // (Singapore local date), the unlock requires ?force=true so the override
  // is deliberate and audit-logged.
  const { data: sheetTermRow } = await service
    .from('grading_sheets')
    .select('is_locked, term:terms(grading_lock_date, label)')
    .eq('id', id)
    .maybeSingle();

  // No-op guard, mirroring the sibling lock route (lock/route.ts:26-43), which
  // has had one all along. Without it, every repeat unlock re-stamped
  // updated_at/locked_at and wrote another sheet.unlock (or force-unlock) audit
  // row — and a force-unlock row is exactly the kind of deliberate override a
  // reviewer would later want an accurate count of.
  if (
    sheetTermRow &&
    (sheetTermRow as { is_locked?: boolean }).is_locked === false
  ) {
    return NextResponse.json({ ok: true, already_unlocked: true });
  }
  type TermMeta = { grading_lock_date: string | null; label: string } | null;
  const termMeta = sheetTermRow
    ? ((Array.isArray(sheetTermRow.term)
        ? sheetTermRow.term[0]
        : sheetTermRow.term) as TermMeta)
    : null;
  const todaySgt = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Singapore',
  });
  const deadlinePassed =
    termMeta?.grading_lock_date != null &&
    termMeta.grading_lock_date < todaySgt;

  if (deadlinePassed && !force) {
    return NextResponse.json(
      {
        error: 'grading_lock_date_passed',
        termLabel: termMeta?.label ?? 'this term',
        lockDate: termMeta?.grading_lock_date,
        message: `The grading deadline for ${termMeta?.label ?? 'this term'} has passed (${termMeta?.grading_lock_date}). Use ?force=true to override.`,
      },
      { status: 409 }
    );
  }

  // Count pending CRs on this sheet — the unlock gate.
  const { count: pendingCount, error: countErr } = await service
    .from('grade_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('grading_sheet_id', id)
    .eq('status', 'pending');
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  const pending = pendingCount ?? 0;

  if (pending > 0 && !force) {
    return NextResponse.json(
      {
        error: 'pending_change_requests',
        pendingCount: pending,
        message:
          pending === 1
            ? 'This sheet has 1 pending change request. Resolve it before unlocking, or force the unlock.'
            : `This sheet has ${pending} pending change requests. Resolve them before unlocking, or force the unlock.`,
      },
      { status: 409 }
    );
  }

  const { data, error } = await service
    .from('grading_sheets')
    .update({
      is_locked: false,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, is_locked, locked_at, locked_by')
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'unlock failed' },
      { status: 500 }
    );
  }

  const unlockAction =
    force && deadlinePassed
      ? 'sheet.unlock_force_deadline_passed'
      : force && pending > 0
        ? 'sheet.unlock_force_with_pending_crs'
        : 'sheet.unlock';
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: unlockAction,
    entityType: 'grading_sheet',
    entityId: id,
    context:
      force && deadlinePassed
        ? { lockDate: termMeta?.grading_lock_date, pendingCount: pending }
        : force && pending > 0
          ? { pendingCount: pending }
          : {},
  });

  invalidateDrillTags('markbook', await requireCurrentAyCode(service));

  return NextResponse.json({ sheet: data });
}
