import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAllStudentsByParentEmail } from '@/lib/supabase/admissions';
import { buildReportCard } from '@/lib/report-card/build-report-card';
import { getClientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { corsHeaders } from '@/lib/cors';
import { toPlainText } from '@/lib/rich-text';
import {
  computeActivePublishedTermNumbers,
  filterPayloadToActiveTerms,
  selectEarlierComments,
  termNumbersUpToViewed,
  type PublicationRow,
  type TermNumberRow,
} from '@/lib/report-card/publication-window';

// GET /api/parent/v2/report-card?studentId=<uuid>&termNumber=<1|2|3|4>
//
// Called by the admissions portal SPA. Validates Bearer token, confirms
// parent → student linkage, checks an active publication window for the
// requested term, then returns the full ReportCardPayload as JSON.
//
// termNumber is optional — if omitted the payload still returns all terms
// and the client picks which to display.

// CORS: reflects the portal origin from the allowlist with credentials — see
// lib/cors.ts (shared with the students route).

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  });
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin);
  const url = new URL(request.url);

  // IP-based limit — checked before any DB work.
  const ip = getClientIp(request);
  const ipRl = rateLimit({ ip, scope: 'parent-v2', ipMax: 30, windowSecs: 60 });
  if (ipRl.limited) return tooManyRequests(ipRl.retryAfter, cors);

  const studentId = url.searchParams.get('studentId') ?? '';
  const termNumberRaw = url.searchParams.get('termNumber');
  const termNumber = termNumberRaw ? parseInt(termNumberRaw, 10) : null;
  if (termNumberRaw && Number.isNaN(termNumber)) {
    return NextResponse.json(
      { error: 'invalid termNumber' },
      { status: 400, headers: cors }
    );
  }

  if (!studentId) {
    return NextResponse.json(
      { error: 'missing studentId' },
      { status: 400, headers: cors }
    );
  }

  // 1. Verify Bearer token.
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';
  if (!token) {
    return NextResponse.json(
      { error: 'missing Bearer token' },
      { status: 401, headers: cors }
    );
  }

  const service = createServiceClient();
  const { data: userData, error: authError } =
    await service.auth.getUser(token);
  if (authError || !userData.user?.email) {
    return NextResponse.json(
      { error: 'invalid or expired token' },
      { status: 401, headers: cors }
    );
  }
  const email = userData.user.email.trim().toLowerCase();

  // Per-user limit — checked after token is confirmed valid.
  const userRl = rateLimit({
    ip,
    userId: userData.user.id,
    scope: 'parent-v2',
    ipMax: 30,
    userMax: 20,
    windowSecs: 60,
  });
  if (userRl.limited) return tooManyRequests(userRl.retryAfter, cors);

  // 2. Resolve the requested student and confirm they belong to this parent.
  const { data: studentRow } = await service
    .from('students')
    .select('id, student_number')
    .eq('id', studentId)
    .single();
  if (!studentRow) {
    return NextResponse.json(
      { error: 'student not found' },
      { status: 404, headers: cors }
    );
  }

  const admissionsRows = await getAllStudentsByParentEmail(email);
  const linked = admissionsRows.some(
    (r) =>
      r.student_number ===
      (studentRow as { student_number: string }).student_number
  );
  if (!linked) {
    return NextResponse.json(
      { error: 'not authorised for this student' },
      { status: 403, headers: cors }
    );
  }

  // 3. Check that a currently-active publication window exists for the
  //    requested term (or any term when termNumber is omitted). Per KD #150,
  //    visibility is gated purely by the publication window, not by current
  //    enrolment status — a withdrawn student can still have a published,
  //    still-active term. Fetch ALL of the student's section_students rows
  //    (across AYs/transfers/withdrawn history) so every section they were
  //    ever in is a candidate for an active window.
  const { data: enrolmentRows } = await service
    .from('section_students')
    .select('section_id')
    .eq('student_id', studentId);
  const sectionIds = Array.from(
    new Set(
      ((enrolmentRows ?? []) as Array<{ section_id: string }>).map(
        (r) => r.section_id
      )
    )
  );
  if (sectionIds.length === 0) {
    return NextResponse.json(
      { error: 'student is not enrolled' },
      { status: 403, headers: cors }
    );
  }

  const now = Date.now();
  const { data: pubRows } = await service
    .from('report_card_publications')
    .select('id, section_id, term_id, publish_from, publish_until')
    .in('section_id', sectionIds);
  const termIds = Array.from(
    new Set(((pubRows ?? []) as PublicationRow[]).map((p) => p.term_id))
  );
  const { data: termRows } =
    termIds.length > 0
      ? await service.from('terms').select('id, term_number').in('id', termIds)
      : { data: [] };

  const activeTermNumbers = computeActivePublishedTermNumbers(
    (pubRows ?? []) as PublicationRow[],
    (termRows ?? []) as TermNumberRow[],
    sectionIds,
    now
  );

  if (
    activeTermNumbers.size === 0 ||
    (termNumber !== null && !activeTermNumbers.has(termNumber))
  ) {
    return NextResponse.json(
      { error: 'no active publication window for this term' },
      { status: 403, headers: cors }
    );
  }

  // 4. Build the report card payload (same function used by the SIS UI).
  const result = await buildReportCard(service, studentId);
  if (!result.ok) {
    const status =
      result.error.kind === 'student_not_found' ||
      result.error.kind === 'level_not_found'
        ? 404
        : 422;
    return NextResponse.json(
      { error: result.error.kind },
      { status, headers: cors }
    );
  }

  // 5. Narrow the payload down to the card the open window releases: terms
  //    1..viewed. Never a term ABOVE the viewed one — a T3 window must not leak
  //    the unpublished T4 column.
  //
  //    This used to narrow to the viewed term ALONE, which quietly cost the
  //    parent card its earlier columns. The portal builds both the grades table
  //    and the attendance table by mapping over `payload.terms`, so one term in
  //    meant one column out — a Term 3 card showing only Term 3, while the same
  //    card on the staff screen showed Terms 1, 2 and 3. The marks themselves
  //    were never missing: each `subjects[]` row carries its own t1/t2/t3/t4
  //    cells and the narrowing never touched them. What was missing was the
  //    `terms` entry that gives each cell its heading, and the earlier
  //    attendance rows.
  //
  //    A report card is cumulative by design (KD #129) and the window gates the
  //    CARD, not each column on it — the same reasoning `selectEarlierComments`
  //    already applies to the adviser write-ups below.
  const viewedTermNumber =
    termNumber ?? Math.max(...Array.from(activeTermNumbers));
  const targetTermNumbers = termNumbersUpToViewed(viewedTermNumber);

  const narrowed = filterPayloadToActiveTerms(
    result.payload,
    targetTermNumbers
  );

  // 6. The earlier terms' form-adviser write-ups, as a SEPARATE list.
  //
  //    A report card is cumulative on comments (KD #129) — a Term 3 card shows
  //    Term 1, 2 and 3 — and the portal renders those earlier boxes from this
  //    list, each one self-contained.
  //
  //    Deliberately NOT merged into `comments`: the portal reads the viewed
  //    term's comment out of `comments` by term id and renders THIS list above
  //    it, so an earlier comment appended to `comments` would either be ignored
  //    or — on any consumer that takes the first element — be printed under the
  //    viewed term's heading. Wrong data is worse than missing data.
  //
  //    ⚠ KEEP THIS FIELD even though step 5 now sends terms 1..N. The earlier
  //    terms' `comments` rows do ride along in the payload today, but the portal
  //    that is deployed reads its earlier boxes from HERE, and it is a separate
  //    app we neither own nor release. Dropping this would blank the earlier
  //    comments on the live card with nothing on our side able to fix it.
  //
  //    Each entry carries its own label + virtue theme, so the portal never has
  //    to look a term up in `terms`.
  //
  //    Authorisation is the viewed term's window, checked above — the card that
  //    window releases is by design the one carrying terms 1..N's comments. An
  //    earlier term does NOT need its own window: a school that publishes only
  //    the current term (the normal case) has no publication row for the earlier
  //    ones, and requiring one made this field arrive empty every time.
  const earlierComments = selectEarlierComments(
    result.payload.terms,
    result.payload.comments,
    viewedTermNumber
  );

  // A draft never reaches a parent. The builder carries `submitted` through so
  // the staff preview can flag one; this is the deliverable, so drop them.
  // (`earlierComments` applies the same rule internally.)
  //
  // ⚠ THE WRITE-UP LEAVES AS PLAIN TEXT, AND MUST. `comment` is
  // `evaluation_writeups.writeup`, which the adviser now writes in the
  // rich-text editor, so the column holds HTML. The portal that reads this
  // field is a SEPARATE app we neither own nor deploy, and it renders the
  // string as text — ship the HTML and every parent sees `<p><strong>` around
  // their child's comment, with no release on our side able to fix it.
  //
  // Deliberately NOT accompanied by a `commentHtml` sibling. Giving the portal
  // the formatting back is a decision for whoever owns it; this change only
  // keeps today's contract true.
  //
  // ⚠ An earlier comment that strips to nothing is DROPPED rather than sent
  // empty. `selectEarlierComments` rejects a blank write-up by trimming the
  // stored string, which `<p></p>` passes, so the emptiness test has to happen
  // on this side of the stripper too.
  const payload = {
    ...narrowed,
    comments: narrowed.comments
      .filter((c) => c.submitted)
      .map((c) => ({
        ...c,
        comment: c.comment == null ? null : toPlainText(c.comment),
      })),
    earlierComments: earlierComments
      .map((c) => ({ ...c, comment: toPlainText(c.comment) }))
      .filter((c) => c.comment !== ''),
  };

  return NextResponse.json({ payload }, { headers: cors });
}
