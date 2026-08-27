import { NextResponse } from 'next/server';

import { createServiceClient } from '@/lib/supabase/service';
import { getClientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { corsHeaders } from '@/lib/cors';
import { loadFilableStudents } from '@/lib/declarations/parent';

// GET /api/parent/v2/enrolled-students
//
// The parent's children who are ENROLLED RIGHT NOW — one entry per child, with
// enough to label them in a picker.
//
// ─────────────────────────────────────────────────────────────────────────
// ⚠ THIS IS NOT `/api/parent/v2/students`, AND PICKING THE WRONG ONE IS A
// SILENT BUG. Two endpoints returning "the parent's children" is genuinely
// confusing, so the difference is written here and in the other route's header.
//
//   /students           children who have at least one report card published
//                       RIGHT NOW. It exists for the report-card screen, and a
//                       publication window is its whole point. A child enrolled
//                       and attending, whose report card is not published this
//                       minute, is CORRECTLY ABSENT from it.
//
//   /enrolled-students  children with a live enrolment in the current academic
//                       year. Nothing to do with publication.
//
// So for anything a parent does ABOUT a child — declaring an absence, and later
// event registration — this is the list. Using `/students` there would hide a
// child from their own parent for the entire stretch between publications,
// which nobody would report as a bug because it looks like the child simply is
// not there.
//
// ─────────────────────────────────────────────────────────────────────────
// Same auth as every parent route and for the same unavoidable reason: a parent
// has no role and Postgres holds no parent→student link, so the Bearer token is
// verified here and linkage is resolved in the application layer against the
// admissions tables.

const CORS_METHODS = 'GET, OPTIONS';

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'), CORS_METHODS),
  });
}

export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get('origin'), CORS_METHODS);

  const ip = getClientIp(request);
  const ipRl = rateLimit({
    ip,
    scope: 'parent-v2',
    ipMax: 30,
    windowSecs: 60,
  });
  if (ipRl.limited) return tooManyRequests(ipRl.retryAfter, cors);

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

  const userRl = rateLimit({
    ip,
    userId: userData.user.id,
    scope: 'parent-v2',
    ipMax: 30,
    userMax: 20,
    windowSecs: 60,
  });
  if (userRl.limited) return tooManyRequests(userRl.retryAfter, cors);

  const students = await loadFilableStudents(service, email);

  // ⚠ The internal ids stay internal. `studentId`, `sectionStudentId` and
  // `sectionId` are all resolved server-side on every write, so sending them to
  // a browser buys nothing and invites a client to start passing them back.
  // `studentNumber` is the only identifier the API accepts (Hard Rule #4).
  return NextResponse.json(
    {
      students: students.map((s) => ({
        studentNumber: s.studentNumber,
        name: s.displayName,
        levelCode: s.levelCode,
        sectionName: s.sectionName,
        // Pre-joined so a picker does not have to decide how to punctuate it,
        // and so every surface says it the same way.
        className:
          s.levelCode && s.sectionName
            ? `${s.levelCode} ${s.sectionName}`
            : (s.sectionName ?? null),
      })),
    },
    { headers: cors }
  );
}
