import { createServiceClient } from '@/lib/supabase/service';

// Admissions lives in the SAME Supabase project as the grading schema,
// so we reuse the grading service-role client. Kept as a named helper so
// if the admissions instance is ever separated again, only this function
// needs to change. Server-only — never import from client components.
export function createAdmissionsClient() {
  return createServiceClient();
}

// Row shape returned from the admissions sync query.
// Source tables: ay{YY}_enrolment_applications joined to ay{YY}_enrolment_status.
export type AdmissionsRow = {
  student_number: string | null;
  last_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  class_level: string | null;   // e.g. "Primary One"
  class_section: string | null; // e.g. "Patience" (may contain known typos)
  class_ay: string | null;      // e.g. "AY2026"
};

// Fetch the full active roster for a given academic year from admissions.
// Filter rules (from docs/context/06-admissions-integration.md):
//   * classSection IS NOT NULL  (primary liveness signal — applicationStatus is unreliable)
//   * applicationStatus NOT IN ('Cancelled', 'Withdrawn')
export async function fetchAdmissionsRoster(ayCode: string): Promise<AdmissionsRow[]> {
  const year = ayCode.replace(/^AY/i, '').toLowerCase(); // "AY2026" → "2026"
  const appsTable = `ay${year}_enrolment_applications`;
  const statusTable = `ay${year}_enrolment_status`;

  const supabase = createAdmissionsClient();

  // No FK is declared between the two admissions tables, so we can't use
  // PostgREST embedded selects. Fetch both and join by enroleeNumber in JS.
  const [statusRes, appsRes] = await Promise.all([
    supabase
      .from(statusTable)
      .select('enroleeNumber, classLevel, classSection, classAY, applicationStatus')
      .not('classSection', 'is', null)
      .not('applicationStatus', 'in', '("Cancelled","Withdrawn")'),
    supabase
      .from(appsTable)
      .select('enroleeNumber, studentNumber, lastName, firstName, middleName'),
  ]);

  if (statusRes.error) throw new Error(`Admissions status fetch failed: ${statusRes.error.message}`);
  if (appsRes.error)   throw new Error(`Admissions apps fetch failed: ${appsRes.error.message}`);

  type AppRow = {
    enroleeNumber: string | null;
    studentNumber: string | null;
    lastName: string | null;
    firstName: string | null;
    middleName: string | null;
  };
  type StatusRow = {
    enroleeNumber: string | null;
    classLevel: string | null;
    classSection: string | null;
    classAY: string | null;
  };

  const apps = (appsRes.data ?? []) as AppRow[];
  const statuses = (statusRes.data ?? []) as StatusRow[];

  const appByEnrolee = new Map<string, AppRow>();
  for (const a of apps) {
    if (a.enroleeNumber) appByEnrolee.set(a.enroleeNumber, a);
  }

  const out: AdmissionsRow[] = [];
  for (const s of statuses) {
    if (!s.enroleeNumber) continue;
    const a = appByEnrolee.get(s.enroleeNumber);
    if (!a) continue;
    out.push({
      student_number: a.studentNumber,
      last_name: a.lastName,
      first_name: a.firstName,
      middle_name: a.middleName,
      class_level: s.classLevel,
      class_section: s.classSection,
      class_ay: s.classAY,
    });
  }
  return out;
}

// Resolve a grading section → unique parent email addresses via the admissions
// `ay{YY}_enrolment_applications.motherEmail/fatherEmail` columns.
//
// Flow:
//   1) Look up active (non-withdrawn) section_students + students.student_number
//      in the grading schema for the given section.
//   2) Query the admissions apps table for matching studentNumbers and pull
//      motherEmail + fatherEmail.
//   3) De-duplicate, drop nulls, lowercase for comparison.
//
// Used by the publication-notification hook — parents whose children are
// enrolled in the section receive one email when the registrar publishes.
export async function getParentEmailsForSection(
  sectionId: string,
  ayCode: string,
): Promise<string[]> {
  const supabase = createAdmissionsClient();

  // 1) active section members → student_number
  const { data: members, error: memErr } = await supabase
    .from('section_students')
    .select('student:students(student_number)')
    .eq('section_id', sectionId)
    .neq('enrollment_status', 'withdrawn');
  if (memErr) {
    console.error('[admissions] section members lookup failed:', memErr.message);
    return [];
  }
  type MemberRow = {
    student:
      | { student_number: string | null }
      | { student_number: string | null }[]
      | null;
  };
  const studentNumbers = ((members ?? []) as MemberRow[])
    .map((m) => (Array.isArray(m.student) ? m.student[0] : m.student))
    .map((s) => s?.student_number)
    .filter((n): n is string => !!n);
  if (studentNumbers.length === 0) return [];

  // 2) admissions apps → mother/father email
  const year = ayCode.replace(/^AY/i, '').toLowerCase();
  const appsTable = `ay${year}_enrolment_applications`;
  const { data: apps, error: appsErr } = await supabase
    .from(appsTable)
    .select('studentNumber, motherEmail, fatherEmail')
    .in('studentNumber', studentNumbers);
  if (appsErr) {
    console.error('[admissions] apps email lookup failed:', appsErr.message);
    return [];
  }
  type AppRow = {
    studentNumber: string | null;
    motherEmail: string | null;
    fatherEmail: string | null;
  };
  const seen = new Set<string>();
  for (const r of (apps ?? []) as AppRow[]) {
    for (const raw of [r.motherEmail, r.fatherEmail]) {
      if (!raw) continue;
      const norm = raw.trim().toLowerCase();
      if (!norm || !norm.includes('@')) continue;
      seen.add(norm);
    }
  }
  return Array.from(seen);
}

// Row shape returned when looking up a parent's children.
export type ParentStudentRow = {
  student_number: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  class_level: string | null;
  class_section: string | null;
};

// Find every student in a given academic year whose mother OR father email in
// `ay{YY}_enrolment_applications` matches the given email. Used by the parent
// landing page to resolve a signed-in parent's auth.users.email to their
// child/children in admissions. Service-role client — not subject to grading
// RLS and not visible to parent-side JS directly.
export async function getStudentsByParentEmail(
  email: string,
  ayCode: string,
): Promise<ParentStudentRow[]> {
  const trimmed = email.trim();
  if (!trimmed) return [];
  const year = ayCode.replace(/^AY/i, '').toLowerCase();
  const appsTable = `ay${year}_enrolment_applications`;
  const statusTable = `ay${year}_enrolment_status`;

  const supabase = createAdmissionsClient();

  // 1) Find enrolee rows whose parent emails match. Use `.ilike` so a parent
  //    who enrolled their child as "jane.smith@example.com" still matches
  //    when their Supabase Auth account was created as "Jane.Smith@Example.com".
  //    Emails are case-insensitive in practice; the admissions schema stores
  //    whatever the parent typed in the enrolment form.
  const { data: apps, error: appsErr } = await supabase
    .from(appsTable)
    .select('enroleeNumber, studentNumber, lastName, firstName, middleName, motherEmail, fatherEmail')
    .or(`motherEmail.ilike.${trimmed},fatherEmail.ilike.${trimmed}`);
  if (appsErr) {
    // Admissions schema drift or missing columns — fail soft so the parent
    // still gets a "no records found" page instead of a hard crash.
    console.error('[admissions] parent email lookup failed:', appsErr.message);
    return [];
  }
  type AppRow = {
    enroleeNumber: string | null;
    studentNumber: string | null;
    lastName: string | null;
    firstName: string | null;
    middleName: string | null;
    motherEmail: string | null;
    fatherEmail: string | null;
  };
  const rows = (apps ?? []) as AppRow[];
  const enroleeNumbers = rows.map((r) => r.enroleeNumber).filter((x): x is string => !!x);
  if (enroleeNumbers.length === 0) return [];

  // 2) Pull class info from status table for the same enrolees in this AY.
  const { data: statuses, error: statusErr } = await supabase
    .from(statusTable)
    .select('enroleeNumber, classLevel, classSection, applicationStatus')
    .in('enroleeNumber', enroleeNumbers)
    .not('classSection', 'is', null)
    .not('applicationStatus', 'in', '("Cancelled","Withdrawn")');
  if (statusErr) {
    console.error('[admissions] parent status lookup failed:', statusErr.message);
    return [];
  }
  type StatusRow = {
    enroleeNumber: string | null;
    classLevel: string | null;
    classSection: string | null;
  };
  const statusByEnrolee = new Map<string, StatusRow>();
  for (const s of (statuses ?? []) as StatusRow[]) {
    if (s.enroleeNumber) statusByEnrolee.set(s.enroleeNumber, s);
  }

  const out: ParentStudentRow[] = [];
  for (const r of rows) {
    if (!r.studentNumber || !r.enroleeNumber) continue;
    const s = statusByEnrolee.get(r.enroleeNumber);
    if (!s) continue; // not enrolled in this AY
    out.push({
      student_number: r.studentNumber,
      last_name: r.lastName ?? '',
      first_name: r.firstName ?? '',
      middle_name: r.middleName ?? null,
      class_level: s.classLevel,
      class_section: s.classSection,
    });
  }
  return out;
}

// Cross-AY parent → children resolver. Walks every academic_years row,
// runs the per-AY lookup against `ay{YY}_enrolment_applications`, and
// dedupes by student_number. Newer AYs win — if a student appears in
// both AY2026 and AY2027 admissions, the AY2027 row wins because we
// list AYs in descending ay_code order.
//
// Used by the parent dashboard so a parent can see report cards for
// any year their child is enrolled in, without the SIS having to know
// which AY is "current" — publication windows are the actual gate.
export async function getAllStudentsByParentEmail(
  email: string,
): Promise<ParentStudentRow[]> {
  const trimmed = email.trim();
  if (!trimmed) return [];

  const supabase = createAdmissionsClient();
  const { data: ays, error: ayErr } = await supabase
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  if (ayErr) {
    console.error('[admissions] cross-AY parent lookup: AY list failed:', ayErr.message);
    return [];
  }
  const ayCodes = ((ays ?? []) as Array<{ ay_code: string }>)
    .map((r) => r.ay_code)
    .filter((c): c is string => !!c);

  // Some AYs in the table may not yet have admissions tables created
  // (e.g. a freshly-flipped test AY). Each per-AY call already returns
  // [] on schema errors, so a missing-table case fails soft.
  const perAy = await Promise.all(
    ayCodes.map((ay) => getStudentsByParentEmail(trimmed, ay)),
  );

  const seen = new Map<string, ParentStudentRow>();
  for (const rows of perAy) {
    for (const r of rows) {
      if (r.student_number && !seen.has(r.student_number)) {
        seen.set(r.student_number, r);
      }
    }
  }
  return Array.from(seen.values());
}
