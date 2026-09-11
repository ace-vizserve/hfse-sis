import { NextResponse, type NextRequest, after } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import {
  fetchLabels,
  fetchRegistrarEmails,
} from '@/lib/change-requests/labels';
import {
  ChangeRequestFormSchema,
  type ChangeRequestField,
} from '@/lib/schemas/change-request';
import { OVERRIDE_LETTERS, isOverrideLetter } from '@/lib/compute/letter-grade';
import {
  loadEffectiveAssignmentsForUser,
  isSubjectTeacher,
} from '@/lib/auth/teacher-assignments';
import {
  notifyApprovedNotApplied,
  type ApprovedStaleSummary,
} from '@/lib/notifications/email-change-request';
import { createClient } from '@/lib/supabase/server';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';
import {
  GRADE_CHANGE_SUBJECT_TYPE,
  resolveGradeChangeFlow,
} from '@/lib/change-requests/approval-route';
import {
  gradeChangeLadderProblem,
  summariseGradeChangeLadder,
} from '@/lib/change-requests/ladder-summary';
import {
  loadConfiguredLadder,
  openApprovalRequest,
  type OpenApprovalRequestResult,
} from '@/lib/approvals/materialise';
import { loadLevelTypesBySection } from '@/lib/approvals/level-types';
import {
  loadGradeChangeStepRecipients,
  sendGradeChangeStepEmails,
} from '@/lib/change-requests/approval-notify';
import type {
  ApproverLevelScope,
  GradeChangeApprovalFlow,
} from '@/lib/schemas/approval-flows';

// GET /api/change-requests
// Query params:
//   ?status=pending|approved|rejected|applied|cancelled (optional, default = all)
//   ?sheet_id=<uuid>   (optional, scope to one sheet)
//   ?mine=1            (teachers: their own requests only — enforced for teacher role)
//
// Teachers always get only their own rows. school_admin/superadmin/registrar see all.
export async function GET(request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const sheetId = url.searchParams.get('sheet_id');

  const service = createServiceClient();
  let query = service
    .from('grade_change_requests')
    .select(
      `id, grading_sheet_id, grade_entry_id, field_changed, slot_index,
       current_value, proposed_value, reason_category, justification,
       status, requested_by, requested_by_email, requested_at,
       reviewed_by, reviewed_by_email, reviewed_at, decision_note,
       applied_by, applied_at,
       primary_approver_id, secondary_approver_id, approval_flow,
       approved_at, reminder_sent_at, rejection_undone_at`
    )
    .order('requested_at', { ascending: false });

  if (auth.role === 'teacher') {
    query = query.eq('requested_by', auth.user.id);
  } else if (
    (auth.role === 'school_admin' || auth.role === 'superadmin') &&
    !sheetId
  ) {
    // Designated-approver scope: school_admin+ sees only requests where
    // they're primary or secondary. Legacy rows (both NULL) fall back to
    // the broadcast-style "anyone school_admin+ sees it" behavior so
    // pre-feature pending requests don't strand.
    //
    // ⚠ `approval_flow.is.null` INSIDE THE LEGACY ARM (migration 144). A
    // request filed on the approval ladder also has both approver columns
    // null, so without it every new request would be handed to every school
    // admin as if it were theirs to decide. Who decides those is the ladder's
    // business, not this list's.
    //
    // ⚠ NOT APPLIED WHEN `sheet_id` IS PRESENT. That call is the apply dialog
    // on a locked sheet (components/grading/use-approval-reference.tsx),
    // looking for the approved request behind the cell being edited. Applying
    // is a different right from deciding, and the entries PATCH route enforces
    // it — scoping this list to approvers would hide every ladder request from
    // the admin who has to apply it.
    query = query.or(
      `primary_approver_id.eq.${auth.user.id},secondary_approver_id.eq.${auth.user.id},and(primary_approver_id.is.null,secondary_approver_id.is.null,approval_flow.is.null)`
    );
  }
  if (status) {
    query = query.eq('status', status);
  }
  if (sheetId) {
    query = query.eq('grading_sheet_id', sheetId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = data ?? [];

  // Lazy reminder fire — once per row, when an approved request has been
  // sitting un-applied for 3+ days. Stamping reminder_sent_at BEFORE the
  // email send (and using the service client to bypass RLS for the
  // UPDATE) gives us idempotency: concurrent admin-inbox loads see the
  // stamped value and skip the candidate. The partial index from
  // migration 045 keeps the candidate filter cheap. Only the rows the
  // current viewer can see participate — a teacher filter excludes
  // other people's rows so this fan-out only ever fires from an admin
  // inbox load (where the registrar list is the right notify target).
  const THREE_DAYS_MS = 3 * 86_400_000;
  const reminderCandidates = rows.filter(
    (r) =>
      r.status === 'approved' &&
      r.approved_at != null &&
      Date.now() - Date.parse(r.approved_at) > THREE_DAYS_MS &&
      r.reminder_sent_at == null
  );
  if (reminderCandidates.length > 0) {
    const candidateIds = reminderCandidates.map((r) => r.id);
    const stampNow = new Date().toISOString();
    // Defensive .eq('status', 'approved') so a row that transitioned out
    // of approved (e.g., applied or cancelled) between the SELECT and
    // this UPDATE doesn't get its reminder_sent_at stamped — would
    // pollute the column semantics for any future audit of "was a
    // reminder ever sent for this request?".
    const { error: stampError } = await service
      .from('grade_change_requests')
      .update({ reminder_sent_at: stampNow })
      .in('id', candidateIds)
      .eq('status', 'approved');
    if (stampError) {
      console.error('[change-requests GET] reminder stamp failed', stampError);
    } else {
      after(async () => {
        try {
          const summaries: ApprovedStaleSummary[] = reminderCandidates.map(
            (r) => ({
              id: r.id,
              student_label: null,
              field_changed: r.field_changed,
              approved_at: r.approved_at as string,
              grading_sheet_id: r.grading_sheet_id,
            })
          );
          // Hydrate student labels in parallel — best-effort. If a label
          // lookup fails, leave it null and the email renders "(student)".
          const labelResults = await Promise.all(
            reminderCandidates.map((r) =>
              fetchLabels(service, r.grading_sheet_id, r.grade_entry_id).catch(
                () => ({ student_label: null, sheet_label: null })
              )
            )
          );
          labelResults.forEach((labels, i) => {
            summaries[i].student_label = labels.student_label;
          });
          const registrarEmails = await fetchRegistrarEmails(service);
          await notifyApprovedNotApplied(summaries, registrarEmails);
        } catch (e) {
          console.error('[change-requests GET] reminder fan-out failed', e);
        }
      });
    }
  }

  return NextResponse.json({ requests: rows });
}

// POST /api/change-requests
// Teachers file a new request against a locked sheet they are assigned to.
// school_admin+ can also file one (shouldn't need to, but not blocked).
export async function POST(request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const raw = await request.json().catch(() => null);
  const parsed = ChangeRequestFormSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? 'invalid body' },
      { status: 400 }
    );
  }
  const body = parsed.data;

  // Non-examinable override codes are the only valid letter_grade proposals —
  // A/B/C/IP are always derived, never filed (KD #104).
  if (
    body.field_changed === 'letter_grade' &&
    !isOverrideLetter(body.proposed_value.trim())
  ) {
    return NextResponse.json(
      {
        error: `Proposed value for a letter grade must be one of ${OVERRIDE_LETTERS.join(', ')}.`,
      },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // Load the sheet + entry + section metadata in one round-trip.
  const [sheetRes, entryRes] = await Promise.all([
    service
      .from('grading_sheets')
      .select('id, section_id, subject_id, is_locked')
      .eq('id', body.grading_sheet_id)
      .single(),
    service
      .from('grade_entries')
      .select(
        'id, grading_sheet_id, ww_scores, pt_scores, qa_score, letter_grade, is_na'
      )
      .eq('id', body.grade_entry_id)
      .single(),
  ]);

  if (sheetRes.error || !sheetRes.data) {
    return NextResponse.json({ error: 'sheet not found' }, { status: 404 });
  }
  if (entryRes.error || !entryRes.data) {
    return NextResponse.json({ error: 'entry not found' }, { status: 404 });
  }
  const sheet = sheetRes.data as {
    id: string;
    section_id: string;
    subject_id: string;
    is_locked: boolean;
  };
  const entry = entryRes.data as {
    id: string;
    grading_sheet_id: string;
    ww_scores: (number | null)[] | null;
    pt_scores: (number | null)[] | null;
    qa_score: number | null;
    letter_grade: string | null;
    is_na: boolean;
  };
  if (entry.grading_sheet_id !== sheet.id) {
    return NextResponse.json(
      { error: 'entry does not belong to sheet' },
      { status: 400 }
    );
  }
  if (!sheet.is_locked) {
    return NextResponse.json(
      {
        error:
          'sheet is not locked — edit directly instead of filing a request',
      },
      { status: 400 }
    );
  }

  // Teachers must be assigned to this section + subject to file a request —
  // held OR covered. A substitute who finds a wrong mark on a locked sheet has
  // to be able to raise it; the alternative is waiting for a teacher who is on
  // leave. A substitute acts under their own login, so the approval ladder
  // records who filed it.
  if (auth.role === 'teacher') {
    const cookieClient = await createClient();
    const assignments = await loadEffectiveAssignmentsForUser(
      cookieClient,
      auth.user.id
    );
    if (!isSubjectTeacher(assignments, sheet.section_id, sheet.subject_id)) {
      return NextResponse.json(
        { error: 'not assigned to this sheet' },
        { status: 403 }
      );
    }
  }

  // Snapshot the current value from the entry for the requested field/slot.
  const currentValue = snapshotCurrentValue(
    entry,
    body.field_changed,
    body.slot_index
  );

  // Server-side spurious-request guard. The client also disables Submit
  // when proposed === current, but file requests can be POSTed by other
  // clients (curl, scripts, etc.). Reject canonically-equal values with
  // 422 so the approver inbox doesn't fill with no-op requests.
  if (canonicallyEqual(body.field_changed, body.proposed_value, currentValue)) {
    return NextResponse.json(
      {
        error:
          'The proposed value is the same as the current value. Edit the proposed value before filing the request.',
      },
      { status: 422 }
    );
  }

  // slot_index ceiling guard. A teacher could submit slot_index=4 even
  // when this subject's ww_max_slots is 3 — the request would file but
  // the apply path would silently overwrite a non-existent slot. Reject
  // the file at filing time with 422 so the teacher fixes their picker.
  if (
    body.field_changed === 'ww_scores' ||
    body.field_changed === 'pt_scores'
  ) {
    const { data: sectionRow, error: sectionErr } = await service
      .from('sections')
      .select('id, level_id, academic_year_id')
      .eq('id', sheet.section_id)
      .maybeSingle();
    if (sectionErr || !sectionRow) {
      return NextResponse.json(
        { error: 'Could not resolve the section for this sheet.' },
        { status: 500 }
      );
    }
    // Migration 080 dropped subject_configs.level_id — a config row is now
    // unique per (academic_year_id, subject_id) alone (Pattern B). The
    // stale .eq('level_id', ...) filter here used to error against the
    // dropped column, so configRow silently resolved null and this whole
    // ceiling guard was a no-op — restored below.
    const { data: configRow } = await service
      .from('subject_configs')
      .select('ww_max_slots, pt_max_slots')
      .eq('academic_year_id', sectionRow.academic_year_id)
      .eq('subject_id', sheet.subject_id)
      .maybeSingle();
    if (configRow) {
      const max =
        body.field_changed === 'ww_scores'
          ? Number(configRow.ww_max_slots ?? 5)
          : Number(configRow.pt_max_slots ?? 5);
      // slot_index is 0-based; valid indices are 0..(max-1). User-facing
      // copy uses 1-based numbering for clarity.
      if (body.slot_index != null && body.slot_index >= max) {
        const fieldLabel =
          body.field_changed === 'ww_scores'
            ? 'Written Work'
            : 'Performance Task';
        return NextResponse.json(
          {
            error: `${fieldLabel} slot ${body.slot_index + 1} doesn't exist for this subject. The maximum is ${max} slot${max === 1 ? '' : 's'}.`,
          },
          { status: 422 }
        );
      }
    }
    // If configRow is null (no subject_config for this pair), don't
    // 422 — fall through and let the existing per-AY config govern.
    // Missing config is its own bug class, not in scope here.
  }

  // ── Who approves it ──────────────────────────────────────────────────────
  //
  // The teacher no longer chooses (migration 144). Once parents could have
  // seen this grade on a report card, the change goes to the Academic and
  // Examination Board; before that, to the ordinary grade change approvers.
  // The school sets the people on each in SIS Admin → Approvers.
  //
  // ⚠ REFUSED BEFORE ANYTHING IS WRITTEN when the steps cannot run. A request
  // on a ladder with no steps, or with a named step nobody covers for this
  // class, would sit forever with nobody able to act and nothing explaining
  // why. Unlike a parent's absence (lib/declarations/approval.ts), a teacher
  // filing a grade change is staff and can be told plainly who to ask.
  //
  // ⚠ THE ROUTE IS FIXED HERE. A report card published after filing does not
  // move a request already on the ordinary ladder to the board.
  let flow: GradeChangeApprovalFlow;
  let levelType: ApproverLevelScope | null;
  let ladder: Awaited<ReturnType<typeof loadConfiguredLadder>>;
  try {
    const [resolvedFlow, levelTypes] = await Promise.all([
      resolveGradeChangeFlow(service, {
        gradeEntryId: entry.id,
        gradingSheetId: sheet.id,
      }),
      loadLevelTypesBySection(service, [sheet.section_id]),
    ]);
    flow = resolvedFlow;
    levelType = levelTypes.get(sheet.section_id) ?? null;
    ladder = await loadConfiguredLadder(service, flow);
  } catch (e) {
    console.error(
      '[change-requests POST] could not work out the approval steps',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      {
        error:
          'Could not work out who needs to approve this change. Nothing was sent — please try again.',
      },
      { status: 500 }
    );
  }

  // ⚠ THE FILER IS LEFT OFF EVERY STEP. Nobody approves their own request, so
  // a step whose only person is the teacher filing counts as a step with
  // nobody on it — refused here, in words that say why.
  const ladderProblem = gradeChangeLadderProblem(
    summariseGradeChangeLadder(ladder, levelType, new Map(), {
      filerId: auth.user.id,
    })
  );
  if (ladderProblem) {
    return NextResponse.json({ error: ladderProblem }, { status: 409 });
  }

  const { data: inserted, error: insertError } = await service
    .from('grade_change_requests')
    .insert({
      grading_sheet_id: body.grading_sheet_id,
      grade_entry_id: body.grade_entry_id,
      field_changed: body.field_changed,
      slot_index: body.slot_index,
      current_value: currentValue,
      proposed_value: body.proposed_value,
      reason_category: body.reason_category,
      justification: body.justification,
      status: 'pending',
      requested_by: auth.user.id,
      requested_by_email: auth.user.email ?? '(unknown)',
      approval_flow: flow,
    })
    .select('*')
    .single();

  if (insertError || !inserted) {
    return NextResponse.json(
      { error: insertError?.message ?? 'insert failed' },
      { status: 500 }
    );
  }

  // ⚠ A REQUEST WITH NO LADDER IS TAKEN BACK OUT. Nobody could ever decide it,
  // no queue would show it, and the teacher would be told it was sent. The
  // row is removed before any audit row or email refers to it, so a failure
  // here leaves nothing behind but the log line.
  let opened: OpenApprovalRequestResult | null = null;
  try {
    opened = await openApprovalRequest(service, {
      flow,
      subjectType: GRADE_CHANGE_SUBJECT_TYPE,
      subjectId: inserted.id,
      sectionId: sheet.section_id,
      levelType,
      filedBy: auth.user.id,
      filedByEmail: auth.user.email ?? '(unknown)',
      excludeUserIds: [auth.user.id],
    });
  } catch (e) {
    console.error(
      '[change-requests POST] approval request could not be opened',
      inserted.id,
      e instanceof Error ? e.message : String(e)
    );
  }
  if (!opened?.opened) {
    if (opened) {
      console.error(
        '[change-requests POST] approval request not opened',
        inserted.id,
        opened.reason
      );
    }
    const { error: rollbackErr } = await service
      .from('grade_change_requests')
      .delete()
      .eq('id', inserted.id);
    if (rollbackErr) {
      console.error(
        '[change-requests POST] rollback of the unsent request failed',
        inserted.id,
        rollbackErr.message
      );
    }
    return NextResponse.json(
      {
        error:
          'Could not send this request for approval. Nothing was filed — please try again.',
      },
      { status: 500 }
    );
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'grade_change_requested',
    entityType: 'grade_change_request',
    entityId: inserted.id,
    context: {
      grading_sheet_id: body.grading_sheet_id,
      grade_entry_id: body.grade_entry_id,
      field: body.field_changed,
      slot_index: body.slot_index,
      proposed: body.proposed_value,
      reason_category: body.reason_category,
      flow,
      request_id: opened.requestId,
    },
  });

  invalidateDrillTags('markbook', await requireCurrentAyCode(service));

  // Pre-flight: who is on step 1, with an email address. Resolved before the
  // response so a teacher whose request reaches nobody's inbox is told so and
  // can go and find the approver in person. A named step with nobody on it
  // was refused above; this catches the rest — a class with no adviser this
  // week, or approvers with no email on their account.
  let stepOne: Awaited<ReturnType<typeof loadGradeChangeStepRecipients>> = null;
  try {
    stepOne = await loadGradeChangeStepRecipients(service, {
      flow,
      gradeChangeRequestId: inserted.id,
      stageOrder: 1,
    });
  } catch (e) {
    console.error(
      '[change-requests POST] step 1 recipients could not be read',
      e instanceof Error ? e.message : String(e)
    );
  }

  let notificationWarning: string | null = null;
  if (!stepOne || stepOne.recipients.length === 0) {
    notificationWarning =
      'Nobody on the first approval step could be reached by email. Please contact them directly.';
    await service
      .from('grade_change_requests')
      .update({ notification_status: 'failed' })
      .eq('id', inserted.id);
  } else {
    // Runs via after() so it survives past the response on Vercel's serverless
    // runtime (an un-awaited void(async()) has no such guarantee — the function
    // can freeze once the response is sent, which silently dropped these emails
    // in prod). The helper persists notification_status (sent / partial /
    // failed) and never throws.
    const step = stepOne;
    after(async () => {
      await sendGradeChangeStepEmails(service, {
        gradeChangeRequestId: inserted.id,
        step,
      });
    });
  }

  return NextResponse.json(
    { request: inserted, warning: notificationWarning },
    { status: 201 }
  );
}

function snapshotCurrentValue(
  entry: {
    ww_scores: (number | null)[] | null;
    pt_scores: (number | null)[] | null;
    qa_score: number | null;
    letter_grade: string | null;
    is_na: boolean;
  },
  field: ChangeRequestField,
  slotIndex: number | null
): string | null {
  switch (field) {
    case 'ww_scores': {
      const v = entry.ww_scores?.[slotIndex ?? -1];
      return v == null ? null : String(v);
    }
    case 'pt_scores': {
      const v = entry.pt_scores?.[slotIndex ?? -1];
      return v == null ? null : String(v);
    }
    case 'qa_score':
      return entry.qa_score == null ? null : String(entry.qa_score);
    case 'letter_grade':
      return entry.letter_grade;
    case 'is_na':
      return entry.is_na ? 'true' : 'false';
  }
}

/**
 * Spurious-request guard helper: compares the teacher's proposed value
 * (always a trimmed non-empty string per the schema) against the snapshot
 * current value (string or null per snapshotCurrentValue). Mirrors the
 * apply-route's valuesMatch helper but at scalar-vs-scalar granularity:
 *  - ww_scores / pt_scores / qa_score: coerce both sides to Number; treat
 *    empty string as null (not-taken ≠ scored 0 per Hard Rule #3, but at
 *    a single-slot scalar comparison empty proposed string can't equal a
 *    numeric current value anyway — that branch is defensive).
 *  - letter_grade: strict string equality (case-sensitive).
 *  - is_na: normalize 'true' / 'false' / true / false to boolean before
 *    compare.
 */
function canonicallyEqual(
  field: ChangeRequestField,
  proposed: string,
  current: string | null
): boolean {
  if (field === 'ww_scores' || field === 'pt_scores' || field === 'qa_score') {
    const p = proposed.trim();
    if (p === '' && current == null) return true;
    if (p === '' || current == null) return false;
    return Number(p) === Number(current);
  }
  if (field === 'is_na') {
    const p = proposed === 'true' || (proposed as unknown) === true;
    const c = current === 'true' || (current as unknown) === true;
    return p === c;
  }
  // letter_grade and any other string field — strict null-safe equality.
  // `proposed` is always a non-empty trimmed string here (zod's min(1) on
  // ChangeRequestFormSchema.proposed_value enforces it); a null `current`
  // therefore can never match an empty `proposed`, but be explicit anyway.
  return proposed === current;
}
