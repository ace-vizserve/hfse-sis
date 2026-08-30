import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';
import { logAction } from '@/lib/audit/log-action';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import { staffMedicalCertificateSchema } from '@/lib/schemas/staff-declaration';
import {
  filingCoversAnySchoolDay,
  findOverlappingFilings,
  NO_SCHOOL_DAY_MESSAGE,
} from '@/lib/declarations/filing-window';
import {
  alreadyOnRecordMessage,
  assertCanMarkRegisterForSection,
  isOwnStaffEvidencePath,
  resolveFilingTarget,
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

  // ── Is this absence already on record? ───────────────────────────────────
  //
  // ⚠ THE UNIQUE INDEX CANNOT ANSWER THIS, AND THE REASON IS WORTH KNOWING.
  // `student_declarations_no_duplicate_filing` keys on `filed_by`, and a staff
  // filing carries the STAFF member's id — so it can never collide with a
  // parent's row for the same child and dates, nor with a colleague's. The
  // only collision it does catch is the same person submitting twice, which is
  // handled at the insert below.
  //
  // So the real question is asked the way the parent route asks it, against
  // the same helper: does any live filing already cover these days? A parent
  // who filed without a certificate and is waiting for the school to decide is
  // the commonest hit, and it is exactly the case where a SECOND row would be
  // wrong — there is a filing sitting in the queue that this certificate
  // belongs to. The person is told which one, and told to open it.
  //
  // ⚠ `rejected` and `cancelled` never reach here: `findOverlappingFilings`
  // does not count them, so the office can record a certificate after a filing
  // was turned down for the want of exactly that certificate — which is the
  // most likely reason it was turned down.
  //
  // ⚠ Same fail-open posture again: a lookup that throws must not refuse.
  try {
    const clashes = await findOverlappingFilings(service, {
      startDate: input.startDate,
      endDate: input.endDate,
      declarationType: 'absence',
      children: [
        { studentId: target.studentId, studentName: target.studentName },
      ],
    });
    if (clashes.length > 0) {
      return NextResponse.json(
        {
          error: alreadyOnRecordMessage(clashes[0]),
          alreadyFiled: true,
          overlapping: clashes,
        },
        { status: 409 }
      );
    }
  } catch (e) {
    console.error(
      '[declarations] staff duplicate check failed; letting it through:',
      e instanceof Error ? e.message : String(e)
    );
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
    // overlap check above already answered a re-send that arrived after the
    // first one landed — the first row is `approved`, which that check counts.
    // What is left is two requests IN FLIGHT AT ONCE, neither able to see the
    // other, racing to the insert. The loser is answered with a success and
    // the row that won, exactly as the parent route answers the same race.
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
