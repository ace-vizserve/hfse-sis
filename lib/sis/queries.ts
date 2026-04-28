import { unstable_cache } from "next/cache";

import { createAdmissionsClient } from "@/lib/supabase/admissions";

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
  return `ay${ayCode.replace(/^AY/i, "").toLowerCase()}`;
}

function tag(ayCode: string): string[] {
  return ["sis", `sis:${ayCode}`];
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
  classLevel: string | null;
  classSection: string | null;
  applicationStatus: string | null;
  applicationUpdatedDate: string | null;
  created_at: string | null;
};

// `created_at` carries the application's submission timestamp (Supabase default
// column). Surfaced on StudentListRow so the admissions list can sort/show
// "newest first" client-side without a second round-trip.
const LIST_APP_COLUMNS =
  "enroleeNumber, studentNumber, firstName, middleName, lastName, enroleeFullName, levelApplied, created_at";
const LIST_STATUS_COLUMNS = "enroleeNumber, classLevel, classSection, applicationStatus, applicationUpdatedDate";

export type StudentListOrder = "created_at_desc" | "name_asc";

// Returns the joined applications × status shape for one AY. `orderBy` picks
// the SQL order — admissions wants newest applications first, records prefers
// alphabetical. `enroleeNumber` is the stable tiebreaker either way.
export async function listStudents(
  ayCode: string,
  orderBy: StudentListOrder = "name_asc",
): Promise<StudentListRow[]> {
  return unstable_cache(
    async () => {
      const prefix = prefixFor(ayCode);
      const supabase = createAdmissionsClient();

      const appsQuery = supabase.from(`${prefix}_enrolment_applications`).select(LIST_APP_COLUMNS);
      const orderedAppsQuery =
        orderBy === "created_at_desc"
          ? appsQuery.order("created_at", { ascending: false }).order("enroleeNumber", { ascending: true })
          : appsQuery
              .order("lastName", { ascending: true })
              .order("firstName", { ascending: true })
              .order("enroleeNumber", { ascending: true });

      const [appsRes, statusRes] = await Promise.all([
        orderedAppsQuery,
        supabase.from(`${prefix}_enrolment_status`).select(LIST_STATUS_COLUMNS),
      ]);

      if (appsRes.error) {
        console.error("[sis] listStudents apps fetch failed:", appsRes.error.message);
        return [];
      }
      if (statusRes.error) {
        console.error("[sis] listStudents status fetch failed:", statusRes.error.message);
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
        created_at: string | null;
      };
      type StatusLite = {
        enroleeNumber: string | null;
        classLevel: string | null;
        classSection: string | null;
        applicationStatus: string | null;
        applicationUpdatedDate: string | null;
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
          classLevel: s?.classLevel ?? null,
          classSection: s?.classSection ?? null,
          applicationStatus: s?.applicationStatus ?? null,
          applicationUpdatedDate: s?.applicationUpdatedDate ?? null,
          created_at: a.created_at,
        });
      }
      return out;
    },
    ["sis", "list-students", ayCode, orderBy],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
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

export async function getSisDashboardSummary(ayCode: string): Promise<SisDashboardSummary> {
  const rows = await listStudents(ayCode, "name_asc");
  let enrolled = 0;
  let pending = 0;
  let withdrawn = 0;
  for (const r of rows) {
    const s = (r.applicationStatus ?? "").trim();
    if (s === "Enrolled" || s === "Enrolled (Conditional)") enrolled += 1;
    else if (s === "Withdrawn") withdrawn += 1;
    else if (s) pending += 1;
  }
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
  contractSignatory: string | null;
  // Family — father
  fatherFullName: string | null;
  fatherFirstName: string | null;
  fatherLastName: string | null;
  fatherNric: string | null;
  fatherBirthDay: string | null;
  fatherMobile: string | null;
  fatherEmail: string | null;
  fatherNationality: string | null;
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
  motherLastName: string | null;
  motherNric: string | null;
  motherBirthDay: string | null;
  motherMobile: string | null;
  motherEmail: string | null;
  motherNationality: string | null;
  motherCompanyName: string | null;
  motherPosition: string | null;
  motherPassport: string | null;
  motherPassportExpiry: string | null;
  motherPass: string | null;
  motherPassExpiry: string | null;
  motherWhatsappTeamsConsent: boolean | null;
  // Family — guardian
  guardianFullName: string | null;
  guardianMobile: string | null;
  guardianEmail: string | null;
  guardianNationality: string | null;
  guardianPassport: string | null;
  guardianPassportExpiry: string | null;
  guardianPass: string | null;
  guardianPassExpiry: string | null;
  guardianWhatsappTeamsConsent: boolean | null;
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
  "enroleeNumber",
  "studentNumber",
  "enroleeFullName",
  "firstName",
  "middleName",
  "lastName",
  "preferredName",
  "category",
  "nric",
  "birthDay",
  "gender",
  "nationality",
  "primaryLanguage",
  "religion",
  "religionOther",
  "passportNumber",
  "passportExpiry",
  "pass",
  "passExpiry",
  "stpApplicationType",
  "residenceHistory",
  "homePhone",
  "homeAddress",
  "postalCode",
  "livingWithWhom",
  "contactPerson",
  "contactPersonNumber",
  "parentMaritalStatus",
  "levelApplied",
  "preferredSchedule",
  "classType",
  "paymentOption",
  "availSchoolBus",
  "availStudentCare",
  "studentCareProgram",
  "availUniform",
  "additionalLearningNeeds",
  "otherLearningNeeds",
  "previousSchool",
  "howDidYouKnowAboutHFSEIS",
  "otherSource",
  "discount1",
  "discount2",
  "discount3",
  "referrerName",
  "referrerMobile",
  "contractSignatory",
  "fatherFullName",
  "fatherFirstName",
  "fatherLastName",
  "fatherNric",
  "fatherBirthDay",
  "fatherMobile",
  "fatherEmail",
  "fatherNationality",
  "fatherCompanyName",
  "fatherPosition",
  "fatherPassport",
  "fatherPassportExpiry",
  "fatherPass",
  "fatherPassExpiry",
  "fatherWhatsappTeamsConsent",
  "motherFullName",
  "motherFirstName",
  "motherLastName",
  "motherNric",
  "motherBirthDay",
  "motherMobile",
  "motherEmail",
  "motherNationality",
  "motherCompanyName",
  "motherPosition",
  "motherPassport",
  "motherPassportExpiry",
  "motherPass",
  "motherPassExpiry",
  "motherWhatsappTeamsConsent",
  "guardianFullName",
  "guardianMobile",
  "guardianEmail",
  "guardianNationality",
  "guardianPassport",
  "guardianPassportExpiry",
  "guardianPass",
  "guardianPassExpiry",
  "guardianWhatsappTeamsConsent",
  "asthma",
  "allergies",
  "allergyDetails",
  "foodAllergies",
  "foodAllergyDetails",
  "heartConditions",
  "epilepsy",
  "eczema",
  "diabetes",
  "paracetamolConsent",
  "otherMedicalConditions",
  "dietaryRestrictions",
  "socialMediaConsent",
  "feedbackConsent",
  "created_at",
].join(", ");

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
  "enroleeNumber",
  "enroleeType",
  "enrolmentDate",
  "applicationStatus",
  "applicationRemarks",
  "applicationUpdatedDate",
  "applicationUpdatedBy",
  "registrationStatus",
  "registrationInvoice",
  "registrationPaymentDate",
  "registrationRemarks",
  "registrationUpdatedDate:registrationUpdateDate",
  "registrationUpdatedBy:registrationUpdatedby",
  "documentStatus",
  "documentRemarks",
  "documentUpdatedDate",
  "documentUpdatedBy:documentUpdatedby",
  "assessmentStatus",
  "assessmentSchedule",
  "assessmentGradeMath",
  "assessmentGradeEnglish",
  "assessmentMedical",
  "assessmentRemarks",
  "assessmentUpdatedDate",
  "assessmentUpdatedBy:assessmentUpdatedby",
  "contractStatus",
  "contractRemarks",
  "contractUpdatedDate",
  "contractUpdatedBy:contractUpdatedby",
  "feeStatus",
  "feeInvoice",
  "feePaymentDate",
  "feeStartDate",
  "feeRemarks",
  "feeUpdatedDate",
  "feeUpdatedBy:feeUpdatedby",
  "classStatus",
  "classAY",
  "classLevel",
  "classSection",
  "classRemarks",
  "classUpdatedDate",
  "classUpdatedBy:classUpdatedby",
  "suppliesStatus",
  "suppliesClaimedDate",
  "suppliesRemarks",
  "suppliesUpdatedDate",
  "suppliesUpdatedBy:suppliesUpdatedby",
  "orientationStatus",
  "orientationScheduleDate",
  "orientationRemarks",
  "orientationUpdatedDate",
  "orientationUpdatedBy:orientationUpdateby",
].join(", ");

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
  { key: "idPicture", label: "ID Picture", statusCol: "idPictureStatus", urlCol: "idPicture" },
  { key: "birthCert", label: "Birth Certificate", statusCol: "birthCertStatus", urlCol: "birthCert" },
  { key: "educCert", label: "Education Certificate", statusCol: "educCertStatus", urlCol: "educCert" },
  { key: "medical", label: "Medical", statusCol: "medicalStatus", urlCol: "medical" },
  { key: "form12", label: "Form 12", statusCol: "form12Status", urlCol: "form12" },
  {
    key: "passport",
    label: "Passport (Student)",
    statusCol: "passportStatus",
    urlCol: "passport",
    expiryCol: "passportExpiry",
  },
  { key: "pass", label: "Pass (Student)", statusCol: "passStatus", urlCol: "pass", expiryCol: "passExpiry" },
  {
    key: "motherPassport",
    label: "Mother Passport",
    statusCol: "motherPassportStatus",
    urlCol: "motherPassport",
    expiryCol: "motherPassportExpiry",
  },
  {
    key: "motherPass",
    label: "Mother Pass",
    statusCol: "motherPassStatus",
    urlCol: "motherPass",
    expiryCol: "motherPassExpiry",
  },
  {
    key: "fatherPassport",
    label: "Father Passport",
    statusCol: "fatherPassportStatus",
    urlCol: "fatherPassport",
    expiryCol: "fatherPassportExpiry",
  },
  {
    key: "fatherPass",
    label: "Father Pass",
    statusCol: "fatherPassStatus",
    urlCol: "fatherPass",
    expiryCol: "fatherPassExpiry",
  },
  {
    key: "guardianPassport",
    label: "Guardian Passport",
    statusCol: "guardianPassportStatus",
    urlCol: "guardianPassport",
    expiryCol: "guardianPassportExpiry",
  },
  {
    key: "guardianPass",
    label: "Guardian Pass",
    statusCol: "guardianPassStatus",
    urlCol: "guardianPass",
    expiryCol: "guardianPassExpiry",
  },
  // STP application slots — visible when stpApplicationType is set on the applications row
  { key: "icaPhoto", label: "ICA Photo (STP)", statusCol: "icaPhotoStatus", urlCol: "icaPhoto" },
  {
    key: "financialSupportDocs",
    label: "Financial Support (STP)",
    statusCol: "financialSupportDocsStatus",
    urlCol: "financialSupportDocs",
  },
  {
    key: "vaccinationInformation",
    label: "Vaccination Info (STP)",
    statusCol: "vaccinationInformationStatus",
    urlCol: "vaccinationInformation",
  },
];

// STP-conditional slot keys — UI consumers hide these when the apps row's
// stpApplicationType is null. The columns always exist on the row; only display
// is gated. See KD #51 + the parent-portal STP workflow.
export const STP_CONDITIONAL_SLOT_KEYS = ["icaPhoto", "financialSupportDocs", "vaccinationInformation"] as const;

const DOCUMENT_COLUMNS = [
  "enroleeNumber",
  "studentNumber",
  ...DOCUMENT_SLOTS.flatMap((s) => [s.statusCol, s.urlCol, s.expiryCol].filter(Boolean) as string[]),
].join(", ");

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
  "enroleeNumber, studentNumber, firstName, middleName, lastName, enroleeFullName, levelApplied";

export async function getStudentDetail(ayCode: string, enroleeNumber: string): Promise<StudentDetail | null> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  const [appRes, statusRes, docsRes] = await Promise.all([
    supabase
      .from(`${prefix}_enrolment_applications`)
      .select(DETAIL_APP_COLUMNS)
      .eq("enroleeNumber", enroleeNumber)
      .maybeSingle(),
    supabase
      .from(`${prefix}_enrolment_status`)
      .select(DETAIL_STATUS_COLUMNS)
      .eq("enroleeNumber", enroleeNumber)
      .maybeSingle(),
    supabase
      .from(`${prefix}_enrolment_documents`)
      .select(DOCUMENT_COLUMNS)
      .eq("enroleeNumber", enroleeNumber)
      .maybeSingle(),
  ]);

  // App-row fallback: if the full SELECT errored (typically because the
  // historical AY's table lacks columns that were added in a later schema
  // version), retry with only the always-present minimal columns so the
  // page still renders with identity data. The specific column-not-found
  // error is logged so an operator can ALTER TABLE to add missing cols.
  let appData: unknown = appRes.error ? null : appRes.data;
  if (appRes.error) {
    console.warn("[sis] getStudentDetail full apps select failed, retrying minimal:", appRes.error.message);
    const fallback = await supabase
      .from(`${prefix}_enrolment_applications`)
      .select(MINIMAL_APP_COLUMNS)
      .eq("enroleeNumber", enroleeNumber)
      .maybeSingle();
    if (fallback.error) {
      console.error("[sis] getStudentDetail minimal apps select also failed:", fallback.error.message);
      return null;
    }
    appData = fallback.data;
  }
  if (!appData) return null;

  // Don't swallow status/docs errors — they typically mean duplicate rows
  // (enroleeNumber isn't unique on `_status` / `_documents` per migration 025).
  // The page still needs the applications row to render, so we keep going and
  // surface the error via the two flags on StudentDetail.
  const statusFetchError = statusRes.error !== null && statusRes.error !== undefined;
  const docsFetchError = docsRes.error !== null && docsRes.error !== undefined;
  // console.warn, not console.error — Next.js 16's dev overlay surfaces
  // console.error as a full runtime-error modal. The page still renders
  // (timeline shows null markers + amber alert), so this is a recoverable
  // data-quality issue, not a crash.
  if (statusFetchError) {
    console.warn("[sis] getStudentDetail status fetch failed:", statusRes.error?.message);
  }
  if (docsFetchError) {
    console.warn("[sis] getStudentDetail documents fetch failed:", docsRes.error?.message);
  }

  const app = appData as unknown as ApplicationRow;
  const status = (statusRes.data ?? null) as StatusRow | null;
  const docsRow = (docsRes.data ?? null) as Record<string, unknown> | null;

  const documents: DocumentSlot[] = DOCUMENT_SLOTS.map((slot) => ({
    key: slot.key,
    label: slot.label,
    url: (docsRow?.[slot.urlCol] as string | null) ?? null,
    status: (docsRow?.[slot.statusCol] as string | null) ?? null,
    expiry: slot.expiryCol ? ((docsRow?.[slot.expiryCol] as string | null) ?? null) : null,
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

export async function searchStudentsAcrossAY(query: string): Promise<CrossAyMatch[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const supabase = createAdmissionsClient();

  // 1) Pull every active AY code from academic_years (sorted desc so the most
  //    recent matches surface first).
  const { data: ays, error: ayErr } = await supabase
    .from("academic_years")
    .select("ay_code")
    .order("ay_code", { ascending: false });
  if (ayErr) {
    console.error("[sis] searchStudentsAcrossAY academic_years lookup failed:", ayErr.message);
    return [];
  }
  const ayCodes = ((ays ?? []) as { ay_code: string }[]).map((a) => a.ay_code);

  // 2) For each AY, query the apps + status tables in parallel. Bail on per-AY
  //    failures so a single missing table doesn't kill the whole search.
  const escaped = trimmed.replace(/[%_]/g, (m) => `\\${m}`);
  const pattern = `%${escaped}%`;

  type AppHit = {
    enroleeNumber: string | null;
    studentNumber: string | null;
    enroleeFullName: string | null;
    firstName: string | null;
    lastName: string | null;
    middleName: string | null;
  };

  const perAyPromises = ayCodes.map(async (ayCode) => {
    const prefix = prefixFor(ayCode);
    const { data: appsData, error: appsErr } = await supabase
      .from(`${prefix}_enrolment_applications`)
      .select("enroleeNumber, studentNumber, enroleeFullName, firstName, lastName, middleName")
      .or(
        `enroleeNumber.ilike.${pattern},studentNumber.ilike.${pattern},enroleeFullName.ilike.${pattern},firstName.ilike.${pattern},lastName.ilike.${pattern}`,
      )
      .order("created_at", { ascending: false })
      .limit(20);
    if (appsErr) {
      console.warn(`[sis] cross-AY search apps fail (${ayCode}):`, appsErr.message);
      return [] as CrossAyMatch[];
    }
    const apps = (appsData ?? []) as AppHit[];
    if (apps.length === 0) return [] as CrossAyMatch[];

    const enroleeNumbers = apps.map((a) => a.enroleeNumber).filter((x): x is string => !!x);
    const { data: statusData } = await supabase
      .from(`${prefix}_enrolment_status`)
      .select("enroleeNumber, classLevel, classSection, applicationStatus")
      .in("enroleeNumber", enroleeNumbers);
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
          a.enroleeFullName ?? [a.firstName, a.lastName].filter(Boolean).join(" ") ?? "(no name on file)";
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

export async function getEnrollmentHistory(studentNumber: string): Promise<EnrollmentHistoryEntry[]> {
  const trimmed = studentNumber.trim();
  if (!trimmed) return [];

  const supabase = createAdmissionsClient();
  const { data: ays, error: ayErr } = await supabase
    .from("academic_years")
    .select("ay_code")
    .order("ay_code", { ascending: false });
  if (ayErr) {
    console.error("[sis] getEnrollmentHistory academic_years lookup failed:", ayErr.message);
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
        .select("enroleeNumber, studentNumber")
        .eq("studentNumber", trimmed)
        .limit(5);
      if (appsErr || !appsData || appsData.length === 0) return [] as EnrollmentHistoryEntry[];

      const apps = appsData as AppHit[];
      const enroleeNumbers = apps.map((a) => a.enroleeNumber).filter((x): x is string => !!x);
      if (enroleeNumbers.length === 0) return [] as EnrollmentHistoryEntry[];

      const { data: statusData } = await supabase
        .from(`${prefix}_enrolment_status`)
        .select("enroleeNumber, classLevel, classSection, applicationStatus")
        .in("enroleeNumber", enroleeNumbers);
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
    }),
  );

  return perAy.flat();
}

export type DiscountCode = {
  id: string | number;
  discountCode: string;
  enroleeType: string | null;
  startDate: string | null;
  endDate: string | null;
  details: string | null;
};

export async function listDiscountCodes(ayCode: string): Promise<DiscountCode[]> {
  return unstable_cache(
    async () => {
      const prefix = prefixFor(ayCode);
      const supabase = createAdmissionsClient();
      const { data, error } = await supabase
        .from(`${prefix}_discount_codes`)
        .select("id, discountCode, enroleeType, startDate, endDate, details")
        .order("endDate", { ascending: false });
      if (error) {
        console.error("[sis] listDiscountCodes fetch failed:", error.message);
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
    ["sis", "discount-codes", ayCode],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
  )();
}
