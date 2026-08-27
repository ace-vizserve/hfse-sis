import { createServiceClient } from '@/lib/supabase/service';
import { getAllStudentsByParentEmail } from '@/lib/supabase/admissions';
import {
  DECLARATION_STATUS_LABELS,
  type DeclarationStatus,
  type DeclarationType,
} from '@/lib/schemas/declarations';

type Service = ReturnType<typeof createServiceClient>;

/**
 * Parent-side reads and writes for absence / travel declarations.
 *
 * ⚠ EVERYTHING HERE RUNS ON THE SERVICE CLIENT, and that is not a shortcut —
 * it is the only option. There is no parent→student link inside Postgres: a
 * parent is an `auth.users` row with NO role (`current_user_role()` is null),
 * and the link is an email match into the AY-prefixed admissions tables, which
 * no RLS policy can reach. So authorisation happens here, in the application
 * layer, exactly as `app/api/parent/v2/report-card/route.ts` does it. RLS on
 * `student_declarations` denies the parent everything, which is correct and is
 * why this file exists.
 *
 * The rule every function below obeys: **resolve the parent's own children
 * first, then never trust a student identifier from the request again.**
 */

/**
 * A child this parent may file for, resolved to the ids the write needs.
 *
 * ⚠ Keyed on `studentNumber`, never a uuid — Hard Rule #4, and it is what
 * `getAllStudentsByParentEmail` returns, so the membership test is a direct
 * comparison with nothing in between to get wrong.
 */
export type LinkedStudent = {
  studentNumber: string;
  studentId: string;
  sectionStudentId: string;
  sectionId: string;
  academicYearId: string;
  displayName: string;
  /** e.g. `P4` — for labelling a child in a picker, never for logic. */
  levelCode: string | null;
  /**
   * `primary` / `secondary`, from `levels.level_type`.
   *
   * ⚠ THIS ONE IS FOR LOGIC, unlike `levelCode` above. It routes the filing to
   * the right officer in charge — HFSE has one per half of the school
   * (migration 128) — so it is read from the school's own column rather than
   * inferred from a level code.
   */
  levelType: 'primary' | 'secondary' | 'preschool' | null;
  /** e.g. `Diligence`. Two children can share a first name; nobody shares a class as well. */
  sectionName: string | null;
};

/**
 * The parent's children, narrowed to those with a live enrolment we can attach
 * a declaration to.
 *
 * A child can be linked in admissions and still land nowhere here — an
 * applicant who never enrolled, or one whose enrolment was withdrawn. Callers
 * treat a missing student number as "not yours", deliberately: telling a
 * stranger whether a student number exists is its own small leak, and a parent
 * whose own child is missing is a support conversation, not a form error.
 */
export async function loadFilableStudents(
  service: Service,
  parentEmail: string
): Promise<LinkedStudent[]> {
  const linked = await getAllStudentsByParentEmail(parentEmail);
  const numbers = linked
    .map((r) => r.student_number)
    .filter((n): n is string => !!n);
  if (numbers.length === 0) return [];

  const { data: students, error: studentErr } = await service
    .from('students')
    .select('id, student_number, first_name, last_name')
    .in('student_number', numbers);
  if (studentErr) throw studentErr;

  const studentIds = (students ?? []).map((s) => s.id as string);
  if (studentIds.length === 0) return [];

  // The live enrolment. `is_current` on the academic year rather than a passed
  // AY code: a parent files against the year the school is actually running,
  // and giving the caller a choice here would let a request pick a closed year.
  const { data: enrolments, error: enrolErr } = await service
    .from('section_students')
    .select(
      'id, student_id, section_id, enrollment_status, sections!inner(id, name, academic_year_id, levels(code, level_type), academic_years!inner(is_current))'
    )
    .in('student_id', studentIds)
    .neq('enrollment_status', 'withdrawn')
    .eq('sections.academic_years.is_current', true);
  if (enrolErr) throw enrolErr;

  const byStudentId = new Map<
    string,
    { id: string; number: string; name: string }
  >(
    (students ?? []).map((s) => {
      const row = s as unknown as {
        id: string;
        student_number: string;
        first_name: string;
        last_name: string;
      };
      return [
        row.id,
        {
          id: row.id,
          number: row.student_number,
          name: `${row.first_name} ${row.last_name}`.trim(),
        },
      ];
    })
  );

  const out: LinkedStudent[] = [];
  for (const row of enrolments ?? []) {
    type SectionShape = {
      academic_year_id: string;
      name: string | null;
      levels:
        | { code: string; level_type: string }
        | { code: string; level_type: string }[]
        | null;
    };
    const r = row as unknown as {
      id: string;
      student_id: string;
      section_id: string;
      sections: SectionShape | SectionShape[];
    };
    const student = byStudentId.get(r.student_id);
    if (!student) continue;
    const section = Array.isArray(r.sections) ? r.sections[0] : r.sections;
    if (!section) continue;
    // PostgREST returns an embedded to-one as an object or a single-element
    // array depending on how it infers the relationship; both shapes appear in
    // this codebase, so normalise rather than assume.
    const level = Array.isArray(section.levels)
      ? section.levels[0]
      : section.levels;
    out.push({
      studentNumber: student.number,
      studentId: student.id,
      sectionStudentId: r.id,
      sectionId: r.section_id,
      academicYearId: section.academic_year_id,
      displayName: student.name,
      levelCode: level?.code ?? null,
      levelType:
        (level?.level_type as LinkedStudent['levelType'] | undefined) ?? null,
      sectionName: section.name ?? null,
    });
  }
  return out;
}

/**
 * What the parent sees in their list — the status tracker.
 *
 * ⚠ `parent_note` is returned (they wrote it) but `register_write_error` is
 * NOT. That column holds our internal failure text; a parent seeing "rollup RPC
 * failed" learns nothing and worries anyway. A declaration that was approved
 * but not yet encoded still reads "Approved", because from the parent's side it
 * is — the register is the school's problem, and the staff queue surfaces it.
 */
export type ParentDeclarationView = {
  id: string;
  filingGroupId: string;
  declarationType: DeclarationType;
  studentNumber: string;
  studentName: string;
  startDate: string;
  endDate: string;
  withMedical: boolean | null;
  evidenceUrl: string | null;
  hasUpload: boolean;
  destinationCountry: string | null;
  destinationCity: string | null;
  parentNote: string | null;
  status: DeclarationStatus;
  statusLabel: string;
  filedAt: string;
};

export async function listParentDeclarations(
  service: Service,
  opts: {
    students: LinkedStudent[];
    studentNumber?: string;
    status?: DeclarationStatus;
  }
): Promise<ParentDeclarationView[]> {
  const scoped = opts.studentNumber
    ? opts.students.filter((s) => s.studentNumber === opts.studentNumber)
    : opts.students;
  if (scoped.length === 0) return [];

  // ⚠ Scoped by the parent's OWN resolved student ids, not by `filed_by`.
  // Filing on `filed_by` alone would hide a declaration the other parent filed
  // for the same child — both parents are on the application and both should
  // see where it got to.
  const byStudentId = new Map(scoped.map((s) => [s.studentId, s]));
  let query = service
    .from('student_declarations')
    .select('*')
    .in('student_id', [...byStudentId.keys()])
    .order('created_at', { ascending: false });
  if (opts.status) query = query.eq('status', opts.status);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const student = byStudentId.get(r.student_id as string);
    const status = r.status as DeclarationStatus;
    return {
      id: r.id as string,
      filingGroupId: r.filing_group_id as string,
      declarationType: r.declaration_type as DeclarationType,
      studentNumber: student?.studentNumber ?? '',
      studentName: student?.displayName ?? '',
      startDate: r.start_date as string,
      endDate: r.end_date as string,
      withMedical: (r.with_medical as boolean | null) ?? null,
      evidenceUrl: (r.evidence_url as string | null) ?? null,
      hasUpload: Boolean(r.evidence_path),
      destinationCountry: (r.destination_country as string | null) ?? null,
      destinationCity: (r.destination_city as string | null) ?? null,
      parentNote: (r.parent_note as string | null) ?? null,
      status,
      statusLabel: DECLARATION_STATUS_LABELS[status],
      filedAt: r.created_at as string,
    };
  });
}
