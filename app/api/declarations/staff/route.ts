import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireRole } from '@/lib/auth/require-role';
import { DECLARATION_STATUS_LABELS } from '@/lib/schemas/declarations';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';
import { logAction } from '@/lib/audit/log-action';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import { staffMedicalCertificateSchema } from '@/lib/schemas/staff-declaration';
import {
  filingCoversAnySchoolDay,
  NO_SCHOOL_DAY_MESSAGE,
} from '@/lib/declarations/filing-window';
import {
  assertCanMarkRegisterForSection,
  attachEvidenceToFiling,
  certificateAlreadyOnFileMessage,
  findFilingCoveringDays,
  isOwnStaffEvidencePath,
  resolveFilingTarget,
  travelFilingBlocksCertificateMessage,
  type ExistingFiling,
  type FilingTarget,
} from '@/lib/declarations/staff-filing';

// POST /api/declarations/staff
//
// A member of staff attaching a medical certificate the parent could not file.
// Mr Ace asked for this twice in the same words — staff must be able to attach
// one themselves "if the parent wasn't able to" — from the Term-sheet cell
// dialog and from the Daily view. A paper MC handed in at the office is the
// commonest case in the school today, and until now it ended in a drawer with
// nothing on the day.
//
// The reasoning behind the four decisions this route embodies — same table as
// the parent's, already approved, no approval ladder, no register write — is
// written down once in `lib/declarations/staff-filing.ts`. What follows is only
// where each one lands in the code.
//
// ── ONE ENDPOINT, BECAUSE THE SCREEN ASKS ONE QUESTION ────────────────────
//
// Mr Ace: *"the simplest way is just allow the SIS users to upload the MC."*
// The person using this is holding a certificate for a day and has no idea
// whether a parent has filed anything, so they are never asked. This route
// answers it for them:
//
//   * nothing on record for those days  → it creates the filing (201);
//   * a filing already covering them    → the certificate joins THAT row (200);
//   * that filing already has one       → 409, saying so in a sentence;
//   * only a family holiday covers them → 409, because a travel row cannot
//                                         carry a certificate at all.
//
// ⚠ THE ATTACH BRANCH IS WHY THIS IS ONE ENDPOINT AND NOT TWO. A second row
// for one illness is exactly the split record migration 125 exists to end.

export async function POST(request: Request) {
  // ⚠ THE DAILY WRITE ROUTE'S ROLE LIST, COPIED EXACTLY. The rule is "whoever
  // may mark that section's register", and this is the first half of it. The
  // second half — the per-section check for a teacher — is below, once the
  // request has named a child and we know which class that is.
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Could not read that request. Please try again.' },
      { status: 400 }
    );
  }

  // ⚠ `sgToday()`, never `new Date()`. The date guards are about Singapore's
  // calendar day; a server-local date turns away a legitimate entry made late
  // in the evening.
  const parsed = staffMedicalCertificateSchema(sgToday()).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Please check the details.',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // ── The attachment must be the caller's own upload ───────────────────────
  //
  // ⚠ CHECKED BEFORE ANYTHING IS READ FROM THE DATABASE, and it is the easy
  // one to forget: `evidencePath` is just a string in the request body. The
  // upload route writes to `declarations/staff/<staff user id>/<random>.<ext>`,
  // so a path outside this person's own folder is either a typo or an attempt
  // to attach somebody else's medical certificate to a child they can reach —
  // where every staff screen would then render it. Mirrors the parent route's
  // check step for step, against a folder no parent can write to.
  if (
    input.evidencePath &&
    !isOwnStaffEvidencePath(auth.user.id, input.evidencePath)
  ) {
    return NextResponse.json(
      { error: 'That attachment could not be matched to this upload.' },
      { status: 403 }
    );
  }

  const service = createServiceClient();

  let target;
  try {
    target = await resolveFilingTarget(service, input.sectionStudentId);
  } catch (e) {
    console.error(
      '[declarations] staff filing lookup failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      { error: 'Could not look that student up. Please try again.' },
      { status: 500 }
    );
  }
  if (!target) {
    return NextResponse.json(
      { error: 'That student is no longer in this class list.' },
      { status: 404 }
    );
  }

  // ── May this person mark that class's register? ──────────────────────────
  //
  // The existing predicate, not a new one — see `assertCanMarkRegisterForSection`.
  // It fails closed on a lookup failure and on an empty assignment list.
  const access = await assertCanMarkRegisterForSection(
    service,
    { userId: auth.user.id, role: auth.role },
    target.sectionId
  );
  if (!access.ok) {
    // ⚠ The REASON goes to the log, never to the screen. "not form adviser for
    // section 4444…" is a sentence about our data model; the person reading it
    // is a teacher who opened the wrong class.
    console.warn(
      `[declarations] staff filing refused for ${auth.user.email ?? auth.user.id}: ${access.reason}`
    );
    return NextResponse.json(
      {
        error:
          'You can only record a certificate for a class whose register you mark.',
      },
      { status: 403 }
    );
  }

  // ── Is the school even open on those dates? ──────────────────────────────
  //
  // Same rule and the same fail-open posture as the parent's filing: refused
  // only when NO day in the range is a school day, because a range that
  // straddles a weekend is perfectly ordinary. A calendar lookup that throws
  // must not become a refusal — a certificate the office cannot record is a
  // wall, while a filing on a closed day is a small mess somebody can see.
  try {
    const opensSomeDay = await filingCoversAnySchoolDay(service, {
      startDate: input.startDate,
      endDate: input.endDate,
      children: [
        {
          academicYearId: target.academicYearId,
          levelType: levelTypeForAudienceLookup(target.levelCode),
        },
      ],
    });
    if (!opensSomeDay) {
      return NextResponse.json(
        { error: NO_SCHOOL_DAY_MESSAGE },
        { status: 400 }
      );
    }
  } catch (e) {
    console.error(
      '[declarations] staff school-day check failed; letting it through:',
      e instanceof Error ? e.message : String(e)
    );
  }

  // ── Is this day already on record? ───────────────────────────────────────
  //
  // ⚠ THE ANSWER DECIDES WHAT THIS REQUEST DOES, AND THE CALLER NEVER SEES THE
  // QUESTION. Mr Ace's ask was one upload control — a member of staff holding
  // a certificate for a day, with no idea whether a parent has filed anything.
  // So the server decides: nothing on record and it creates the filing below;
  // something already covering the day and the certificate joins THAT row.
  //
  // ⚠ THE UNIQUE INDEX CANNOT ANSWER THIS.
  // `student_declarations_no_duplicate_filing` keys on `filed_by`, and a staff
  // filing carries the STAFF member's id — so it can never collide with a
  // parent's row for the same child and dates. The only collision it catches
  // is the same person submitting twice, handled at the insert below.
  //
  // ⚠ Same fail-open posture as the calendar check: a lookup that throws must
  // not turn a certificate away. The cost of letting it through is a second
  // row somebody can see and merge; the cost of refusing is a wall.
  let existing: ExistingFiling | null = null;
  try {
    existing = await findFilingCoveringDays(service, {
      studentId: target.studentId,
      startDate: input.startDate,
      endDate: input.endDate,
    });
  } catch (e) {
    console.error(
      '[declarations] staff existing-filing check failed; letting it through:',
      e instanceof Error ? e.message : String(e)
    );
  }

  if (existing) {
    return attachToExistingFiling({
      service,
      existing,
      target,
      input,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
    });
  }

  const now = new Date().toISOString();
  const row = {
    // A filing group of one. The column is `not null` and groups the rows one
    // parent submission creates across siblings; staff record one child at a
    // time, so this is its own group rather than a shared one.
    filing_group_id: randomUUID(),
    declaration_type: 'absence' as const,
    student_id: target.studentId,
    section_student_id: target.sectionStudentId,
    section_id: target.sectionId,
    academic_year_id: target.academicYearId,
    start_date: input.startDate,
    end_date: input.endDate,
    with_medical: true,
    evidence_path: input.evidencePath ?? null,
    evidence_url: input.evidenceUrl ?? null,
    destination_country: null,
    destination_city: null,
    // ⚠ NEVER WRITTEN BY THIS ROUTE. `parent_note` is rendered on every staff
    // screen as *the parent's message*, so staff text stored there would be
    // read back as words the family never wrote.
    parent_note: null,
    // ⚠ IN ALREADY APPROVED, WITH NO LADDER. The FCA → officer-in-charge
    // ladder vets a claim a PARENT is making; the school recording its own
    // evidence has nobody left to vet it, and grants no authority the caller
    // did not already have by being able to mark the day `EX`.
    status: 'approved' as const,
    // Who did it. `filed_by` is a plain uuid with no foreign key (migration
    // 125), so a staff id sits in it as legitimately as a parent's, and
    // `filed_by_email` preserves the person either way.
    filed_by: auth.user.id,
    filed_by_email: auth.user.email?.trim().toLowerCase() ?? '(unknown)',
    // ⚠ DELIBERATELY NULL. This flow did NOT write the register, because the
    // marking path did: whoever records this is already marking the day `EX`
    // through `PATCH /api/attendance/daily`, and writing the days again here
    // would append a second mark for each one. KD #197's register write belongs
    // to the approval ladder, and this row has no ladder.
    register_written_at: null,
    register_days_written: null,
    register_write_error: null,
    created_at: now,
    updated_at: now,
  };

  const { data: inserted, error } = await service
    .from('student_declarations')
    .insert(row)
    .select('id, status, created_at')
    .single();

  if (error) {
    // ⚠ A 23505 HERE IS THE SAME PERSON'S DOUBLE-TAP AND NOTHING ELSE. The
    // existing-filing check above already answered a re-send that arrived
    // after the first one landed — that row is `approved` and carries its
    // certificate, so the person is told it is on file. What is left is two
    // requests IN FLIGHT AT ONCE, neither able to see the other, racing to
    // the insert. The loser is answered with a success and the row that won,
    // exactly as the parent route answers the same race.
    //
    // Either way the caller never sees a constraint name or a raw error.
    if (error.code === '23505') {
      const { data: existing } = await service
        .from('student_declarations')
        .select('id, status, created_at')
        .eq('student_id', target.studentId)
        .eq('declaration_type', 'absence')
        .eq('start_date', input.startDate)
        .eq('end_date', input.endDate)
        .eq('filed_by', auth.user.id)
        .maybeSingle();
      const hit = existing as { id: string; created_at: string } | null;
      return NextResponse.json(
        {
          declaration: hit
            ? describe(hit.id, hit.created_at, target, input, row)
            : null,
          alreadyFiled: true,
        },
        { status: 200 }
      );
    }
    console.error('[declarations] staff filing insert failed:', error.message);
    return NextResponse.json(
      { error: 'Could not save that. Please try again.' },
      { status: 500 }
    );
  }

  const saved = inserted as unknown as { id: string; created_at: string };

  // ── Audit ────────────────────────────────────────────────────────────────
  //
  // ⚠ THIS IS THE ONLY TRACE THE FILING LEAVES, and that is why it is not
  // optional. With no `approval_request` the row appears in no declarations
  // queue and produces no Activity-panel event — `lib/activity/feed.ts` derives
  // its events from `approval_request_stages`, and there are none. So the log
  // carries the actor, the child, the class, the days and whether a file or a
  // link was attached.
  //
  // ⚠ IT REUSES `declaration.approve` RATHER THAN ADDING AN ACTION, and the
  // row is honest under that name: a declaration did come into being fully
  // approved. `recorded_by_school` is what tells the two apart, and
  // `lib/audit/humanize.ts` renders it in words. The alternative — a new
  // action — needs a line added to `ATTENDANCE_AUDIT_ACTIONS` in
  // `app/(attendance)/attendance/audit-log/page.tsx` or
  // `__tests__/audit/allowlist-coverage.test.ts` fails, and that file belongs
  // to another session's edit; an action nobody can see is worse than a shared
  // one that reads correctly.
  //
  // ⚠ NO DOCUMENT AND NO LINK IN THE CONTEXT — presence only, the rule
  // migration 109 set for `ex_note` and 125 restated. `audit_log` is readable
  // by every `is_registrar_or_above()` user and can never be corrected, and a
  // URL to a child's medical certificate is exactly the material that rule is
  // about.
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'declaration.approve',
    entityType: 'student_declaration',
    entityId: saved.id,
    context: {
      recorded_by_school: true,
      declaration_type: 'absence',
      with_medical: true,
      evidence_kind: evidenceKind(input.evidencePath, input.evidenceUrl),
      student_id: target.studentId,
      student_number: target.studentNumber,
      section_student_id: target.sectionStudentId,
      section_id: target.sectionId,
      section_name: target.className ?? target.sectionName,
      start_date: input.startDate,
      end_date: input.endDate,
    },
  });

  // ⚠ NO CACHE BUST. The attendance sheet reads its filings through
  // `loadCellFilingsForSection` on a live service client with no
  // `unstable_cache` wrapper, and the register is untouched by this route, so
  // there is nothing stale to evict. If that page ever gains a cache, this is
  // where the tag would go.

  return NextResponse.json(
    { declaration: describe(saved.id, saved.created_at, target, input, row) },
    { status: 201 }
  );
}

/**
 * The certificate joins a filing that is already there.
 *
 * ⚠ THE PERSON WHO UPLOADED IT WAS NOT ASKED ABOUT ANY OF THIS, and that is
 * the design. They are holding a certificate for a day; whether a parent
 * already filed is ours to know, not theirs to answer. Every branch below ends
 * in either "the certificate is on the day" or one plain sentence saying why
 * it is not.
 */
async function attachToExistingFiling(args: {
  service: SupabaseClient;
  existing: ExistingFiling;
  target: FilingTarget;
  input: {
    startDate: string;
    endDate: string;
    evidencePath?: string;
    evidenceUrl?: string;
    /** Set only on the request sent AFTER the person read the warning. */
    replaceExisting?: boolean;
  };
  actor: { id: string; email: string | null };
}) {
  const { service, existing, target, input, actor } = args;

  // A family holiday carries no certificate and cannot be made to —
  // `student_declarations_type_shape_chk` forbids evidence on a travel row
  // outright. The likeliest cause is the wrong dates, and the message says so.
  if (existing.declarationType === 'travel') {
    return NextResponse.json(
      {
        error: travelFilingBlocksCertificateMessage(
          target.studentName,
          existing
        ),
      },
      { status: 409 }
    );
  }

  // ⚠ PROOF ALREADY ON THE DAY IS REPLACED, BUT ONLY ON A SECOND, DELIBERATE
  // ATTEMPT. Mr Ace, 2026-08-31: re-uploading in the SIS "will override it but
  // theres a warning". This 409 IS that warning — the first request never
  // carries `replaceExisting`, so it lands here, and the screen turns the
  // refusal into the question it puts to the person. The request they send
  // after agreeing carries the flag and passes straight through.
  //
  // Modelling it as two requests rather than one overwriting call is what
  // stops the warning being decorative: anything that skipped the UI, or any
  // retry of a stale request, would otherwise replace a child's medical
  // certificate with nobody having been asked.
  const replacing = existing.hasEvidence;
  if (replacing && !input.replaceExisting) {
    return NextResponse.json(
      {
        error: certificateAlreadyOnFileMessage(target.studentName, existing),
        // The screen keys its warning on this rather than parsing the
        // sentence, so the wording stays free to change.
        certificateAlreadyOnFile: true,
      },
      { status: 409 }
    );
  }

  let attached;
  try {
    attached = await attachEvidenceToFiling(service, {
      filingId: existing.id,
      evidencePath: input.evidencePath ?? null,
      evidenceUrl: input.evidenceUrl ?? null,
      replace: replacing,
    });
  } catch (e) {
    console.error(
      '[declarations] attaching to an existing filing failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      { error: 'Could not save that. Please try again.' },
      { status: 500 }
    );
  }

  // Zero rows back means the row stopped matching between the read and the
  // write. On a first attach that is somebody else getting there first — the
  // parent uploading in the portal while the office scans the paper copy — and
  // the winner's certificate stands. On a replacement it is the opposite: the
  // certificate being replaced is no longer there, so there is nothing to
  // warn about any more and landing this silently would be wrong.
  if (!attached.attached) {
    return NextResponse.json(
      {
        error: replacing
          ? `The certificate for ${target.studentName} changed while you were looking at it. Open the day again to see what is on file now.`
          : certificateAlreadyOnFileMessage(target.studentName, existing),
        certificateAlreadyOnFile: !replacing,
      },
      { status: 409 }
    );
  }

  // ⚠ THE SAME ACTION AS THE CREATE PATH, for the same reason: a new action
  // needs a line in `ATTENDANCE_AUDIT_ACTIONS` and that file is off limits
  // here, so an action nobody can see would be worse than a shared one that
  // reads correctly. `attached_to_existing` is what tells the two apart, and
  // `lib/audit/humanize.ts` renders it in words.
  //
  // ⚠ THE FILING'S OWN DATES, not the ones typed. The row that changed covers
  // the range the parent filed, which may be wider than the single day the
  // certificate was recorded against.
  await logAction({
    service,
    actor,
    action: 'declaration.approve',
    entityType: 'student_declaration',
    entityId: existing.id,
    context: {
      recorded_by_school: true,
      attached_to_existing: true,
      // ⚠ A REPLACEMENT MUST NOT READ AS A FIRST UPLOAD. Somebody replaced a
      // certificate the school already held, and the log is the only place
      // that fact survives — the row now points at the new file and the UI
      // never mentions the old one again.
      //
      // ⚠ Still PRESENCE ONLY: no path and no URL, for either file. That is
      // migration 109's rule, restated by 125 — `audit_log` is readable by
      // every is_registrar_or_above() user and can never be corrected, and a
      // link to a child's medical certificate is exactly what it is about.
      ...(replacing ? { replaced_existing: true } : {}),
      declaration_type: 'absence',
      with_medical: true,
      evidence_kind: evidenceKind(input.evidencePath, input.evidenceUrl),
      student_id: target.studentId,
      student_number: target.studentNumber,
      section_student_id: target.sectionStudentId,
      section_id: target.sectionId,
      section_name: target.className ?? target.sectionName,
      start_date: attached.startDate,
      end_date: attached.endDate,
    },
  });

  return NextResponse.json(
    {
      // ⚠ 200, NOT 201. Nothing was created — a row that already existed now
      // carries proof it was missing.
      attached: true,
      declaration: {
        id: existing.id,
        studentNumber: target.studentNumber,
        studentName: target.studentName,
        className: target.className,
        declarationType: 'absence' as const,
        startDate: attached.startDate,
        endDate: attached.endDate,
        withMedical: true,
        hasUpload: input.evidencePath != null,
        evidenceUrl: input.evidenceUrl ?? null,
        status: attached.status,
        statusLabel:
          DECLARATION_STATUS_LABELS[
            attached.status as keyof typeof DECLARATION_STATUS_LABELS
          ] ?? attached.status,
        recordedBySchool: false,
      },
    },
    { status: 200 }
  );
}

/** `file`, `link`, or `both` — what proof was attached, never the proof itself. */
function evidenceKind(
  path: string | undefined,
  url: string | undefined
): 'file' | 'link' | 'both' {
  if (path && url) return 'both';
  return path ? 'file' : 'link';
}

/**
 * The shape the dialog renders back.
 *
 * ⚠ `hasUpload` rather than the path. The public URL is derivable from the
 * path and every staff screen already derives it once, in
 * `lib/declarations/staff.ts`; handing a second copy to the browser is how the
 * two start disagreeing about where a file lives.
 */
function describe(
  id: string,
  createdAt: string,
  target: {
    studentNumber: string;
    studentName: string;
    className: string | null;
  },
  input: { startDate: string; endDate: string; evidenceUrl?: string },
  row: { filed_by_email: string; evidence_path: string | null }
) {
  return {
    id,
    studentNumber: target.studentNumber,
    studentName: target.studentName,
    className: target.className,
    declarationType: 'absence' as const,
    startDate: input.startDate,
    endDate: input.endDate,
    withMedical: true,
    hasUpload: row.evidence_path != null,
    evidenceUrl: input.evidenceUrl ?? null,
    status: 'approved' as const,
    statusLabel: 'Approved',
    recordedBySchool: true,
    filedByEmail: row.filed_by_email,
    filedAt: createdAt,
  };
}
