import { type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { loadEffectiveAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  getCalendarEventsForTerm,
  getDedupedSchoolCalendarForTerm,
} from '@/lib/attendance/calendar';
import { getDailyForSection } from '@/lib/attendance/queries';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import { SCHEDULE_LABELS, type Schedule } from '@/lib/schemas/section';
import { getTeacherEmailMap } from '@/lib/auth/teacher-emails';
import { getStaffDisplayEntries } from '@/lib/auth/staff-list';
import {
  buildAttendanceSheetWorkbook,
  type AttendanceSheetExportInput,
} from '@/lib/attendance/sheet-export';
import type { AttendanceStatus, DayType } from '@/lib/schemas/attendance';

// GET /api/attendance/[sectionId]/export?term_id=…
//
// Streams the section attendance register as a .xlsx workbook.
//
// Access:
// - registrar | school_admin | superadmin: any section
// - teacher: only sections they FORM-ADVISE (teacher_assignments role =
//   'form_adviser') — matching the `is_adviser_for_section` RLS predicate on
//   attendance_daily and the same filter in `assertAdviserForSections`
//   (/api/attendance/daily) and /api/attendance/student-summary. A subject
//   teacher in the section is not enough: this streams the whole register.
// - every other teacher → 403

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  const { sectionId } = await params;
  const termId = new URL(req.url).searchParams.get('term_id');
  if (!termId)
    return new Response('Missing required ?term_id= parameter.', {
      status: 400,
    });

  // Gate: registrar+ OR the section's form adviser.
  // requireRole returns { user: { id, email }, role } on success,
  // or { error: NextResponse } on failure — so role lives at auth.role.
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
    'teacher',
  ]);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();

  if (auth.role === 'teacher') {
    const session = await getSessionUser();
    // Held OR actively covered — a substitute taking this class's register
    // needs to be able to print it. Uses the shared loader so cover is honoured
    // the same way it is on the write gate in /api/attendance/daily.
    //
    // NOTE: the adviser NAME printed on the workbook is resolved separately,
    // further down, and stays the regular adviser's. The export is a record of
    // the class, not of who pressed the button.
    const assignments = session?.id
      ? await loadEffectiveAssignmentsForUser(service, session.id)
      : [];
    const advises = assignments.some(
      (a) => a.role === 'form_adviser' && a.section_id === sectionId
    );
    if (!advises) {
      return new Response('You are not the form adviser for this class.', {
        status: 403,
      });
    }
  }

  // Section + level + AY.
  const { data: sectionRaw } = await service
    .from('sections')
    .select('id, name, academic_year_id, schedule, level:levels(code, label)')
    .eq('id', sectionId)
    .maybeSingle();
  if (!sectionRaw) return new Response('Section not found.', { status: 404 });
  const section = sectionRaw as {
    id: string;
    name: string;
    academic_year_id: string;
    schedule: string | null;
    level:
      | { code: string; label: string }
      | { code: string; label: string }[]
      | null;
  };
  const level = Array.isArray(section.level) ? section.level[0] : section.level;

  // Term.
  const { data: termRaw } = await service
    .from('terms')
    .select('id, label, term_number, start_date, end_date')
    .eq('id', termId)
    .maybeSingle();
  if (!termRaw) return new Response('Term not found.', { status: 404 });
  const term = termRaw as {
    id: string;
    label: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
  };
  if (!term.start_date || !term.end_date) {
    return new Response('Term has no start/end dates configured.', {
      status: 400,
    });
  }

  // Form adviser name.
  const { data: advisers } = await service
    .from('teacher_assignments')
    .select('teacher_user_id')
    .eq('section_id', sectionId)
    .eq('role', 'form_adviser')
    .limit(1);
  const adviserUserId = advisers?.[0]?.teacher_user_id ?? null;
  const [emailEntries, nameEntries] = await Promise.all([
    getTeacherEmailMap(),
    getStaffDisplayEntries(),
  ]);
  const adviserEmail = adviserUserId
    ? (new Map(emailEntries).get(adviserUserId) ?? null)
    : null;
  const formAdviser = adviserEmail
    ? (new Map(nameEntries).get(adviserEmail) ?? adviserEmail)
    : null;

  // Roster.
  const { data: enrolmentsRaw } = await service
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, enrollment_date, bus_no, classroom_officer_role, student:students(student_number, last_name, first_name, middle_name)'
    )
    .eq('section_id', sectionId)
    .order('index_number');

  // Calendar + events + daily in parallel.
  const levelType = levelTypeForAudienceLookup(level?.code ?? null);
  const [calendar, events, daily] = await Promise.all([
    getDedupedSchoolCalendarForTerm(termId, levelType),
    getCalendarEventsForTerm(termId, levelType ?? 'all'),
    getDailyForSection(sectionId, termId),
  ]);

  const calendarByDate = new Map<
    string,
    { dayType: DayType; label: string | null }
  >();
  for (const c of calendar)
    calendarByDate.set(c.date, { dayType: c.dayType, label: c.label });

  // Group daily marks by section_student_id.
  const marksByEnrolment = new Map<string, Map<string, AttendanceStatus>>();
  for (const d of daily) {
    const m =
      marksByEnrolment.get(d.sectionStudentId) ??
      new Map<string, AttendanceStatus>();
    m.set(d.date, d.status);
    marksByEnrolment.set(d.sectionStudentId, m);
  }

  type EnrRow = {
    id: string;
    index_number: number;
    enrollment_status: string;
    enrollment_date: string | null;
    bus_no: string | null;
    classroom_officer_role: string | null;
    student:
      | {
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }
      | Array<{
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }>
      | null;
  };

  const students: AttendanceSheetExportInput['students'] = (
    (enrolmentsRaw ?? []) as EnrRow[]
  ).map((e) => {
    const s = Array.isArray(e.student) ? e.student[0] : e.student;
    const fullName = s
      ? `${s.last_name}, ${s.first_name}${s.middle_name ? ' ' + s.middle_name : ''}`
      : '';
    return {
      indexNumber: e.index_number,
      fullName,
      busCare:
        [e.bus_no, e.classroom_officer_role].filter(Boolean).join(' / ') ||
        null,
      withdrawn: e.enrollment_status === 'withdrawn',
      enrollmentDate: e.enrollment_date ?? null,
      marksByDate: marksByEnrolment.get(e.id) ?? new Map(),
    };
  });

  const input: AttendanceSheetExportInput = {
    schoolName: 'HFSE INTERNATIONAL SCHOOL',
    sheetName: section.name,
    term: {
      label: term.label,
      termNumber: term.term_number,
      startDate: term.start_date,
      endDate: term.end_date,
    },
    courseLabel: level?.label ?? '',
    sectionName: section.name,
    formAdviser,
    scheduleLabel: section.schedule
      ? SCHEDULE_LABELS[section.schedule as Schedule]
      : null,
    calendarByDate,
    events,
    students,
  };

  const buffer = buildAttendanceSheetWorkbook(input);
  const sanitize = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_');
  const filename = `Attendance_${sanitize(section.name)}_${sanitize(term.label)}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
