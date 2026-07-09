import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAllStudentsByParentEmail } from '@/lib/supabase/admissions';
import { buildReportCard } from '@/lib/report-card/build-report-card';
import { getClientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { corsHeaders } from '@/lib/cors';
import {
  computeActivePublishedTermNumbers,
  filterPayloadToActiveTerms,
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

  // 5. Narrow subjects/attendance/comments down to exactly the terms with a
  //    currently-active publication window — never a term outside that set.
  //    A specific requested term narrows to just that one; an omitted
  //    termNumber narrows to every currently-active term (never the full
  //    unfiltered payload).
  const targetTermNumbers =
    termNumber !== null ? new Set([termNumber]) : activeTermNumbers;
  const payload = filterPayloadToActiveTerms(result.payload, targetTermNumbers);

  return NextResponse.json({ payload }, { headers: cors });
}
