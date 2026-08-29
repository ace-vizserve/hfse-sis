import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { createServiceClient } from '@/lib/supabase/service';
import { getClientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { corsHeaders } from '@/lib/cors';
import { sgToday } from '@/lib/dates';
import {
  fileDeclarationSchema,
  ListDeclarationsQuerySchema,
  type DeclarationStatus,
} from '@/lib/schemas/declarations';
import {
  listParentDeclarations,
  loadFilableStudents,
  type LinkedStudent,
} from '@/lib/declarations/parent';
import { openDeclarationApprovals } from '@/lib/declarations/approval';
import {
  alreadyFiledMessage,
  filingCoversAnySchoolDay,
  findOverlappingFilings,
  NO_SCHOOL_DAY_MESSAGE,
} from '@/lib/declarations/filing-window';

// Student Absence and Travel Declaration — the parent's own endpoints.
//
// POST  file a declaration for one or more of their children
// GET   the status tracker: their filings and where each one has got to
//
// Called by the admissions portal SPA, which is a separate application. The
// parent authenticates against the shared Supabase project and passes their
// access_token as a Bearer header — there is no cookie and no session here.
//
// ⚠ THIS IS THE FIRST ROUTE THE PORTAL MAY WRITE THROUGH. Everything the
// portal has ever called in this app has been read-only (`students`,
// `report-card`, `levels`). Three things follow, and each is a place to be
// careful rather than clever:
//
//   1. CORS must advertise POST — and only here. `corsHeaders` takes the
//      methods per route precisely so the read-only routes keep saying
//      `GET, OPTIONS`; `__tests__/api/cors-methods.test.ts` pins that.
//   2. Preflight now actually fires. A JSON POST is not a simple request, so
//      the browser sends OPTIONS first every time — hence Access-Control-Max-Age.
//   3. Every student identifier in the body is attacker-controlled. It is
//      checked against the parent's own children, resolved server-side, and
//      then the request's copy is never used again.
//
// Authorisation is application-layer, not RLS, and cannot be otherwise: a
// parent has no role and Postgres holds no parent→student link. Same pattern as
// `app/api/parent/v2/report-card/route.ts`, deliberately step for step.

const CORS_METHODS = 'GET, POST, OPTIONS';

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'), CORS_METHODS),
  });
}

/** Bearer → verified parent → their filable children. Shared by both handlers. */
async function authenticate(
  request: Request,
  cors: Record<string, string>,
  limits: { ipMax: number; userMax: number }
): Promise<
  | { ok: true; email: string; userId: string; students: LinkedStudent[] }
  | { ok: false; response: NextResponse }
> {
  const ip = getClientIp(request);
  const ipRl = rateLimit({
    ip,
    scope: 'parent-v2-declarations',
    ipMax: limits.ipMax,
    windowSecs: 60,
  });
  if (ipRl.limited) {
    return { ok: false, response: tooManyRequests(ipRl.retryAfter, cors) };
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'missing Bearer token' },
        { status: 401, headers: cors }
      ),
    };
  }

  const service = createServiceClient();
  const { data: userData, error: authError } =
    await service.auth.getUser(token);
  if (authError || !userData.user?.email) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'invalid or expired token' },
        { status: 401, headers: cors }
      ),
    };
  }
  const email = userData.user.email.trim().toLowerCase();

  const userRl = rateLimit({
    ip,
    userId: userData.user.id,
    scope: 'parent-v2-declarations',
    ipMax: limits.ipMax,
    userMax: limits.userMax,
    windowSecs: 60,
  });
  if (userRl.limited) {
    return { ok: false, response: tooManyRequests(userRl.retryAfter, cors) };
  }

  const students = await loadFilableStudents(service, email);
  return { ok: true, email, userId: userData.user.id, students };
}

export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get('origin'), CORS_METHODS);
  const auth = await authenticate(request, cors, { ipMax: 30, userMax: 20 });
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const parsed = ListDeclarationsQuerySchema.safeParse({
    studentNumber: url.searchParams.get('studentNumber') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad query' },
      { status: 400, headers: cors }
    );
  }

  const service = createServiceClient();
  const declarations = await listParentDeclarations(service, {
    students: auth.students,
    studentNumber: parsed.data.studentNumber,
    status: parsed.data.status as DeclarationStatus | undefined,
  });

  return NextResponse.json({ declarations }, { headers: cors });
}

export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get('origin'), CORS_METHODS);
  // Tighter than the read limits — this writes.
  const auth = await authenticate(request, cors, { ipMax: 10, userMax: 5 });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'expected a JSON body' },
      { status: 400, headers: cors }
    );
  }

  // ⚠ `sgToday()`, never `new Date()`. The backdate and lookahead rules are
  // about Singapore's calendar day; a server-local date rejects a legitimate
  // filing made late in the evening.
  const parsed = fileDeclarationSchema(sgToday()).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Please check the form.',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400, headers: cors }
    );
  }
  const input = parsed.data;

  // ── The authorisation step. ────────────────────────────────────────────
  // Resolve each submitted student number against the parent's OWN children.
  // ⚠ A number that is not theirs and a number that does not exist get the
  // same answer on purpose — distinguishing them tells a stranger whether a
  // student number is real.
  const byNumber = new Map(auth.students.map((s) => [s.studentNumber, s]));
  const resolved: LinkedStudent[] = [];
  for (const number of input.studentNumbers) {
    const hit = byNumber.get(number);
    if (!hit) {
      return NextResponse.json(
        { error: 'One of the children selected is not on your account.' },
        { status: 403, headers: cors }
      );
    }
    resolved.push(hit);
  }

  // ⚠ SECOND AUTHORISATION STEP, and it is easy to forget: `evidencePath` is
  // just a string in the request body. The upload route writes to
  // `declarations/<parent user id>/<random>.<ext>`, so a path outside this
  // parent's own folder is either a typo or an attempt to attach somebody
  // else's medical certificate to their own declaration — where the staff queue
  // would then render it. The prefix is the only thing tying a path to a person.
  if (input.declarationType === 'absence' && input.evidencePath) {
    const expectedPrefix = `declarations/${auth.userId}/`;
    if (!input.evidencePath.startsWith(expectedPrefix)) {
      return NextResponse.json(
        { error: 'That attachment could not be matched to this upload.' },
        { status: 403, headers: cors }
      );
    }
  }

  const service = createServiceClient();

  // ── Is the school even open on those dates? ──────────────────────────────
  //
  // The schema checks the dates against each other and against today; only the
  // calendar knows the school is shut. A filing covering ONLY closed days
  // marks nothing and approves nothing, so it is refused here rather than
  // travelling through two approvers to prove it.
  //
  // ⚠ Refused only when NO selected child has a school day in the range —
  // never merely because the range contains one. See `filingCoversAnySchoolDay`.
  //
  // ⚠ A calendar failure must not become a refusal. If this lookup throws, the
  // parent is let through: a filing on a closed day is a small mess somebody
  // can see and fix, while turning a parent away over our own outage is a wall
  // they cannot get past and will not understand.
  try {
    const opensSomeDay = await filingCoversAnySchoolDay(service, {
      startDate: input.startDate,
      endDate: input.endDate,
      children: resolved.map((s) => ({
        academicYearId: s.academicYearId,
        levelType: s.levelType,
      })),
    });
    if (!opensSomeDay) {
      return NextResponse.json(
        { error: NO_SCHOOL_DAY_MESSAGE },
        { status: 400, headers: cors }
      );
    }
  } catch (e) {
    console.error(
      '[declarations] school-day check failed; letting the filing through:',
      e instanceof Error ? e.message : String(e)
    );
  }

  // ── Have these days already been filed for? ──────────────────────────────
  //
  // The unique index catches ONE parent re-submitting the exact same dates and
  // the route below turns that into a success. It cannot catch the OTHER
  // parent filing the same absence, nor an overlapping range — see
  // `findOverlappingFilings`. Both produce two approval ladders and two
  // register writes for one illness.
  //
  // ⚠ Told, not silently merged. The parent asked for dates that are not the
  // same as the ones on record, so answering with the existing filing would be
  // answering a different question; and a filing they cannot see the outcome
  // of is the failure shape this whole feature exists to avoid.
  //
  // ⚠ Same posture as above on failure: a lookup that throws must not turn
  // into a refusal.
  try {
    const clashes = await findOverlappingFilings(service, {
      startDate: input.startDate,
      endDate: input.endDate,
      declarationType: input.declarationType,
      children: resolved.map((s) => ({
        studentId: s.studentId,
        studentName: s.displayName,
      })),
    });

    // ⚠ AN EXACT RE-SEND USED TO ANSWER 200 AND THAT WAS THE BUG (2026-08-29).
    // Migration 125 made that choice for a real reason — a parent double-tapping
    // submit on a flaky connection must not file twice, and showing them a
    // failure for their own double-tap makes them tap a third time. But it
    // answered a person days later the same way it answered a stuck button:
    // Mr Ace re-filed 3 Sep from the portal, was told it worked, and nothing
    // appeared in the SIS. His words — _"its pending for approval already,
    // refiling for the same date and it succeeds is confusing"_.
    //
    // The genuine double-tap is two requests IN FLIGHT AT ONCE. Neither sees
    // the other here, they race to the insert, and the unique index's `23505`
    // branch below still answers that one with a success. That is the case 125
    // was protecting, and it keeps its protection. A re-send that arrives after
    // the first one has landed is a person, and a person is told where it got
    // to — still with the school, or already approved and settled.
    //
    // ⚠ `rejected` and `cancelled` never reach here at all: `findOverlappingFilings`
    // does not count them, so a parent the school turned down can file again,
    // which is the whole point of migration 130.
    if (clashes.length > 0) {
      return NextResponse.json(
        {
          error: alreadyFiledMessage(clashes[0]),
          alreadyFiled: true,
          overlapping: clashes,
        },
        { status: 409, headers: cors }
      );
    }
  } catch (e) {
    console.error(
      '[declarations] duplicate check failed; letting the filing through:',
      e instanceof Error ? e.message : String(e)
    );
  }

  const filingGroupId = randomUUID();
  const now = new Date().toISOString();

  const rows = resolved.map((student) => ({
    filing_group_id: filingGroupId,
    declaration_type: input.declarationType,
    student_id: student.studentId,
    section_student_id: student.sectionStudentId,
    section_id: student.sectionId,
    academic_year_id: student.academicYearId,
    start_date: input.startDate,
    end_date: input.endDate,
    with_medical:
      input.declarationType === 'absence' ? input.withMedical : null,
    evidence_path:
      input.declarationType === 'absence' ? (input.evidencePath ?? null) : null,
    evidence_url:
      input.declarationType === 'absence' ? (input.evidenceUrl ?? null) : null,
    destination_country:
      input.declarationType === 'travel' ? input.destinationCountry : null,
    destination_city:
      input.declarationType === 'travel'
        ? (input.destinationCity ?? null)
        : null,
    parent_note: input.parentNote ?? null,
    status: 'pending' as const,
    filed_by: auth.userId,
    filed_by_email: auth.email,
    created_at: now,
    updated_at: now,
  }));

  const { data: inserted, error } = await service
    .from('student_declarations')
    .insert(rows)
    .select('id, student_id, section_id, status');

  if (error) {
    // ⚠ A duplicate is SUCCESS, not an error. `student_declarations_no_duplicate_filing`
    // exists so a parent double-tapping submit on a bad connection cannot file
    // twice; showing them a failure for it would make them try a third time.
    if (error.code === '23505') {
      const existing = await listParentDeclarations(service, {
        students: resolved,
      });
      const match = existing.filter(
        (d) =>
          d.declarationType === input.declarationType &&
          d.startDate === input.startDate &&
          d.endDate === input.endDate
      );
      return NextResponse.json(
        {
          filingGroupId: match[0]?.filingGroupId ?? null,
          declarations: match,
          alreadyFiled: true,
        },
        { status: 200, headers: cors }
      );
    }
    console.error('[declarations] insert failed:', error.message);
    return NextResponse.json(
      { error: 'Could not save that. Please try again.' },
      { status: 500, headers: cors }
    );
  }

  // ── Put each filing onto the approval ladder ─────────────────────────────
  //
  // ⚠ A DECLARATION WITH NO LADDER IS THE WORST FAILURE THIS FEATURE HAS,
  // because every screen looks fine: the parent sees "With the school", and no
  // staff queue anywhere shows it, forever. So a real failure here takes the
  // rows back out and asks the parent to try again — they will, and nothing is
  // stranded. A merely UNCONFIGURED flow is different and does not roll back;
  // see lib/declarations/approval.ts for why the parent must not pay for that.
  const insertedRows = (inserted ?? []) as unknown as Array<{
    id: string;
    student_id: string;
    section_id: string;
    status: string;
  }>;

  // ⚠ DECLARED HERE, ABOVE THE LADDER, AND NOT FURTHER DOWN. It used to sit
  // just before the response, and the ladder block below read it from inside a
  // `.map()` callback — which TypeScript cannot flag, because it cannot prove
  // when a closure runs, so `tsc` passed and every filing 500'd at runtime with
  // "Cannot access 'byStudentId' before initialization".
  const byStudentId = new Map(resolved.map((s) => [s.studentId, s]));

  try {
    const ladders = await openDeclarationApprovals(
      service,
      // ⚠ The child's half of the school comes from the resolved student, not
      // from the request — it is what picks the right officer in charge, and
      // `resolved` is the only student data here that has been authorised.
      insertedRows.map((r) => ({
        id: r.id,
        sectionId: r.section_id,
        levelType: byStudentId.get(r.student_id)?.levelType ?? null,
      })),
      { id: auth.userId, email: auth.email }
    );
    if (ladders.unconfigured > 0) {
      console.warn(
        `[declarations] ${ladders.unconfigured} filing(s) stored with no approval steps configured — nobody can act on them until /sis/admin/approvers is set up.`
      );
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[declarations] approval ladder failed:', reason);
    await service
      .from('student_declarations')
      .delete()
      .in(
        'id',
        insertedRows.map((r) => r.id)
      );
    return NextResponse.json(
      { error: 'Could not save that. Please try again.' },
      { status: 500, headers: cors }
    );
  }

  // ⚠ NOTHING IS AUDIT-LOGGED WITH THE NOTE IN IT. The parent's message is
  // medical-adjacent and about a child; `audit_log` is readable by every
  // is_registrar_or_above() user and can never be edited or deleted. Same rule
  // migration 109 set for attendance `ex_note`. The audit row for a filing is
  // written by the approval flow, and carries `note_present` only.

  return NextResponse.json(
    {
      filingGroupId,
      declarations: insertedRows.map((row) => {
        const student = byStudentId.get(row.student_id);
        return {
          id: row.id,
          studentNumber: student?.studentNumber ?? '',
          studentName: student?.displayName ?? '',
          status: row.status,
        };
      }),
    },
    { status: 201, headers: cors }
  );
}
