import 'server-only';

import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction, type AuditAction } from '@/lib/audit/log-action';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import type { Role } from '@/lib/auth/roles';
import {
  notifyRequestApproved,
  notifyRequestRejected,
} from '@/lib/notifications/email-change-request';
import {
  fetchLabels,
  fetchRegistrarEmails,
} from '@/lib/change-requests/labels';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';
import type { ChangeRequestStatus } from '@/lib/markbook/change-request-status';

// Decision core for the change-request workflow. Extracted verbatim (in
// logic) from the PATCH handler at app/api/change-requests/[id]/route.ts so
// that BOTH the in-app PATCH route AND the email one-click approve/reject
// route can share one implementation. The handler maps the structured
// result back to a NextResponse; every status code + plain-English error
// message is preserved exactly.
//
// `via` records the call origin ('in_app' from the PATCH route, 'email_token'
// from the signed-link route) into the audit context for traceability.

export type DecideAction = 'approve' | 'reject' | 'cancel' | 'undo_rejection';

export type DecideActingUser = {
  id: string;
  email: string | null;
  role: string;
};

export type DecideArgs = {
  service: SupabaseClient;
  requestId: string;
  action: DecideAction;
  actingUser: DecideActingUser;
  decisionNote?: string | null;
  via: 'in_app' | 'email_token';
};

export type DecideResult = {
  ok: boolean;
  httpStatus: number;
  status?: ChangeRequestStatus;
  request?: Record<string, unknown>;
  error?: string;
};

export async function decideChangeRequest(
  args: DecideArgs
): Promise<DecideResult> {
  const { service, requestId: id, action, actingUser, via } = args;
  const decision_note = args.decisionNote;

  const { data: existing, error: fetchError } = await service
    .from('grade_change_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError || !existing) {
    return { ok: false, httpStatus: 404, error: 'request not found' };
  }

  // Reject requires a non-empty decision note. In the in-app path the form
  // zod schema (ChangeRequestActionSchema) already enforces this before we're
  // called, so this guard is a no-op there; it matters for the email-token
  // path which never runs that schema. Same message + 400 the schema emits.
  if (
    action === 'reject' &&
    !(typeof decision_note === 'string' && decision_note.trim().length > 0)
  ) {
    return {
      ok: false,
      httpStatus: 400,
      error: 'A decision note is required when rejecting a request',
    };
  }

  // Cancel must always be on a pending request — only the original
  // requester can call cancel and only before either reviewer has acted.
  // Approve/reject loosen this guard: a secondary reviewer co-signs AFTER
  // the first review has flipped status, so we accept approved/rejected
  // here too and let the per-ordinal logic below decide what's legal.
  // Undo_rejection has its own status guard (rejected-only) enforced in
  // its dedicated branch below — skip the pending-only gate for it.
  const isReview = action === 'approve' || action === 'reject';
  if (
    !isReview &&
    action !== 'undo_rejection' &&
    existing.status !== 'pending'
  ) {
    return {
      ok: false,
      httpStatus: 400,
      error: `cannot ${action} a request in status "${existing.status}"`,
    };
  }
  if (
    isReview &&
    existing.status !== 'pending' &&
    existing.status !== 'approved' &&
    existing.status !== 'rejected'
  ) {
    // applied / cancelled — terminal states no reviewer should write into.
    return {
      ok: false,
      httpStatus: 400,
      error: `cannot ${action} a request in status "${existing.status}"`,
    };
  }

  // Authorization per action
  let isPrimaryReview = false;
  let reviewerOrdinal: 'primary' | 'secondary' = 'primary';
  if (isReview) {
    // Approving is a capability now, not a role name — grade_changes.approve.
    //
    // Seeded to school_admin ALONE, which is exactly who this admitted before,
    // so nothing changes today. What changes is that the pool can be moved
    // without editing this file: previously the only role able to approve was
    // welded in here, in the eligible-candidates query, and in the approver
    // assignment route, so re-scoping school_admin would have left every
    // locked-sheet request permanently un-decidable.
    //
    // Superadmin is still excluded, and now visibly so: it simply doesn't hold
    // the capability (see lib/auth/capabilities.ts, where that absence is
    // deliberate and pinned by a test). A superadmin decides WHO may approve
    // via /sis/admin/approvers and does not approve themselves.
    // `actingUser.role` is a plain string here — it arrives from the JWT, and
    // the email-token path (app/api/change-requests/act) reads it straight off
    // app_metadata. An unrecognised value resolves to no capabilities, which
    // fails closed.
    const capabilities = await getCapabilitiesForRole(
      actingUser.role as Role | null
    );
    if (!can(capabilities, 'grade_changes.approve')) {
      return {
        ok: false,
        httpStatus: 403,
        error: 'Your role is not allowed to approve or reject change requests.',
      };
    }
    // Designated-approver scope: the acting school_admin must be the
    // primary or secondary approver on this specific request. Legacy rows
    // with both NULL (pre-feature) fall back to broadcast scope.
    const isLegacy =
      existing.primary_approver_id == null &&
      existing.secondary_approver_id == null;
    const isDesignated =
      existing.primary_approver_id === actingUser.id ||
      existing.secondary_approver_id === actingUser.id;
    if (!isLegacy && !isDesignated) {
      return {
        ok: false,
        httpStatus: 403,
        error:
          'You are not a designated approver on this request. Only the primary or secondary approver selected by the teacher can act on it.',
      };
    }

    // Ordinal: first reviewer to act is "primary" (writes both legacy
    // reviewed_* and new primary_* columns + flips status); the second
    // to act is "secondary" (writes only secondary_* + does NOT touch
    // status). Same person may not act twice on the same request — block
    // both the "primary acts again as secondary" path AND the "secondary
    // acts again as secondary" path.
    isPrimaryReview = existing.primary_reviewed_by == null;
    reviewerOrdinal = isPrimaryReview ? 'primary' : 'secondary';

    const sameUserAlreadyReviewed =
      !isPrimaryReview &&
      (existing.primary_reviewed_by === actingUser.id ||
        existing.secondary_reviewed_by === actingUser.id);
    if (sameUserAlreadyReviewed) {
      return {
        ok: false,
        httpStatus: 400,
        error:
          'You have already reviewed this request. The other designated approver still needs to co-sign.',
      };
    }

    // Once a request is rejected, secondary co-signs serve no purpose — the
    // request is dead and cannot be applied (the apply route requires
    // status='approved'). Block the secondary path on rejected so we don't
    // record a confusing secondary_decision='approved' against a
    // status='rejected' row.
    if (!isPrimaryReview && existing.status === 'rejected') {
      return {
        ok: false,
        httpStatus: 400,
        error:
          'This request was already rejected by the other approver. A second review is not needed.',
      };
    }
  } else if (action === 'cancel') {
    if (existing.requested_by !== actingUser.id) {
      return {
        ok: false,
        httpStatus: 403,
        error: 'only the original requester can cancel this request',
      };
    }
  } else if (action === 'undo_rejection') {
    // Undo is the rejecting approver's "I clicked the wrong button" escape
    // hatch — bounded by status (must currently be rejected), ownership
    // (only the approver who rejected it), no secondary co-sign yet, and a
    // 2-hour window from the original rejection moment.
    if (existing.status !== 'rejected') {
      return {
        ok: false,
        httpStatus: 400,
        error: "This request hasn't been declined.",
      };
    }
    if (existing.primary_reviewed_by !== actingUser.id) {
      return {
        ok: false,
        httpStatus: 403,
        error:
          'Only the approver who declined this request can undo the decision.',
      };
    }
    if (existing.secondary_reviewed_by != null) {
      return {
        ok: false,
        httpStatus: 409,
        error:
          'The other approver has also reviewed this request. Contact a system administrator to reopen it.',
      };
    }
    const reviewedMs = existing.primary_reviewed_at
      ? Date.parse(existing.primary_reviewed_at)
      : 0;
    const ageHours = (Date.now() - reviewedMs) / (1000 * 60 * 60);
    if (ageHours > 2) {
      return {
        ok: false,
        httpStatus: 400,
        error:
          'The 2-hour undo window has closed. The teacher will need to file a new request.',
      };
    }
  }

  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {};
  let auditAction: AuditAction;

  if (action === 'approve' || action === 'reject') {
    const decision: 'approved' | 'rejected' =
      action === 'approve' ? 'approved' : 'rejected';
    if (isPrimaryReview) {
      // First reviewer: write both the legacy reviewed_* columns (back-compat
      // for existing display logic + admin inbox queries) AND the new
      // primary_* columns. Status flips here.
      update.status = decision;
      update.reviewed_by = actingUser.id;
      update.reviewed_by_email = actingUser.email ?? '(unknown)';
      update.reviewed_at = nowIso;
      update.decision_note = decision_note ?? null;
      update.primary_reviewed_by = actingUser.id;
      update.primary_reviewed_by_email = actingUser.email ?? null;
      update.primary_reviewed_at = nowIso;
      update.primary_decision = decision;
      // Canonical "the request entered the approved state at this moment"
      // timestamp — separate from primary_reviewed_at so a future secondary
      // co-sign (KD #41) can never overwrite the aging signal that drives
      // the 3-day reminder threshold + the "approved N days ago" chip.
      // Only stamped on approve; rejects leave it null.
      if (decision === 'approved') {
        update.approved_at = nowIso;
      }
    } else {
      // Second reviewer: write only secondary_* columns. Status was already
      // flipped by the first reviewer; we do NOT touch status, reviewed_*,
      // or any legacy column. The second review is a co-sign, not a
      // status transition.
      update.secondary_reviewed_by = actingUser.id;
      update.secondary_reviewed_by_email = actingUser.email ?? null;
      update.secondary_reviewed_at = nowIso;
      update.secondary_decision = decision;
    }
    auditAction =
      action === 'approve' ? 'grade_change_approved' : 'grade_change_rejected';
  } else if (action === 'undo_rejection') {
    // Reopen the request: clear all primary + legacy review columns so the
    // row reads as fresh-pending to the inbox + audit-list. Stamp
    // rejection_undone_at so the UI can surface an "Undo used" affordance
    // on the re-pending row (migration 045 column).
    update.status = 'pending';
    update.reviewed_by = null;
    update.reviewed_by_email = null;
    update.reviewed_at = null;
    update.decision_note = null;
    update.primary_reviewed_by = null;
    update.primary_reviewed_by_email = null;
    update.primary_reviewed_at = null;
    update.primary_decision = null;
    update.rejection_undone_at = nowIso;
    auditAction = 'grade_change_undo_rejection';
  } else {
    update.status = 'cancelled';
    auditAction = 'grade_change_cancelled';
  }

  // Optimistic-concurrency guard. The existing pre-update status check
  // above is the first line of defense (catches a stale UI acting on an
  // already-decided request); this is the second line of defense that
  // catches a genuine race between two designees clicking simultaneously.
  // For the FIRST reviewer (primary): require status === 'pending'. The
  // loser of a simultaneous-click race finds status already moved.
  // For the SECOND reviewer: status has already moved; pin it to whatever
  // we read at the top so an unrelated state change between read + write
  // (e.g., teacher cancellation racing in) also returns null.
  // For undo_rejection: pin to 'rejected' so a concurrent secondary
  // co-sign (which would set secondary_reviewed_by) racing in won't be
  // silently overwritten.
  const expectedStatus =
    action === 'undo_rejection'
      ? 'rejected'
      : isReview && !isPrimaryReview
        ? existing.status
        : 'pending';
  const { data: updated, error: updateError } = await service
    .from('grade_change_requests')
    .update(update)
    .eq('id', id)
    .eq('status', expectedStatus)
    .select('*')
    .maybeSingle();

  if (updateError) {
    return {
      ok: false,
      httpStatus: 500,
      error: updateError.message ?? 'update failed',
    };
  }
  if (!updated) {
    return {
      ok: false,
      httpStatus: 409,
      error:
        'This request was already handled by another administrator. Refresh to see the latest status.',
    };
  }

  await logAction({
    service,
    actor: { id: actingUser.id, email: actingUser.email ?? null },
    action: auditAction,
    entityType: 'grade_change_request',
    entityId: id,
    context: {
      grading_sheet_id: updated.grading_sheet_id,
      grade_entry_id: updated.grade_entry_id,
      field: updated.field_changed,
      proposed: updated.proposed_value,
      decision_note: updated.decision_note ?? null,
      via,
      ...(isReview ? { reviewer_ordinal: reviewerOrdinal } : {}),
      ...(action === 'undo_rejection'
        ? { original_rejection_at: existing.primary_reviewed_at }
        : {}),
    },
  });

  invalidateDrillTags('markbook', await requireCurrentAyCode(service));

  // Notifications for approve/reject. Cancel is silent. Runs via after() so
  // it survives past the response on Vercel's serverless runtime (an
  // un-awaited void(async()) has no such guarantee — see the matching note
  // in app/api/change-requests/route.ts).
  if (action === 'approve' || action === 'reject') {
    after(async () => {
      try {
        const labels = await fetchLabels(
          service,
          updated.grading_sheet_id,
          updated.grade_entry_id
        );
        const summary = {
          id: updated.id,
          grading_sheet_id: updated.grading_sheet_id,
          field_changed: updated.field_changed,
          current_value: updated.current_value,
          proposed_value: updated.proposed_value,
          reason_category: updated.reason_category,
          justification: updated.justification,
          requested_by_email: updated.requested_by_email,
          requested_at: updated.requested_at,
          reviewed_by_email: updated.reviewed_by_email,
          decision_note: updated.decision_note,
          student_label: labels.student_label,
          sheet_label: labels.sheet_label,
        };
        if (action === 'approve') {
          const registrarEmails = await fetchRegistrarEmails(service);
          await notifyRequestApproved(
            summary,
            updated.requested_by_email,
            registrarEmails
          );
        } else {
          await notifyRequestRejected(summary, updated.requested_by_email);
        }
      } catch (e) {
        console.error('[change-requests] notify decision failed', e);
      }
    });
  }

  return {
    ok: true,
    httpStatus: 200,
    status: updated.status as ChangeRequestStatus,
    request: updated as Record<string, unknown>,
  };
}
