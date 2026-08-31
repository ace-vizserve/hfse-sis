import { unstable_cache } from 'next/cache';

import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPages } from '@/lib/supabase/paginate';

// Sprint 10 Phase 1 — read-only Student Information System.
//
// All reads go through the shared admissions Supabase project via the
// service-role client. Helpers are wrapped in `unstable_cache` with a
// 10-minute TTL and per-AY tags so we can invalidate when Phase 2 writes
// land. Mirrors `lib/admissions/dashboard.ts` style — same prefix derivation,
// same tag shape, same TTL.
//
// Key Decision #14 — never hardcode an AY; the caller passes the code,
// derived from `academic_years.is_current` or a URL param.
// Key Decision #22 — service-role only; client components must go through API.

const CACHE_TTL_SECONDS = 600;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

function tag(ayCode: string): string[] {
  return ['sis', `sis:${ayCode}`];
}

// ──────────────────────────────────────────────────────────────────────────
// Shared row shapes — explicit columns only, never select('*'). The
// applications table has 200+ fields; pulling all of them through the
// cache would explode memory and break the 10MB cache row limit.
// ──────────────────────────────────────────────────────────────────────────

export type StudentListRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  enroleeFullName: string | null;
  levelApplied: string | null;
  /** Country name as supplied on the application. Hidden column by default —
   *  shown/exported via the Columns menu (training action item #10). */
  nationality: string | null;
  classLevel: string | null;
  classSection: string | null;
  applicationStatus: string | null;
  applicationUpdatedDate: string | null;
  created_at: string | null;
  // Populated by Records pages only — joins section_students.enrollment_status
  // (active | late_enrollee | withdrawn). Undefined for all Admissions callers.
  enrollmentStatus?: string | null;
  // Per-section roll number (section_students.index_number). Only populated
  // by the Records student directory — null for Admissions callers and for
  // students with no active section row (unsynced / withdrawn-only).
  indexNumber?: number | null;
  /** House name + colour token, merged in by the page from `public.students` —
   * the admissions tables this row is otherwise built from know nothing about
   * it. Null when unassigned or not yet synced. */
  house?: string | null;
  houseColourToken?: string | null;
  // Terminal reason + notes — only present on Cancelled/Withdrawn rows.
  // Populated from _enrolment_status; undefined for non-terminal rows is
  // safe — callers only render these on the closed-applications page.
  applicationTerminalReason?: string | null;
  applicationTerminalNotes?: string | null;
  // Additional _enrolment_status fields — not rendered as on-screen columns
  // anywhere today. Reachable via the CSV export sheet's "Full record +
  // pipeline" preset (components/sis/student-data-table.tsx's
  // `csv.rawColumns` "status" source), not via `csv.extraColumns` (no
  // longer used on that table). The apps×status join already existed; this
  // just widens the status SELECT + merge to surface more of what's
  // already in that table.
  enroleeType: string | null;
  enrolmentDate: string | null;
  assessmentStatus: string | null;
  assessmentGradeMath: string | number | null;
  assessmentGradeEnglish: string | number | null;
  contractStatus: string | null;
  feeStatus: string | null;
  registrationStatus: string | null;
  // Added for the applications-table pipeline strip (KD-pending) — the 4
  // stage statuses not previously loaded, plus every stage's updatedDate
  // (applicationUpdatedDate already existed above). Per-stage last-updated
  // powers the strip's popover detail.
  documentStatus: string | null;
  classStatus: string | null;
  suppliesStatus: string | null;
  orientationStatus: string | null;
  registrationUpdateDate: string | null;
  documentUpdatedDate: string | null;
  assessmentUpdatedDate: string | null;
  contractUpdatedDate: string | null;
  feeUpdatedDate: string | null;
  classUpdatedDate: string | null;
  suppliesUpdatedDate: string | null;
  orientationUpdatedDate: string | null;
};

// `created_at` carries the application's submission timestamp (Supabase default
// column). Surfaced on StudentListRow so the admissions list can sort/show
// "newest first" client-side without a second round-trip.
// `nationality` is here for the Columns menu / CSV export, not for the
// default screen — the column ships hidden (KD #162: the Columns menu IS the
// export's field picker, so a field that is not a column cannot be exported
// without dumping all ~118 raw columns). Training action item #10, Samiksha.
const LIST_APP_COLUMNS =
  'enroleeNumber, studentNumber, firstName, middleName, lastName, enroleeFullName, levelApplied, nationality, created_at';
const LIST_STATUS_COLUMNS =
  'enroleeNumber, classLevel, classSection, applicationStatus, applicationUpdatedDate, "applicationTerminalReason", "applicationTerminalNotes", enroleeType, enrolmentDate, assessmentStatus, assessmentGradeMath, assessmentGradeEnglish, contractStatus, feeStatus, registrationStatus, documentStatus, classStatus, suppliesStatus, orientationStatus, registrationUpdateDate, documentUpdatedDate, assessmentUpdatedDate, contractUpdatedDate, feeUpdatedDate, classUpdatedDate, suppliesUpdatedDate, orientationUpdatedDate';

export type StudentListOrder = 'created_at_desc' | 'name_asc';

// Returns the joined applications × status shape for one AY. `orderBy` picks
// the SQL order — admissions wants newest applications first, records prefers
// alphabetical. `enroleeNumber` is the stable tiebreaker either way.
export async function listStudents(
  ayCode: string,
  orderBy: StudentListOrder = 'name_asc'
): Promise<StudentListRow[]> {
  return unstable_cache(
    async () => {
      const prefix = prefixFor(ayCode);
      const supabase = createAdmissionsClient();

      // fetchAllPages walks past the PostgREST 1000-row cap (M2). AYs with
      // > 1000 enrolled applicants silently truncated without this.
      const [appsData, statusData] = await Promise.all([
        fetchAllPages((from, to) => {
          const q = supabase
            .from(`${prefix}_enrolment_applications`)
            .select(LIST_APP_COLUMNS)
            .range(from, to);
          return orderBy === 'created_at_desc'
            ? q
                .order('created_at', { ascending: false })
                .order('enroleeNumber', { ascending: true })
            : q
                .order('lastName', { ascending: true })
                .order('firstName', { ascending: true })
                .order('enroleeNumber', { ascending: true });
        }),
        fetchAllPages((from, to) =>
          supabase
            .from(`${prefix}_enrolment_status`)
            .select(LIST_STATUS_COLUMNS)
            .range(from, to)
        ),
      ]);

      // Map to named Result shape to satisfy the downstream type checks
      const appsRes = { data: appsData, error: null };
      const statusRes = { data: statusData, error: null };

      if (appsRes.error) {
        console.error('[sis] listStudents apps fetch failed:', appsRes.error);
        return [];
      }
      if (statusRes.error) {
        console.error(
          '[sis] listStudents status fetch failed:',
          statusRes.error
        );
        return [];
      }

      type AppLite = {
        enroleeNumber: string | null;
        studentNumber: string | null;
        firstName: string | null;
        middleName: string | null;
        lastName: string | null;
        enroleeFullName: string | null;
        levelApplied: string | null;
        nationality: string | null;
        created_at: string | null;
      };
      type StatusLite = {
        enroleeNumber: string | null;
        classLevel: string | null;
        classSection: string | null;
        applicationStatus: string | null;
        applicationUpdatedDate: string | null;
        applicationTerminalReason: string | null;
        applicationTerminalNotes: string | null;
        enroleeType: string | null;
        enrolmentDate: string | null;
        assessmentStatus: string | null;
        assessmentGradeMath: string | number | null;
        assessmentGradeEnglish: string | number | null;
        contractStatus: string | null;
        feeStatus: string | null;
        registrationStatus: string | null;
        documentStatus: string | null;
        classStatus: string | null;
        suppliesStatus: string | null;
        orientationStatus: string | null;
        registrationUpdateDate: string | null;
        documentUpdatedDate: string | null;
        assessmentUpdatedDate: string | null;
        contractUpdatedDate: string | null;
        feeUpdatedDate: string | null;
        classUpdatedDate: string | null;
        suppliesUpdatedDate: string | null;
        orientationUpdatedDate: string | null;
      };

      const apps = (appsRes.data ?? []) as AppLite[];
      const statuses = (statusRes.data ?? []) as StatusLite[];

      const statusByEnrolee = new Map<string, StatusLite>();
      for (const s of statuses) {
        if (s.enroleeNumber) statusByEnrolee.set(s.enroleeNumber, s);
      }

      const out: StudentListRow[] = [];
      for (const a of apps) {
        if (!a.enroleeNumber) continue;
        const s = statusByEnrolee.get(a.enroleeNumber);
        out.push({
          enroleeNumber: a.enroleeNumber,
          studentNumber: a.studentNumber,
          firstName: a.firstName,
          middleName: a.middleName,
          lastName: a.lastName,
          enroleeFullName: a.enroleeFullName,
          levelApplied: a.levelApplied,
          nationality: a.nationality,
          classLevel: s?.classLevel ?? null,
          classSection: s?.classSection ?? null,
          applicationStatus: s?.applicationStatus ?? null,
          applicationUpdatedDate: s?.applicationUpdatedDate ?? null,
          created_at: a.created_at,
          applicationTerminalReason: s?.applicationTerminalReason ?? null,
          applicationTerminalNotes: s?.applicationTerminalNotes ?? null,
          enroleeType: s?.enroleeType ?? null,
          enrolmentDate: s?.enrolmentDate ?? null,
          assessmentStatus: s?.assessmentStatus ?? null,
          assessmentGradeMath: s?.assessmentGradeMath ?? null,
          assessmentGradeEnglish: s?.assessmentGradeEnglish ?? null,
          contractStatus: s?.contractStatus ?? null,
          feeStatus: s?.feeStatus ?? null,
          registrationStatus: s?.registrationStatus ?? null,
          documentStatus: s?.documentStatus ?? null,
          classStatus: s?.classStatus ?? null,
          suppliesStatus: s?.suppliesStatus ?? null,
          orientationStatus: s?.orientationStatus ?? null,
          registrationUpdateDate: s?.registrationUpdateDate ?? null,
          documentUpdatedDate: s?.documentUpdatedDate ?? null,
          assessmentUpdatedDate: s?.assessmentUpdatedDate ?? null,
          contractUpdatedDate: s?.contractUpdatedDate ?? null,
          feeUpdatedDate: s?.feeUpdatedDate ?? null,
          classUpdatedDate: s?.classUpdatedDate ?? null,
          suppliesUpdatedDate: s?.suppliesUpdatedDate ?? null,
          orientationUpdatedDate: s?.orientationUpdatedDate ?? null,
        });
      }
      return out;
    },
    ['sis', 'list-students', ayCode, orderBy],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS }
  )();
}

// Quick aggregate counts for the dashboard hero. Uses the same cached
// list as `listStudents` so we don't double-fetch.
export type SisDashboardSummary = {
  ayCode: string;
  totalStudents: number;
  enrolled: number;
  pending: number;
  withdrawn: number;
};

export async function getSisDashboardSummary(
  ayCode: string
): Promise<SisDashboardSummary> {
  const rows = await listStudents(ayCode, 'name_asc');
  let enrolled = 0;
  let pending = 0;
  let withdrawn = 0;
  for (const r of rows) {
    const s = (r.applicationStatus ?? '').trim();
    if (s === 'Enrolled' || s === 'Enrolled (Conditional)') enrolled += 1;
    else if (s === 'Withdrawn') withdrawn += 1;
    else if (s) pending += 1;
  }
  // KNOWN LIMITATION (Task 1 / KD #147): After the post-enrolment withdrawal
  // fix, a student who enrolled and then withdrew via Records keeps
  // applicationStatus='Enrolled' (the OUTCOME is preserved). This means:
  //   - `enrolled` counts them as enrolled (shows the admission outcome, not
  //     the current operational state).
  //   - `withdrawn` only counts pre-enrolment withdrawals.
  // For the authoritative "currently enrolled / currently withdrawn" count,
  // join section_students.enrollment_status instead. This dashboard summary
  // is a lightweight display-only function and this behaviour is acceptable
  // for v1 — the Records movements feed is the correct surface for tracking
  // operational withdrawal counts (KD #83).
  return {
    ayCode,
    totalStudents: rows.length,
    enrolled,
    pending,
    withdrawn,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Stubs for upcoming pages — filled in alongside the page they serve so the
// shape stays honest. Each stub returns a typed empty payload so callers
// compile and the page can render its empty state.
// ──────────────────────────────────────────────────────────────────────────

// Admissions row shapes — pulled with explicit column lists so we never
// accidentally exfiltrate the entire 200+ column applications row through
// the cache. Add a field here, add it to the SELECT — both must move together.

export type ApplicationRow = {
  // Identity
  enroleeNumber: string;
  studentNumber: string | null;
  enroleeFullName: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  preferredName: string | null;
  category: string | null;
  // Demographics
  nric: string | null;
  birthDay: string | null;
  gender: string | null;
  nationality: string | null;
  primaryLanguage: string | null;
  religion: string | null;
  religionOther: string | null;
  // Travel docs
  passportNumber: string | null;
  passportExpiry: string | null;
  pass: string | null;
  passExpiry: string | null;
  // Singapore ICA Student Pass workflow (KD #58 / docs/context/21-stp-application.md).
  // Gate field — when set, the parent has opted into the STP sub-flow and the
  // 3 STP-conditional doc slots (icaPhoto, financialSupportDocs,
  // vaccinationInformation) become surface-relevant. Typical value:
  // "New Student Pass Application". `residenceHistory` is jsonb of the past
  // 5 years of residency.
  stpApplicationType: string | null;
  // ICA Student Pass progress (migration 050). Co-located with
  // stpApplicationType — they're a single state machine bolted onto the
  // apps row. Values: 'Pending' | 'Submitted' | 'Approved' | 'Rejected'
  // (see STP_APPLICATION_STATUS_OPTIONS below). Replaces the old
  // 3-doc-slot model (icaPhoto / financialSupportDocs / vaccinationInformation).
  stpApplicationStatus: string | null;
  residenceHistory: unknown;
  // Contact
  homePhone: string | null;
  homeAddress: string | null;
  postalCode: string | null;
  livingWithWhom: string | null;
  contactPerson: string | null;
  contactPersonNumber: string | null;
  parentMaritalStatus: string | null;
  // Application preferences
  levelApplied: string | null;
  preferredSchedule: string | null;
  classType: string | null;
  paymentOption: string | null;
  // Parent-portal payment preference (see PREFERRED_PAYMENT_SCHEME_OPTIONS /
  // PREFERRED_PAYMENT_METHOD_OPTIONS in lib/schemas/sis.ts).
  preferredPaymentScheme: string | null;
  preferredPaymentMethod: string | null;
  // avail* fields — production DB stores 'Yes' / 'No' strings, not booleans.
  // Type widened to string | null to match real shape; the schema enforces the
  // 'Yes'|'No' enum on writes via lib/schemas/sis.ts::optionalYesNo.
  availSchoolBus: string | null;
  availStudentCare: string | null;
  studentCareProgram: string | null;
  availUniform: string | null;
  additionalLearningNeeds: string | null;
  otherLearningNeeds: string | null;
  previousSchool: string | null;
  howDidYouKnowAboutHFSEIS: string | null;
  otherSource: string | null;
  discount1: string | null;
  discount2: string | null;
  discount3: string | null;
  referrerName: string | null;
  referrerMobile: string | null;
  // The referral person's name when howDidYouKnowAboutHFSEIS === 'Referral'.
  marketingReferrerName: string | null;
  contractSignatory: string | null;
  // Family — father
  fatherFullName: string | null;
  fatherFirstName: string | null;
  fatherMiddleName: string | null;
  fatherLastName: string | null;
  fatherPreferredName: string | null;
  fatherNric: string | null;
  fatherBirthDay: string | null;
  fatherMobile: string | null;
  fatherEmail: string | null;
  fatherNationality: string | null;
  fatherReligion: string | null;
  fatherReligionOther: string | null;
  fatherMarital: string | null;
  fatherCompanyName: string | null;
  fatherPosition: string | null;
  fatherPassport: string | null;
  fatherPassportExpiry: string | null;
  fatherPass: string | null;
  fatherPassExpiry: string | null;
  fatherWhatsappTeamsConsent: boolean | null;
  // Family — mother
  motherFullName: string | null;
  motherFirstName: string | null;
  motherMiddleName: string | null;
  motherLastName: string | null;
  motherPreferredName: string | null;
  motherNric: string | null;
  motherBirthDay: string | null;
  motherMobile: string | null;
  motherEmail: string | null;
  motherNationality: string | null;
  motherReligion: string | null;
  motherReligionOther: string | null;
  motherMarital: string | null;
  motherCompanyName: string | null;
  motherPosition: string | null;
  motherPassport: string | null;
  motherPassportExpiry: string | null;
  motherPass: string | null;
  motherPassExpiry: string | null;
  motherWhatsappTeamsConsent: boolean | null;
  // Family — guardian
  guardianFullName: string | null;
  guardianFirstName: string | null;
  guardianMiddleName: string | null;
  guardianLastName: string | null;
  guardianPreferredName: string | null;
  guardianNric: string | null;
  guardianBirthDay: string | null;
  guardianMobile: string | null;
  guardianEmail: string | null;
  guardianNationality: string | null;
  guardianReligion: string | null;
  guardianReligionOther: string | null;
  guardianCompanyName: string | null;
  guardianPosition: string | null;
  guardianPassport: string | null;
  guardianPassportExpiry: string | null;
  guardianPass: string | null;
  guardianPassExpiry: string | null;
  guardianWhatsappTeamsConsent: boolean | null;
  // Siblings — 5 slots. Parent-portal-collected, not yet displayed anywhere
  // in the SIS prior to this addition.
  siblingFullName1: string | null;
  siblingBirthDay1: string | null;
  siblingReligion1: string | null;
  siblingEducationOccupation1: string | null;
  siblingSchoolCompany1: string | null;
  siblingFullName2: string | null;
  siblingBirthDay2: string | null;
  siblingReligion2: string | null;
  siblingEducationOccupation2: string | null;
  siblingSchoolCompany2: string | null;
  siblingFullName3: string | null;
  siblingBirthDay3: string | null;
  siblingReligion3: string | null;
  siblingEducationOccupation3: string | null;
  siblingSchoolCompany3: string | null;
  siblingFullName4: string | null;
  siblingBirthDay4: string | null;
  siblingReligion4: string | null;
  siblingEducationOccupation4: string | null;
  siblingSchoolCompany4: string | null;
  siblingFullName5: string | null;
  siblingBirthDay5: string | null;
  siblingReligion5: string | null;
  siblingEducationOccupation5: string | null;
  siblingSchoolCompany5: string | null;
  // Medical
  asthma: boolean | null;
  allergies: boolean | null;
  allergyDetails: string | null;
  foodAllergies: boolean | null;
  foodAllergyDetails: string | null;
  heartConditions: boolean | null;
  epilepsy: boolean | null;
  eczema: boolean | null;
  diabetes: boolean | null;
  paracetamolConsent: boolean | null;
  otherMedicalConditions: string | null;
  dietaryRestrictions: string | null;
  // Consents
  socialMediaConsent: boolean | null;
  feedbackConsent: boolean | null;
  // System
  created_at: string | null;
};

const DETAIL_APP_COLUMNS = [
  'enroleeNumber',
  'studentNumber',
  'enroleeFullName',
  'firstName',
  'middleName',
  'lastName',
  'preferredName',
  'category',
  'nric',
  'birthDay',
  'gender',
  'nationality',
  'primaryLanguage',
  'religion',
  'religionOther',
  'passportNumber',
  'passportExpiry',
  'pass',
  'passExpiry',
  'stpApplicationType',
  'stpApplicationStatus',
  'residenceHistory',
  'homePhone',
  'homeAddress',
  'postalCode',
  'livingWithWhom',
  'contactPerson',
  'contactPersonNumber',
  'parentMaritalStatus',
  'levelApplied',
  'preferredSchedule',
  'classType',
  'paymentOption',
  'preferredPaymentScheme',
  'preferredPaymentMethod',
  'availSchoolBus',
  'availStudentCare',
  'studentCareProgram',
  'availUniform',
  'additionalLearningNeeds',
  'otherLearningNeeds',
  'previousSchool',
  'howDidYouKnowAboutHFSEIS',
  'otherSource',
  'discount1',
  'discount2',
  'discount3',
  'referrerName',
  'referrerMobile',
  'marketingReferrerName',
  'contractSignatory',
  'fatherFullName',
  'fatherFirstName',
  'fatherMiddleName',
  'fatherLastName',
  'fatherPreferredName',
  'fatherNric',
  'fatherBirthDay',
  'fatherMobile',
  'fatherEmail',
  'fatherNationality',
  'fatherReligion',
  'fatherReligionOther',
  'fatherMarital',
  'fatherCompanyName',
  'fatherPosition',
  'fatherPassport',
  'fatherPassportExpiry',
  'fatherPass',
  'fatherPassExpiry',
  'fatherWhatsappTeamsConsent',
  'motherFullName',
  'motherFirstName',
  'motherMiddleName',
  'motherLastName',
  'motherPreferredName',
  'motherNric',
  'motherBirthDay',
  'motherMobile',
  'motherEmail',
  'motherNationality',
  'motherReligion',
  'motherReligionOther',
  'motherMarital',
  'motherCompanyName',
  'motherPosition',
  'motherPassport',
  'motherPassportExpiry',
  'motherPass',
  'motherPassExpiry',
  'motherWhatsappTeamsConsent',
  'guardianFullName',
  'guardianFirstName',
  'guardianMiddleName',
  'guardianLastName',
  'guardianPreferredName',
  'guardianNric',
  'guardianBirthDay',
  'guardianMobile',
  'guardianEmail',
  'guardianNationality',
  'guardianReligion',
  'guardianReligionOther',
  'guardianCompanyName',
  'guardianPosition',
  'guardianPassport',
  'guardianPassportExpiry',
  'guardianPass',
  'guardianPassExpiry',
  'guardianWhatsappTeamsConsent',
  'siblingFullName1',
  'siblingBirthDay1',
  'siblingReligion1',
  'siblingEducationOccupation1',
  'siblingSchoolCompany1',
  'siblingFullName2',
  'siblingBirthDay2',
  'siblingReligion2',
  'siblingEducationOccupation2',
  'siblingSchoolCompany2',
  'siblingFullName3',
  'siblingBirthDay3',
  'siblingReligion3',
  'siblingEducationOccupation3',
  'siblingSchoolCompany3',
  'siblingFullName4',
  'siblingBirthDay4',
  'siblingReligion4',
  'siblingEducationOccupation4',
  'siblingSchoolCompany4',
  'siblingFullName5',
  'siblingBirthDay5',
  'siblingReligion5',
  'siblingEducationOccupation5',
  'siblingSchoolCompany5',
  'asthma',
  'allergies',
  'allergyDetails',
  'foodAllergies',
  'foodAllergyDetails',
  'heartConditions',
  'epilepsy',
  'eczema',
  'diabetes',
  'paracetamolConsent',
  'otherMedicalConditions',
  'dietaryRestrictions',
  'socialMediaConsent',
  'feedbackConsent',
  'created_at',
].join(', ');

export type StatusRow = {
  enroleeNumber: string;
  enroleeType: string | null;
  enrolmentDate: string | null;
  applicationStatus: string | null;
  applicationRemarks: string | null;
  applicationUpdatedDate: string | null;
  applicationUpdatedBy: string | null;
  registrationStatus: string | null;
  registrationInvoice: string | null;
  registrationPaymentDate: string | null;
  registrationRemarks: string | null;
  registrationUpdatedDate: string | null;
  registrationUpdatedBy: string | null;
  documentStatus: string | null;
  documentRemarks: string | null;
  documentUpdatedDate: string | null;
  documentUpdatedBy: string | null;
  assessmentStatus: string | null;
  assessmentSchedule: string | null;
  assessmentGradeMath: string | number | null;
  assessmentGradeEnglish: string | number | null;
  assessmentMedical: string | null;
  assessmentRemarks: string | null;
  assessmentUpdatedDate: string | null;
  assessmentUpdatedBy: string | null;
  contractStatus: string | null;
  contractRemarks: string | null;
  contractUpdatedDate: string | null;
  contractUpdatedBy: string | null;
  feeStatus: string | null;
  feeInvoice: string | null;
  feePaymentDate: string | null;
  feeStartDate: string | null;
  feeRemarks: string | null;
  feeUpdatedDate: string | null;
  feeUpdatedBy: string | null;
  classStatus: string | null;
  classAY: string | null;
  classLevel: string | null;
  classSection: string | null;
  classRemarks: string | null;
  classUpdatedDate: string | null;
  classUpdatedBy: string | null;
  suppliesStatus: string | null;
  suppliesClaimedDate: string | null;
  suppliesRemarks: string | null;
  suppliesUpdatedDate: string | null;
  suppliesUpdatedBy: string | null;
  orientationStatus: string | null;
  orientationScheduleDate: string | null;
  orientationRemarks: string | null;
  orientationUpdatedDate: string | null;
  orientationUpdatedBy: string | null;
};

// PostgREST `select=` aliases let us keep clean camelCase field names on
// StatusRow (e.g. `registrationUpdatedBy`) while pulling from the actual
// production column names, which are inconsistent per the parent-portal
// frozen schema (`registrationUpdateDate` missing a "d",
// `registrationUpdatedby` lowercase "b", `orientationUpdateby` missing both).
// Every entry with a colon is `ts_alias:actual_db_column`. Do not "fix" the
// rhs — it matches what's in `ay{YYYY}_enrolment_status` per
// docs/context/10a-parent-portal-ddl.md.
const DETAIL_STATUS_COLUMNS = [
  'enroleeNumber',
  'enroleeType',
  'enrolmentDate',
  'applicationStatus',
  'applicationRemarks',
  'applicationUpdatedDate',
  'applicationUpdatedBy',
  'registrationStatus',
  'registrationInvoice',
  'registrationPaymentDate',
  'registrationRemarks',
  'registrationUpdatedDate:registrationUpdateDate',
  'registrationUpdatedBy:registrationUpdatedby',
  'documentStatus',
  'documentRemarks',
  'documentUpdatedDate',
  'documentUpdatedBy:documentUpdatedby',
  'assessmentStatus',
  'assessmentSchedule',
  'assessmentGradeMath',
  'assessmentGradeEnglish',
  'assessmentMedical',
  'assessmentRemarks',
  'assessmentUpdatedDate',
  'assessmentUpdatedBy:assessmentUpdatedby',
  'contractStatus',
  'contractRemarks',
  'contractUpdatedDate',
  'contractUpdatedBy:contractUpdatedby',
  'feeStatus',
  'feeInvoice',
  'feePaymentDate',
  'feeStartDate',
  'feeRemarks',
  'feeUpdatedDate',
  'feeUpdatedBy:feeUpdatedby',
  'classStatus',
  'classAY',
  'classLevel',
  'classSection',
  'classRemarks',
  'classUpdatedDate',
  'classUpdatedBy:classUpdatedby',
  'suppliesStatus',
  'suppliesClaimedDate',
  'suppliesRemarks',
  'suppliesUpdatedDate',
  'suppliesUpdatedBy:suppliesUpdatedby',
  'orientationStatus',
  'orientationScheduleDate',
  'orientationRemarks',
  'orientationUpdatedDate',
  'orientationUpdatedBy:orientationUpdateby',
].join(', ');

export type DocumentSlot = {
  key: string;
  label: string;
  url: string | null;
  status: string | null;
  expiry: string | null;
};

export const DOCUMENT_SLOTS: Array<{
  key: string;
  label: string;
  statusCol: string;
  urlCol: string;
  expiryCol?: string;
}> = [
  {
    key: 'idPicture',
    label: 'ID Picture',
    statusCol: 'idPictureStatus',
    urlCol: 'idPicture',
  },
  {
    key: 'birthCert',
    label: 'Birth Certificate',
    statusCol: 'birthCertStatus',
    urlCol: 'birthCert',
  },
  {
    key: 'educCert',
    label: 'Education Certificate',
    statusCol: 'educCertStatus',
    urlCol: 'educCert',
  },
  {
    key: 'medical',
    label: 'Medical Exam',
    statusCol: 'medicalStatus',
    urlCol: 'medical',
  },
  {
    key: 'form12',
    label: 'Form 12',
    statusCol: 'form12Status',
    urlCol: 'form12',
  },
  {
    key: 'lastSchoolRecommendation',
    label: 'Last School Recommendation and Good Moral',
    statusCol: 'lastSchoolRecommendationStatus',
    urlCol: 'lastSchoolRecommendation',
  },
  {
    key: 'assessmentResult',
    label: 'Assessment Result and Interview',
    statusCol: 'assessmentResultStatus',
    urlCol: 'assessmentResult',
  },
  {
    key: 'signedContract',
    label: 'Signed Student Contract',
    statusCol: 'signedContractStatus',
    urlCol: 'signedContract',
  },
  {
    key: 'newStudentChecksheet',
    label: 'New Student Checksheet',
    statusCol: 'newStudentChecksheetStatus',
    urlCol: 'newStudentChecksheet',
  },
  {
    key: 'pfilesChecklist',
    label: 'Student P-Files Checklist',
    statusCol: 'pfilesChecklistStatus',
    urlCol: 'pfilesChecklist',
  },
  {
    key: 'preCounsellingAck',
    label: 'Pre-Counselling Acknowledgement Form',
    statusCol: 'preCounsellingAckStatus',
    urlCol: 'preCounsellingAck',
  },
  {
    key: 'conditionalEnrolment',
    label: 'Conditional Enrolment',
    statusCol: 'conditionalEnrolmentStatus',
    urlCol: 'conditionalEnrolment',
  },
  {
    key: 'lateEnrolmentForm',
    label: 'Late Enrolment Form',
    statusCol: 'lateEnrolmentFormStatus',
    urlCol: 'lateEnrolmentForm',
  },
  {
    key: 'passport',
    label: 'Student Passport',
    statusCol: 'passportStatus',
    urlCol: 'passport',
    expiryCol: 'passportExpiry',
  },
  {
    key: 'pass',
    label: 'Student Pass',
    statusCol: 'passStatus',
    urlCol: 'pass',
    expiryCol: 'passExpiry',
  },
  {
    key: 'motherPassport',
    label: 'Mother Passport',
    statusCol: 'motherPassportStatus',
    urlCol: 'motherPassport',
    expiryCol: 'motherPassportExpiry',
  },
  {
    key: 'motherPass',
    label: 'Mother Pass',
    statusCol: 'motherPassStatus',
    urlCol: 'motherPass',
    expiryCol: 'motherPassExpiry',
  },
  {
    key: 'fatherPassport',
    label: 'Father Passport',
    statusCol: 'fatherPassportStatus',
    urlCol: 'fatherPassport',
    expiryCol: 'fatherPassportExpiry',
  },
  {
    key: 'fatherPass',
    label: 'Father Pass',
    statusCol: 'fatherPassStatus',
    urlCol: 'fatherPass',
    expiryCol: 'fatherPassExpiry',
  },
  {
    key: 'guardianPassport',
    label: 'Guardian Passport',
    statusCol: 'guardianPassportStatus',
    urlCol: 'guardianPassport',
    expiryCol: 'guardianPassportExpiry',
  },
  {
    key: 'guardianPass',
    label: 'Guardian Pass',
    statusCol: 'guardianPassStatus',
    urlCol: 'guardianPass',
    expiryCol: 'guardianPassExpiry',
  },
  // STP slots (icaPhoto / financialSupportDocs / vaccinationInformation)
  // removed from the enrollment process — parents upload these directly to
  // ICA's portal (migration 050). The underlying columns stay on the
  // `ay{YY}_enrolment_documents` schema for historical preservation but
  // are no longer enumerated here, so the seeder / UI / gates skip them
  // naturally. STP progress is tracked on `ay{YY}_enrolment_status.stpApplicationStatus`
  // via `STP_APPLICATION_STATUS_OPTIONS` below.
];

// Retained as an empty tuple for back-compat with consumers that still
// import the symbol (most do `.has()` / `.includes()` checks that fold
// to false naturally). New code should not reference this — STP no
// longer maps to document slots. See `STP_APPLICATION_STATUS_OPTIONS`.
export const STP_CONDITIONAL_SLOT_KEYS = [] as const;

// stpApplicationStatus enum on `ay{YY}_enrolment_status` (migration 050).
// Tracks the parent's ICA Student Pass application progress — the school
// records which phase they're in; ICA owns the actual document collection.
//   Pending   — parent hasn't filed with ICA yet (initial state once the
//               applications row has stpApplicationType set).
//   Submitted — parent has filed the application with ICA.
//   Approved  — ICA has issued the pass.
//   Rejected  — ICA declined the application.
export const STP_APPLICATION_STATUS_OPTIONS = [
  'Pending',
  'Submitted',
  'Approved',
  'Rejected',
] as const;
export type StpApplicationStatus =
  (typeof STP_APPLICATION_STATUS_OPTIONS)[number];

// Slots that are NEVER required for the documents-stage Verified / Finished
// gate, regardless of student type. Medical, educCert, and form12 are
// admissions-side optional — the student can be enrolled without them and
// the registrar can chase them up post-enrolment without blocking the
// workflow.
export const OPTIONAL_DOCUMENT_SLOT_KEYS = [
  'medical',
  'educCert',
  'form12',
  // The eight slots added alongside migration 135. None of them has been
  // agreed with the school as something that must be on file before a
  // student can be enrolled — they are places to keep a document, not a
  // requirement. Leaving them off this list would make all eight blocking
  // the moment they ship, and since every existing student's columns start
  // empty, the admissions team could no longer flip Documents to Verified
  // for anybody in the system. If the school later says one of these really
  // is required, remove that one key here — deliberately, not by omission.
  'lastSchoolRecommendation',
  'assessmentResult',
  'signedContract',
  'newStudentChecksheet',
  'pfilesChecklist',
  'preCounsellingAck',
  'conditionalEnrolment',
  'lateEnrolmentForm',
] as const;

const DOCUMENT_COLUMNS = [
  'enroleeNumber',
  'studentNumber',
  ...DOCUMENT_SLOTS.flatMap(
    (s) => [s.statusCol, s.urlCol, s.expiryCol].filter(Boolean) as string[]
  ),
].join(', ');

export type StudentDetail = {
  ayCode: string;
  enroleeNumber: string;
  application: ApplicationRow;
  status: StatusRow | null;
  documents: DocumentSlot[];
  // true when the status-row lookup returned a PostgREST error (typically
  // duplicate rows — `_status.enroleeNumber` has no unique constraint in the
  // DDL, so >1 row makes `maybeSingle` fail). Surfaced in the UI so we don't
  // paint a misleading "pipeline not started" dead end for real, populated
  // enrolees whose status row just happens to be duplicated.
  statusFetchError: boolean;
  docsFetchError: boolean;
};

// Columns guaranteed to exist on every historical `ay{YYYY}_enrolment_applications`
// table across the parent portal's schema evolution. Used as the fallback
// select when the full DETAIL_APP_COLUMNS query errors on a legacy AY that's
// missing newer columns (e.g. `classType`, `paymentOption`, `contractSignatory`
// were added later). Keeps the admissions detail page renderable with basic
// identity data instead of 404ing.
const MINIMAL_APP_COLUMNS =
  'enroleeNumber, studentNumber, firstName, middleName, lastName, enroleeFullName, levelApplied';

/**
 * Columns the parent portal stores as NUMBERS while every consumer here treats
 * them as text. Measured 2026-08-10 against `ay2026_enrolment_applications`:
 * `motherMobile` is a `number` on 498 of 498 rows; `fatherMobile` (474),
 * `guardianMobile` (120) and `contactPersonNumber` (498) likewise.
 *
 * `postalCode`, `homePhone` and `referrerMobile` are on the list defensively —
 * same portal, same shape, and the cost of coercing a value that was already a
 * string is nil.
 */
const NUMERIC_TEXT_COLUMNS = [
  'motherMobile',
  'fatherMobile',
  'guardianMobile',
  'contactPersonNumber',
  'homePhone',
  'referrerMobile',
  'postalCode',
] as const;

/**
 * Make the row match the type that describes it.
 *
 * WHY THIS EXISTS. `ApplicationRow` types these columns as `string | null`, and
 * the raw cast below used to hand a caller a `number` while promising a string.
 * Two things broke on that: the Classroom drawer threw
 * `value.toLowerCase is not a function` for every student, and — quieter and
 * worse — both SIS edit sheets carried the number back to the server on save,
 * where the zod schemas rejected it and 400'd the WHOLE form, so a registrar
 * editing a preferred name lost the edit over a field they never touched.
 *
 * Coercing here fixes it at the boundary, once, for every consumer. The write
 * schemas were also made number-tolerant (`coerceToText` in lib/schemas/sis.ts)
 * — belt and braces on purpose, because a second writer could always reach
 * these columns without passing through this function.
 */
export function normaliseApplicationRow(
  raw: Record<string, unknown>
): ApplicationRow {
  const out = { ...raw };
  for (const key of NUMERIC_TEXT_COLUMNS) {
    if (typeof out[key] === 'number') out[key] = String(out[key]);
  }
  return out as unknown as ApplicationRow;
}

export async function getStudentDetail(
  ayCode: string,
  enroleeNumber: string
): Promise<StudentDetail | null> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  const [appRes, statusRes, docsRes] = await Promise.all([
    supabase
      .from(`${prefix}_enrolment_applications`)
      .select(DETAIL_APP_COLUMNS)
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle(),
    supabase
      .from(`${prefix}_enrolment_status`)
      .select(DETAIL_STATUS_COLUMNS)
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle(),
    supabase
      .from(`${prefix}_enrolment_documents`)
      .select(DOCUMENT_COLUMNS)
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle(),
  ]);

  // App-row fallback: if the full SELECT errored (typically because the
  // historical AY's table lacks columns that were added in a later schema
  // version), retry with only the always-present minimal columns so the
  // page still renders with identity data. The specific column-not-found
  // error is logged so an operator can ALTER TABLE to add missing cols.
  let appData: unknown = appRes.error ? null : appRes.data;
  if (appRes.error) {
    console.warn(
      '[sis] getStudentDetail full apps select failed, retrying minimal:',
      appRes.error.message
    );
    const fallback = await supabase
      .from(`${prefix}_enrolment_applications`)
      .select(MINIMAL_APP_COLUMNS)
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
    if (fallback.error) {
      console.error(
        '[sis] getStudentDetail minimal apps select also failed:',
        fallback.error.message
      );
      return null;
    }
    appData = fallback.data;
  }
  if (!appData) return null;

  // Don't swallow status/docs errors — they typically mean duplicate rows
  // (enroleeNumber isn't unique on `_status` / `_documents` per migration 025).
  // The page still needs the applications row to render, so we keep going and
  // surface the error via the two flags on StudentDetail.
  const statusFetchError =
    statusRes.error !== null && statusRes.error !== undefined;
  const docsFetchError = docsRes.error !== null && docsRes.error !== undefined;
  // console.warn, not console.error — Next.js 16's dev overlay surfaces
  // console.error as a full runtime-error modal. The page still renders
  // (timeline shows null markers + amber alert), so this is a recoverable
  // data-quality issue, not a crash.
  if (statusFetchError) {
    console.warn(
      '[sis] getStudentDetail status fetch failed:',
      statusRes.error?.message
    );
  }
  if (docsFetchError) {
    console.warn(
      '[sis] getStudentDetail documents fetch failed:',
      docsRes.error?.message
    );
  }

  const app = normaliseApplicationRow(
    appData as unknown as Record<string, unknown>
  );
  const status = (statusRes.data ?? null) as StatusRow | null;
  const docsRow = (docsRes.data ?? null) as Record<string, unknown> | null;

  const documents: DocumentSlot[] = DOCUMENT_SLOTS.map((slot) => ({
    key: slot.key,
    label: slot.label,
    url: (docsRow?.[slot.urlCol] as string | null) ?? null,
    status: (docsRow?.[slot.statusCol] as string | null) ?? null,
    expiry: slot.expiryCol
      ? ((docsRow?.[slot.expiryCol] as string | null) ?? null)
      : null,
  }));

  return {
    ayCode,
    enroleeNumber,
    application: app,
    status,
    documents,
    statusFetchError,
    docsFetchError,
  };
}

export type CrossAyMatch = {
  ayCode: string;
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  level: string | null;
  section: string | null;
  status: string | null;
};

/**
 * Union + dedupe the per-column search result lists (first occurrence wins,
 * keyed by enroleeNumber; rows without one are dropped), then sort newest
 * application first and cap. Pure — exported for unit testing; the DB-side
 * `.or()` this replaces did the ordering/limit in one query, so this is the
 * client-side equivalent over the per-column `.ilike()` result lists.
 */
export function mergeSearchHits<
  T extends { enroleeNumber: string | null; created_at?: string | null },
>(lists: T[][], limit: number): T[] {
  const byEnrolee = new Map<string, T>();
  for (const list of lists) {
    for (const row of list) {
      if (row.enroleeNumber && !byEnrolee.has(row.enroleeNumber)) {
        byEnrolee.set(row.enroleeNumber, row);
      }
    }
  }
  return Array.from(byEnrolee.values())
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, limit);
}

export async function searchStudentsAcrossAY(
  query: string
): Promise<CrossAyMatch[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const supabase = createAdmissionsClient();

  // 1) Pull every active AY code from academic_years (sorted desc so the most
  //    recent matches surface first).
  const { data: ays, error: ayErr } = await supabase
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  if (ayErr) {
    console.error(
      '[sis] searchStudentsAcrossAY academic_years lookup failed:',
      ayErr.message
    );
    return [];
  }
  const ayCodes = ((ays ?? []) as { ay_code: string }[]).map((a) => a.ay_code);

  // 2) For each AY, query the apps + status tables in parallel. Bail on per-AY
  //    failures so a single missing table doesn't kill the whole search.
  //
  //    One `.ilike()` call per searched column, unioned + deduped via
  //    mergeSearchHits below — NOT a single `.or()` with the query spliced
  //    into the raw filter string. `.or()`'s argument is a PostgREST DSL
  //    where `,` and `(`/`)` are grammar — a search like "Tan, Wei Ming"
  //    corrupted the condition list and silently returned no matches.
  //    `.ilike('col', pattern)` passes the pattern as a parameterized filter
  //    value, so only genuine ILIKE wildcards matter — and the user's own
  //    literal `%`/`_` are escaped below (unchanged search semantics).
  const escaped = trimmed.replace(/[%_]/g, (m) => `\\${m}`);
  const pattern = `%${escaped}%`;
  const SEARCH_COLUMNS = [
    'enroleeNumber',
    'studentNumber',
    'enroleeFullName',
    'firstName',
    'lastName',
  ] as const;

  type AppHit = {
    enroleeNumber: string | null;
    studentNumber: string | null;
    enroleeFullName: string | null;
    firstName: string | null;
    lastName: string | null;
    middleName: string | null;
    created_at: string | null;
  };

  const perAyPromises = ayCodes.map(async (ayCode) => {
    const prefix = prefixFor(ayCode);
    const appsSelect =
      'enroleeNumber, studentNumber, enroleeFullName, firstName, lastName, middleName, created_at';
    const perColumn = await Promise.all(
      SEARCH_COLUMNS.map((col) =>
        supabase
          .from(`${prefix}_enrolment_applications`)
          .select(appsSelect)
          .ilike(col, pattern)
          .order('created_at', { ascending: false })
          .limit(20)
      )
    );
    const failed = perColumn.find((res) => res.error);
    if (failed?.error) {
      console.warn(
        `[sis] cross-AY search apps fail (${ayCode}):`,
        failed.error.message
      );
      return [] as CrossAyMatch[];
    }
    const apps = mergeSearchHits(
      perColumn.map((res) => (res.data ?? []) as AppHit[]),
      20
    );
    if (apps.length === 0) return [] as CrossAyMatch[];

    const enroleeNumbers = apps
      .map((a) => a.enroleeNumber)
      .filter((x): x is string => !!x);
    const { data: statusData } = await supabase
      .from(`${prefix}_enrolment_status`)
      .select('enroleeNumber, classLevel, classSection, applicationStatus')
      .in('enroleeNumber', enroleeNumbers);
    type StatusHit = {
      enroleeNumber: string | null;
      classLevel: string | null;
      classSection: string | null;
      applicationStatus: string | null;
    };
    const byEnrolee = new Map<string, StatusHit>();
    for (const s of (statusData ?? []) as StatusHit[]) {
      if (s.enroleeNumber) byEnrolee.set(s.enroleeNumber, s);
    }

    return apps
      .filter((a) => a.enroleeNumber)
      .map((a) => {
        const s = byEnrolee.get(a.enroleeNumber!);
        const fullName =
          a.enroleeFullName ??
          [a.firstName, a.lastName].filter(Boolean).join(' ') ??
          '(no name on file)';
        return {
          ayCode,
          enroleeNumber: a.enroleeNumber!,
          studentNumber: a.studentNumber,
          fullName,
          firstName: a.firstName,
          lastName: a.lastName,
          middleName: a.middleName,
          level: s?.classLevel ?? null,
          section: s?.classSection ?? null,
          status: s?.applicationStatus ?? null,
        };
      });
  });

  const perAy = await Promise.all(perAyPromises);
  // Flatten + cap at 50 most recent (AY-sorted) so the API stays bounded.
  return perAy.flat().slice(0, 50);
}

export type EnrollmentHistoryEntry = {
  ayCode: string;
  enroleeNumber: string;
  level: string | null;
  section: string | null;
  status: string | null;
};

export async function getEnrollmentHistory(
  studentNumber: string
): Promise<EnrollmentHistoryEntry[]> {
  const trimmed = studentNumber.trim();
  if (!trimmed) return [];

  const supabase = createAdmissionsClient();
  const { data: ays, error: ayErr } = await supabase
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  if (ayErr) {
    console.error(
      '[sis] getEnrollmentHistory academic_years lookup failed:',
      ayErr.message
    );
    return [];
  }
  const ayCodes = ((ays ?? []) as { ay_code: string }[]).map((a) => a.ay_code);

  type AppHit = { enroleeNumber: string | null; studentNumber: string | null };
  type StatusHit = {
    enroleeNumber: string | null;
    classLevel: string | null;
    classSection: string | null;
    applicationStatus: string | null;
  };

  const perAy = await Promise.all(
    ayCodes.map(async (ayCode) => {
      const prefix = prefixFor(ayCode);
      const { data: appsData, error: appsErr } = await supabase
        .from(`${prefix}_enrolment_applications`)
        .select('enroleeNumber, studentNumber')
        .eq('studentNumber', trimmed)
        .limit(5);
      if (appsErr || !appsData || appsData.length === 0)
        return [] as EnrollmentHistoryEntry[];

      const apps = appsData as AppHit[];
      const enroleeNumbers = apps
        .map((a) => a.enroleeNumber)
        .filter((x): x is string => !!x);
      if (enroleeNumbers.length === 0) return [] as EnrollmentHistoryEntry[];

      const { data: statusData } = await supabase
        .from(`${prefix}_enrolment_status`)
        .select('enroleeNumber, classLevel, classSection, applicationStatus')
        .in('enroleeNumber', enroleeNumbers);
      const byEnrolee = new Map<string, StatusHit>();
      for (const s of (statusData ?? []) as StatusHit[]) {
        if (s.enroleeNumber) byEnrolee.set(s.enroleeNumber, s);
      }
      return apps
        .filter((a) => a.enroleeNumber)
        .map((a) => {
          const s = byEnrolee.get(a.enroleeNumber!);
          return {
            ayCode,
            enroleeNumber: a.enroleeNumber!,
            level: s?.classLevel ?? null,
            section: s?.classSection ?? null,
            status: s?.applicationStatus ?? null,
          };
        });
    })
  );

  return perAy.flat();
}

// Look up the `sections.id` (UUID) for a given AY + level label + section
// name. Used by the Enrollment tab's "Move to another section →" CTA, which
// needs the section ID to deep-link into `/sis/sections/[id]` (the SIS Admin
// section detail page that hosts the SectionTransferDialog per KD #67).
//
// Returns null when no match — the caller hides the CTA gracefully (e.g.
// the section was renamed or dropped after AY rollover).
export async function getSectionIdByLevelAndName(
  ayCode: string,
  levelLabel: string,
  sectionName: string
): Promise<string | null> {
  return unstable_cache(
    async () => {
      const trimmedLabel = (levelLabel ?? '').trim();
      const trimmedName = (sectionName ?? '').trim();
      if (!trimmedLabel || !trimmedName) return null;

      const service = createServiceClient();
      // Resolve AY id first (sections.academic_year_id is a UUID FK).
      const { data: ayRow } = await service
        .from('academic_years')
        .select('id')
        .eq('ay_code', ayCode)
        .maybeSingle();
      if (!ayRow) return null;
      const ayId = (ayRow as { id: string }).id;

      const { data, error } = await service
        .from('sections')
        .select('id, name, levels!inner(label)')
        .eq('academic_year_id', ayId)
        .eq('name', trimmedName)
        .filter('levels.label', 'eq', trimmedLabel)
        .maybeSingle();
      if (error || !data) return null;
      return (data as { id: string }).id ?? null;
    },
    ['sis', 'section-id-by-name', ayCode, levelLabel, sectionName],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(ayCode) }
  )();
}

export type DiscountCode = {
  id: string | number;
  discountCode: string;
  enroleeType: string | null;
  startDate: string | null;
  endDate: string | null;
  details: string | null;
};

export async function listDiscountCodes(
  ayCode: string
): Promise<DiscountCode[]> {
  return unstable_cache(
    async () => {
      const prefix = prefixFor(ayCode);
      const supabase = createAdmissionsClient();
      const { data, error } = await supabase
        .from(`${prefix}_discount_codes`)
        .select('id, discountCode, enroleeType, startDate, endDate, details')
        .order('endDate', { ascending: false });
      if (error) {
        console.error('[sis] listDiscountCodes fetch failed:', error.message);
        return [];
      }
      type Row = {
        id: string | number;
        discountCode: string | null;
        enroleeType: string | null;
        startDate: string | null;
        endDate: string | null;
        details: string | null;
      };
      return ((data ?? []) as Row[])
        .filter((r) => !!r.discountCode)
        .map((r) => ({
          id: r.id,
          discountCode: r.discountCode!,
          enroleeType: r.enroleeType,
          startDate: r.startDate,
          endDate: r.endDate,
          details: r.details,
        }));
    },
    ['sis', 'discount-codes', ayCode],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS }
  )();
}
