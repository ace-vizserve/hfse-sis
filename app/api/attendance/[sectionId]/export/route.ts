import { type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { loadEffectiveAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import { isAdviserRole } from '@/lib/schemas/teacher-assignment';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  getCalendarEventsForSection,
  getDedupedSchoolCalendarForTerm,
} from '@/lib/attendance/calendar';
import { getDailyForSection, isMarked } from '@/lib/attendance/queries';
import { levelTypeForAudienceLookup, type LevelCode } from '@/lib/sis/levels';
import { SCHEDULE_LABELS, type Schedule } from '@/lib/schemas/section';
import { getTeacherEmailMap } from '@/lib/auth/teacher-emails';
import { getStaffDisplayEntries } from '@/lib/auth/staff-list';
import {
  buildAttendanceSheetWorkbook,
  buildAttendanceYearWorkbook,
  narrowSheetExport,
  SheetExportScopeError,
  sheetExportFilename,
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

//
// Optional narrowing (none given = the whole-term register, as before):
// - month=YYYY-MM     only that month's columns and summary; must be a month
//                     of the term
// - students=<id,…>   only those section_students rows; each must be in this
//                     section
// - scope=year        every term of the section's AY, one worksheet per term;
//                     term_id not needed, month not allowed

const MAX_STUDENT_IDS = 200;
const ID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  const { sectionId } = await params;
  const sp = new URL(req.url).searchParams;
  const termId = sp.get('term_id');
  const scope = sp.get('scope');
  const month = sp.get('month');
  const studentsParam = sp.get('students');

  if (scope !== null && scope !== 'year') {
    return new Response('?scope= can only be "year".', { status: 400 });
  }
  const yearScope = scope === 'year';
  if (!yearScope && !termId)
    return new Response('Missing required ?term_id= parameter.', {
      status: 400,
    });
  if (month !== null) {
    if (yearScope) {
      return new Response('?month= cannot be used with ?scope=year.', {
        status: 400,
      });
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return new Response('?month= must be YYYY-MM.', { status: 400 });
    }
  }
  let studentIds: string[] | null = null;
  if (studentsParam !== null) {
    studentIds = [
      ...new Set(
        studentsParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    ];
    if (studentIds.length === 0) {
      return new Response('?students= is empty.', { status: 400 });
    }
    if (studentIds.length > MAX_STUDENT_IDS) {
      return new Response('Too many students in ?students=.', { status: 400 });
    }
    if (!studentIds.every((id) => ID_RE.test(id))) {
      return new Response('?students= holds an id that is not valid.', {
        status: 400,
      });
    }
  }

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
    // isAdviserRole — a co-adviser advises the class too (migration 124). The
    // adviser NAME printed on the workbook is resolved separately below and
    // stays the adviser of record, which is the point of the note above.
    const advises = assignments.some(
      (a) => isAdviserRole(a.role) && a.section_id === sectionId
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
    .select(
      'id, name, academic_year_id, schedule, level:levels(code, label), academic_year:academic_years(ay_code)'
    )
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
    academic_year: { ay_code: string } | { ay_code: string }[] | null;
  };
  const level = Array.isArray(section.level) ? section.level[0] : section.level;
  const ay = Array.isArray(section.academic_year)
    ? section.academic_year[0]
    : section.academic_year;

  // Term(s). One term normally; every term of the section's AY for the year.
  type TermRow = {
    id: string;
    label: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
  };
  type DatedTerm = TermRow & { start_date: string; end_date: string };
  let terms: DatedTerm[];
  if (yearScope) {
    const { data: termsRaw } = await service
      .from('terms')
      .select('id, label, term_number, start_date, end_date')
      .eq('academic_year_id', section.academic_year_id)
      .order('term_number', { ascending: true });
    // A term with no dates has no register to print; it is left out rather
    // than failing the whole year.
    terms = ((termsRaw ?? []) as TermRow[]).filter((t): t is DatedTerm =>
      Boolean(t.start_date && t.end_date)
    );
  } else {
    const { data: termRaw } = await service
      .from('terms')
      .select('id, label, term_number, start_date, end_date')
      .eq('id', termId!)
      .maybeSingle();
    if (!termRaw) return new Response('Term not found.', { status: 404 });
    const term = termRaw as TermRow;
    if (!term.start_date || !term.end_date) {
      return new Response('Term has no start/end dates configured.', {
        status: 400,
      });
    }
    terms = [term as DatedTerm];
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

  const enrolments = (enrolmentsRaw ?? []) as EnrRow[];
  const levelType = levelTypeForAudienceLookup(level?.code ?? null);

  // One term's sheet input: calendar + events + daily in parallel.
  async function termInput(
    term: DatedTerm
  ): Promise<AttendanceSheetExportInput> {
    const [calendar, events, daily] = await Promise.all([
      getDedupedSchoolCalendarForTerm(term.id, levelType),
      getCalendarEventsForSection(
        term.id,
        (level?.code as LevelCode | null) ?? null,
        sectionId
      ),
      getDailyForSection(sectionId, term.id),
    ]);

    const calendarByDate = new Map<
      string,
      { dayType: DayType; label: string | null }
    >();
    for (const c of calendar)
      calendarByDate.set(c.date, { dayType: c.dayType, label: c.label });

    // Group daily marks by section_student_id.
    //
    // FILTERED HERE rather than widening this map to `AttendanceStatus | null`:
    // a cleared day (status null, migration 134) is NOT MARKED, and leaving its
    // date out of the map is precisely how the sheet already renders a day
    // nobody ever marked. `AttendanceSheetExportInput.marksByDate` is read as
    // `marksByDate.get(iso) ?? null`, a null prints an empty cell, and
    // `summarizeMarks` skips null when totalling — so an absent key and a null
    // value take the identical path. Excluding the row keeps ONE representation
    // of "no mark" instead of two that have to agree.
    const marksByEnrolment = new Map<string, Map<string, AttendanceStatus>>();
    for (const d of daily) {
      if (!isMarked(d)) continue;
      const m =
        marksByEnrolment.get(d.sectionStudentId) ??
        new Map<string, AttendanceStatus>();
      m.set(d.date, d.status);
      marksByEnrolment.set(d.sectionStudentId, m);
    }

    const students: AttendanceSheetExportInput['students'] = enrolments.map(
      (e) => {
        const s = Array.isArray(e.student) ? e.student[0] : e.student;
        const fullName = s
          ? `${s.last_name}, ${s.first_name}${s.middle_name ? ' ' + s.middle_name : ''}`
          : '';
        return {
          enrolmentId: e.id,
          indexNumber: e.index_number,
          fullName,
          busCare:
            [e.bus_no, e.classroom_officer_role].filter(Boolean).join(' / ') ||
            null,
          withdrawn: e.enrollment_status === 'withdrawn',
          enrollmentDate: e.enrollment_date ?? null,
          marksByDate: marksByEnrolment.get(e.id) ?? new Map(),
        };
      }
    );

    return {
      schoolName: 'HFSE INTERNATIONAL SCHOOL',
      // A year workbook holds one tab per term, so the tab is the term there.
      sheetName: yearScope ? term.label : section.name,
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
  }

  let inputs: AttendanceSheetExportInput[];
  try {
    inputs = (await Promise.all(terms.map(termInput))).map((input) =>
      narrowSheetExport(input, { month, studentIds })
    );
  } catch (err) {
    if (err instanceof SheetExportScopeError) {
      return new Response(err.message, { status: 400 });
    }
    throw err;
  }

  const buffer = yearScope
    ? buildAttendanceYearWorkbook(inputs)
    : buildAttendanceSheetWorkbook(inputs[0]);
  const filename = sheetExportFilename({
    levelCode: level?.code ?? null,
    sectionName: section.name,
    periodLabel: yearScope ? (ay?.ay_code ?? 'Year') : terms[0].label,
    month,
    studentCount: studentIds ? studentIds.length : null,
  });
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
