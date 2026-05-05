import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { buildReportCard } from '@/lib/report-card/build-report-card';

// GET /api/report-card/[studentId]
// Returns everything the report card template needs for a student in the
// current academic year. Reuses the shared `buildReportCard` query pipeline.
//
// Role: registrar / admin / superadmin.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { studentId } = await params;
  const service = createServiceClient();

  const result = await buildReportCard(service, studentId);

  if (!result.ok) {
    switch (result.error.kind) {
      case 'student_not_found':
        return NextResponse.json({ error: 'student not found' }, { status: 404 });
      case 'no_current_ay':
        return NextResponse.json({ error: 'no current academic year' }, { status: 500 });
      case 'not_enrolled_this_ay':
        return NextResponse.json(
          { error: `student has no enrolment in ${result.error.ayLabel}` },
          { status: 404 },
        );
      case 'level_not_found':
        return NextResponse.json({ error: 'section has no level' }, { status: 500 });
    }
  }

  const { payload } = result;

  // Reshape to a flat API-friendly format keyed by term_number
  const attendanceByTerm: Record<number, {
    school_days: number | null;
    days_present: number | null;
    days_late: number | null;
  }> = {};
  const commentsByTerm: Record<number, string | null> = {};

  for (const t of payload.terms) {
    const att = payload.attendance.find((a) => a.term_id === t.id);
    attendanceByTerm[t.term_number] = {
      school_days: att?.school_days ?? null,
      days_present: att?.days_present ?? null,
      days_late: att?.days_late ?? null,
    };
    const com = payload.comments.find((c) => c.term_id === t.id);
    commentsByTerm[t.term_number] = com?.comment ?? null;
  }

  return NextResponse.json({
    academic_year: { code: payload.ay.label, label: payload.ay.label },
    student: {
      id: payload.student.id,
      student_number: payload.student.student_number,
      last_name: payload.student.last_name,
      first_name: payload.student.first_name,
      middle_name: payload.student.middle_name,
    },
    section: payload.section,
    level: payload.level,
    enrollment_status: payload.enrollment_status,
    terms: payload.terms.map((t) => ({ term_number: t.term_number, label: t.label })),
    subject_rows: payload.subjects,
    attendance: attendanceByTerm,
    comments: commentsByTerm,
  });
}
