import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAllStudentsByParentEmail } from '@/lib/supabase/admissions';
import { getClientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { corsHeaders } from '@/lib/cors';

// GET /api/parent/v2/students
//
// Called by the admissions portal SPA. The parent authenticates via the
// shared Supabase project and passes their access_token as a Bearer header.
// This endpoint verifies the token, resolves parent→student linkage via
// admissions tables, then cross-references report_card_publications to return
// only students that have at least one currently-active publication window.
//
// CORS: reflects the portal origin from the allowlist with credentials — see
// lib/cors.ts (shared with the report-card route).

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  });
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin);

  // IP-based limit — checked before any DB work.
  const ip = getClientIp(request);
  const ipRl = rateLimit({ ip, scope: 'parent-v2', ipMax: 30, windowSecs: 60 });
  if (ipRl.limited) return tooManyRequests(ipRl.retryAfter, cors);

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

  // 2. Find all students linked to this parent email across all AYs.
  const admissionsRows = await getAllStudentsByParentEmail(email);
  if (admissionsRows.length === 0) {
    return NextResponse.json({ students: [] }, { headers: cors });
  }

  const studentNumbers = admissionsRows
    .map((r) => r.student_number)
    .filter(Boolean);

  // 3. Resolve student_numbers → grading students.
  const { data: studentRows } = await service
    .from('students')
    .select('id, student_number, last_name, first_name, middle_name')
    .in('student_number', studentNumbers);
  const students = (studentRows ?? []) as Array<{
    id: string;
    student_number: string;
    last_name: string;
    first_name: string;
    middle_name: string | null;
  }>;
  if (students.length === 0) {
    return NextResponse.json({ students: [] }, { headers: cors });
  }

  // 4. Find section enrolments for those students.
  const { data: enrolments } = await service
    .from('section_students')
    .select(
      'id, student_id, section:sections!inner(id, name, academic_year_id, level:levels(label))'
    )
    .in(
      'student_id',
      students.map((s) => s.id)
    );
  type EnrolRow = {
    id: string;
    student_id: string;
    section: {
      id: string;
      name: string;
      academic_year_id: string;
      level: { label: string } | { label: string }[] | null;
    } | null;
  };
  const enrs = ((enrolments ?? []) as unknown as EnrolRow[]).filter(
    (e) => !!e.section
  );

  // 5. Fetch AY codes + terms for section AYs.
  const ayIds = Array.from(
    new Set(enrs.map((e) => e.section!.academic_year_id))
  );
  const [ayRes, termRes] = await Promise.all([
    ayIds.length > 0
      ? service.from('academic_years').select('id, ay_code').in('id', ayIds)
      : Promise.resolve({ data: [] }),
    ayIds.length > 0
      ? service
          .from('terms')
          .select('id, term_number, label, academic_year_id')
          .in('academic_year_id', ayIds)
          .order('term_number')
      : Promise.resolve({ data: [] }),
  ]);
  const ayCodeById = new Map(
    ((ayRes.data ?? []) as Array<{ id: string; ay_code: string }>).map((r) => [
      r.id,
      r.ay_code,
    ])
  );
  const termLabelById = new Map(
    ((termRes.data ?? []) as Array<{ id: string; label: string }>).map((t) => [
      t.id,
      t.label,
    ])
  );

  // 6. Fetch publication windows for enrolled sections.
  const sectionIds = Array.from(new Set(enrs.map((e) => e.section!.id)));
  const { data: pubs } =
    sectionIds.length > 0
      ? await service
          .from('report_card_publications')
          .select('id, section_id, term_id, publish_from, publish_until')
          .in('section_id', sectionIds)
      : { data: [] };
  type PubRow = {
    id: string;
    section_id: string;
    term_id: string;
    publish_from: string;
    publish_until: string;
  };
  const pubRows = (pubs ?? []) as PubRow[];
  const now = Date.now();

  // 7. Build response — only students with at least one active publication.
  type StudentResult = {
    student_id: string;
    student_number: string;
    full_name: string;
    class_label: string;
    ay_code: string;
    publications: Array<{
      term_id: string;
      term_number: number | null;
      term_label: string;
      publish_from: string;
      publish_until: string;
    }>;
  };

  const termNumberById = new Map(
    ((termRes.data ?? []) as Array<{ id: string; term_number: number }>).map(
      (t) => [t.id, t.term_number]
    )
  );

  const result: StudentResult[] = students.flatMap((s) =>
    enrs
      .filter((e) => e.student_id === s.id)
      .flatMap((enr): StudentResult[] => {
        if (!enr.section) return [];
        const level = Array.isArray(enr.section.level)
          ? enr.section.level[0]
          : enr.section.level;
        const activePubs = pubRows
          .filter((p) => p.section_id === enr.section!.id)
          .filter((p) => {
            const from = new Date(p.publish_from).getTime();
            const until = new Date(p.publish_until).getTime();
            return now >= from && now <= until;
          })
          .map((p) => ({
            term_id: p.term_id,
            term_number: termNumberById.get(p.term_id) ?? null,
            term_label: termLabelById.get(p.term_id) ?? 'Term',
            publish_from: p.publish_from,
            publish_until: p.publish_until,
          }));
        if (activePubs.length === 0) return [];
        return [
          {
            student_id: s.id,
            student_number: s.student_number,
            full_name: [s.last_name, s.first_name, s.middle_name]
              .filter(Boolean)
              .join(', '),
            class_label: `${level?.label ?? ''} ${enr.section.name}`.trim(),
            ay_code: ayCodeById.get(enr.section.academic_year_id) ?? '',
            publications: activePubs,
          },
        ];
      })
  );

  return NextResponse.json({ students: result }, { headers: cors });
}
