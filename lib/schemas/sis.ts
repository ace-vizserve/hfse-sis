import { z } from 'zod';

import { COUNTRY_NAME_SET } from '@/lib/data/countries';

// Sprint 10 Phase 2 — schemas for SIS write surfaces.
//
// Two stable IDs are deliberately NOT in any schema and are 400'd by the
// API routes if the client sends them: `enroleeNumber` and `studentNumber`.
// They are referenced by other tables across years (Hard Rule #4) and a
// stray edit ripples through grading + parent lookup. Edit those at the
// admissions layer if they're ever wrong.

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

// Empty string → null. The admissions tables store nulls, not "" — keeps the
// distinction between "not provided" and "explicitly cleared" honest.
const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length === 0 ? null : s))
    .nullable();

// Date-only fields (yyyy-MM-dd). Empty → null. Format validated at the schema
// level so the route doesn't have to recheck.
const optionalDate = z
  .string()
  .trim()
  .transform((s) => (s.length === 0 ? null : s))
  .refine((s) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s), {
    message: 'Use YYYY-MM-DD',
  })
  .nullable();

// Three-state tri-bool: true / false / null. Client components emit one of
// these directly via the Select (no need for HTML-form string coercion since
// every editor is React-controlled).
const optionalBool = z.boolean().nullable();

// 'Yes' / 'No' / null. Some columns on the production admissions table store
// the literal strings 'Yes' / 'No' instead of true/false (e.g. availSchoolBus,
// availUniform, availStudentCare, preCourseAnswer). Three-state tri-string.
const optionalYesNo = z.enum(['Yes', 'No']).nullable();

// NUMBERS ARRIVE HERE, AND THAT IS NOT HYPOTHETICAL. Every mobile column on
// the admissions tables is numeric in production — `motherMobile` is a `number`
// on 498 of 498 AY2026 rows, and `fatherMobile`, `guardianMobile` and
// `contactPersonNumber` likewise, because the parent portal writes them that
// way. Both edit sheets submit the WHOLE form on every save (see the gated-field
// note further down), so an untouched phone field carries that number straight
// back to the server.
//
// Until 2026-08-10 every branch of these validators was `z.string()`, so the
// parse failed and the route 400'd the ENTIRE form — a registrar editing a
// preferred name lost the edit because of a field they never touched. The
// comment that used to sit here claimed reads "coerce numeric DB values to
// string at the row-mapping layer"; no such coercion existed. It does now
// (`toText` in lib/sis/queries.ts), and this is the second half of that fix:
// the server accepts what the database really holds, whatever the read layer
// did or did not do.
//
// Applied ONLY to the phone/postal family. `optionalText` stays string-only —
// a number arriving in a name or an address is a bug worth failing on.
const coerceToText = (schema: z.ZodTypeAny) =>
  z.preprocess((v) => (typeof v === 'number' ? String(v) : v), schema);

const optionalNumberOrText = coerceToText(optionalText(60));

// NRIC / FIN — adopted verbatim from the admissions portal's own schema.
const optionalNric = z
  .string()
  .trim()
  .max(40)
  .transform((s) => (s.length === 0 ? null : s))
  .refine((s) => s === null || /^[STFGM]\d{7}[A-Z]$/.test(s), {
    message: 'Enter a valid NRIC/FIN (e.g. S1234567A)',
  })
  .nullable();

// Phone numbers — adopted verbatim from the admissions portal's own
// schema. Digits only, optional leading +.
const optionalPhone = coerceToText(
  z
    .string()
    .trim()
    .max(60)
    .transform((s) => (s.length === 0 ? null : s))
    .refine((s) => s === null || /^\+?\d+$/.test(s), {
      message: 'Enter digits only, with an optional leading +',
    })
    .nullable()
);

// Postal code — digits only. No extra length bound beyond the existing
// 60-char ceiling (a Singapore 6-digit code isn't hard-coded — legacy or
// overseas addresses may be on file).
const optionalPostalCode = coerceToText(
  z
    .string()
    .trim()
    .max(60)
    .transform((s) => (s.length === 0 ? null : s))
    .refine((s) => s === null || /^\d+$/.test(s), {
      message: 'Enter digits only',
    })
    .nullable()
);

// Nationality — constrained to the canonical country-name list (see
// lib/data/countries.ts). Stores the country NAME, matching the admissions
// portal's LocationSelector. A pre-existing off-list DB value is untouched
// by this refine — it only rejects a NEW write of an off-list string; the
// combobox UI (CountryCombobox) is the only write path once this ships, and
// it either emits a canonical name or leaves an off-list value unchanged.
const optionalNationality = z
  .string()
  .trim()
  .max(80)
  .transform((s) => (s.length === 0 ? null : s))
  .refine((s) => s === null || COUNTRY_NAME_SET.has(s), {
    message: 'Select a country from the list',
  })
  .nullable();

// Optional integer rating, 1..5. Accepts string-form numbers from the parent
// portal too (e.g. "5"). null when blank/invalid.
const optionalRating1to5 = z
  .union([z.number(), z.string().trim()])
  .nullable()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : v.length === 0 ? null : Number(v);
    if (n === null || !Number.isFinite(n) || !Number.isInteger(n)) return null;
    if (n < 1 || n > 5) return null;
    return n as 1 | 2 | 3 | 4 | 5;
  });

// ──────────────────────────────────────────────────────────────────────────
// Profile (demographics) — applications row, single-student
// ──────────────────────────────────────────────────────────────────────────

// Mirrors `ay{YY}_enrolment_status.enroleeType`. Same 4-value enum on both
// sides — the apps row's `category` and the status row's `enroleeType` always
// agree. Used to match a student against a discount code's eligibility filter
// (DISCOUNT_ENROLEE_TYPES below adds the `Both` / `VizSchool Both` superset).
export const ENROLEE_CATEGORIES = [
  'New',
  'Current',
  'VizSchool New',
  'VizSchool Current',
] as const;

// `preferredPaymentScheme` / `preferredPaymentMethod` — parent-portal-only
// columns added directly on the admissions table (not yet part of any
// migration's DDL as of this writing). Stored as plain text, not a DB CHECK —
// these lists constrain what the parent portal writes; the SIS is read-only
// on them today (display via the option-label lookups below). The DB value
// for the card payment method doesn't match its intended display label (the
// "3% platform fee" note), so `paymentMethodLabel` translates it.
export const PREFERRED_PAYMENT_SCHEME_OPTIONS = [
  { label: 'Annual (Full Payment)', value: 'Annual (Full Payment)' },
  { label: 'Quarterly Payment', value: 'Quarterly Payment' },
  { label: 'Monthly Payment', value: 'Monthly Payment' },
] as const;

export const PREFERRED_PAYMENT_METHOD_OPTIONS = [
  { label: 'Bank Transfer', value: 'Bank Transfer' },
  { label: 'GIRO', value: 'GIRO' },
  {
    label: 'Credit/Debit Card ( 3% platform fee)',
    value: 'Credit/Debit Card Payment',
  },
] as const;

// Parent-portal vocabularies for fields the SIS previously edited as free
// text. Same plain-text-no-CHECK shape as the payment lists: these bound what
// the portal offers, the pickers surface an off-list legacy value as a
// "(current)" item, and nothing is force-migrated.
//
// Measured on AY2026 (497 rows) before adding these — the drift is why they
// exist, not a hypothetical:
//   parentMaritalStatus  21 distinct for 5 real values ("MARRIED", "married",
//                        "Married " with a trailing space, "Married in Church")
//   religion             12 distinct for 7 ("Others" vs "Other", "Catholic"
//                        vs "Roman Catholic")
// Constraining the SIS write path stops NEW drift; it doesn't clean the past.
export const GENDER_OPTIONS = [
  { label: 'Male', value: 'Male' },
  { label: 'Female', value: 'Female' },
] as const;

export const RELIGION_OPTIONS = [
  { label: 'Christianity', value: 'Christianity' },
  { label: 'Roman Catholic', value: 'Roman Catholic' },
  { label: 'Islam', value: 'Islam' },
  { label: 'Hinduism', value: 'Hinduism' },
  { label: 'Buddhism', value: 'Buddhism' },
  { label: 'Judaism', value: 'Judaism' },
  // Free-text detail goes in the companion `religionOther` field.
  { label: 'Other', value: 'Other' },
] as const;

export const MARITAL_STATUS_OPTIONS = [
  { label: 'Single', value: 'Single' },
  { label: 'Married', value: 'Married' },
  { label: 'Separated', value: 'Separated' },
  { label: 'Divorced', value: 'Divorced' },
  { label: 'Widowed', value: 'Widowed' },
] as const;

// Which of these a given level may choose is a parent-portal rule (Morning
// only for VizSchool, Whole Day for Cambridge Y8-Y10). The SIS edits an
// existing record rather than taking an application, so it offers all three
// and doesn't re-derive that rule from the level — encoding it here would
// duplicate portal logic and risk blocking a correction to a real row.
export const PREFERRED_SCHEDULE_OPTIONS = [
  { label: 'Morning', value: 'Morning' },
  { label: 'Afternoon', value: 'Afternoon' },
  { label: 'Whole Day', value: 'Whole Day' },
] as const;

export const STUDENT_CARE_PROGRAM_OPTIONS = [
  { label: 'Full day (Full-Day Program)', value: 'Full day' },
  { label: 'Daily (Daily Program)', value: 'Daily' },
] as const;

// The portal only offers Father when father details were supplied. The SIS
// shows both: it edits records where that's already settled, and the value is
// a plain string, so hiding an option would make an existing "Father" row
// uneditable.
export const CONTRACT_SIGNATORY_OPTIONS = [
  { label: 'Mother', value: 'Mother' },
  { label: 'Father', value: 'Father' },
] as const;

// Immigration pass TYPE — a category, not a credential. Same
// parent-portal-constrained, plain-text-in-the-DB shape as the payment lists
// above: these bound what the portal writes, there is no DB CHECK, and a
// legacy row can hold something off-list (the pickers surface such a value as
// a "(current)" item rather than silently dropping it).
//
// The student and parent/guardian lists are genuinely different vocabularies —
// a student holds a Student Pass or LTVP, a working parent an E-PASS/S-PASS —
// so they are NOT collapsed into one shared list.
export const STUDENT_PASS_TYPE_OPTIONS = [
  { label: 'Singaporean', value: 'Singaporean' },
  { label: 'Singapore PR', value: 'Singapore PR' },
  { label: 'Dependent Pass', value: 'Dependent Pass' },
  { label: 'Student Pass', value: 'Student Pass' },
  { label: 'Long Term Visit Pass', value: 'Long Term Visit Pass' },
] as const;

export const PARENT_GUARDIAN_PASS_TYPE_OPTIONS = [
  { label: 'E-PASS', value: 'E-PASS' },
  { label: 'S-PASS', value: 'S-PASS' },
  { label: 'Dependent Pass', value: 'Dependent Pass' },
  { label: 'Permanent Resident', value: 'Permanent Resident' },
  { label: 'Other', value: 'Other' },
] as const;

export function paymentSchemeLabel(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  return (
    PREFERRED_PAYMENT_SCHEME_OPTIONS.find((o) => o.value === value)?.label ??
    value
  );
}

export function paymentMethodLabel(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  return (
    PREFERRED_PAYMENT_METHOD_OPTIONS.find((o) => o.value === value)?.label ??
    value
  );
}

export const ProfileUpdateSchema = z.object({
  // Names — all optional (some students have only a first/last)
  firstName: optionalText(120),
  middleName: optionalText(120),
  lastName: optionalText(120),
  preferredName: optionalText(120),
  enroleeFullName: optionalText(240),
  // Identity
  category: z.enum(ENROLEE_CATEGORIES).nullable().optional(),
  nric: optionalNric,
  birthDay: optionalDate,
  gender: optionalText(40),
  nationality: optionalNationality,
  primaryLanguage: optionalText(80),
  religion: optionalText(80),
  religionOther: optionalText(120),
  // Travel docs (also editable in P-Files for non-staff workflows; SIS keeps
  // them in sync via the same column writes — Key Decision #34 still applies.)
  passportNumber: optionalText(40),
  passportExpiry: optionalDate,
  pass: optionalText(60),
  passExpiry: optionalDate,
  // Contact
  homePhone: optionalPhone,
  homeAddress: optionalText(500),
  postalCode: optionalPostalCode,
  livingWithWhom: optionalText(120),
  contactPerson: optionalText(120),
  contactPersonNumber: optionalPhone,
  parentMaritalStatus: optionalText(60),
  // Application preferences
  levelApplied: optionalText(80),
  preferredSchedule: optionalText(80),
  classType: optionalText(80),
  paymentOption: optionalText(80),
  availSchoolBus: optionalYesNo,
  availStudentCare: optionalYesNo,
  studentCareProgram: optionalText(120),
  availUniform: optionalYesNo,
  additionalLearningNeeds: optionalText(2000),
  otherLearningNeeds: optionalText(2000),
  previousSchool: optionalText(240),
  howDidYouKnowAboutHFSEIS: optionalText(120),
  otherSource: optionalText(240),
  referrerName: optionalText(120),
  referrerMobile: optionalPhone,
  // The person's name when howDidYouKnowAboutHFSEIS === 'Referral' — a
  // separate column from referrerName (referral-source-specific).
  marketingReferrerName: optionalText(120),
  contractSignatory: optionalText(120),
  // Parent-portal payment preference — see PREFERRED_PAYMENT_SCHEME_OPTIONS /
  // PREFERRED_PAYMENT_METHOD_OPTIONS above. Read-only from the SIS today.
  preferredPaymentScheme: optionalText(80),
  preferredPaymentMethod: optionalText(80),
  // Discount slots — these are codes; the future enrolment_discounts table
  // (Phase 3) is the per-student grant ledger
  discount1: optionalText(60),
  discount2: optionalText(60),
  discount3: optionalText(60),
  // ── Item 5 (P2 expansion) ──────────────────────────────────────────────
  // Sibling tracking — 5 slots × 5 fields. Parent portal writes these; SIS
  // displays them. Editable from the SIS Profile sheet's Siblings section
  // when that UI lands (form-side scope deferred from this schema sweep).
  siblingFullName1: optionalText(240),
  siblingBirthDay1: optionalDate,
  siblingReligion1: optionalText(80),
  siblingEducationOccupation1: optionalText(240),
  siblingSchoolCompany1: optionalText(240),
  siblingFullName2: optionalText(240),
  siblingBirthDay2: optionalDate,
  siblingReligion2: optionalText(80),
  siblingEducationOccupation2: optionalText(240),
  siblingSchoolCompany2: optionalText(240),
  siblingFullName3: optionalText(240),
  siblingBirthDay3: optionalDate,
  siblingReligion3: optionalText(80),
  siblingEducationOccupation3: optionalText(240),
  siblingSchoolCompany3: optionalText(240),
  siblingFullName4: optionalText(240),
  siblingBirthDay4: optionalDate,
  siblingReligion4: optionalText(80),
  siblingEducationOccupation4: optionalText(240),
  siblingSchoolCompany4: optionalText(240),
  siblingFullName5: optionalText(240),
  siblingBirthDay5: optionalDate,
  siblingReligion5: optionalText(80),
  siblingEducationOccupation5: optionalText(240),
  siblingSchoolCompany5: optionalText(240),
  // Medical history — bool flags + free-text details. Parent portal writes;
  // SIS Profile sheet's future Medical section will edit.
  allergies: optionalBool,
  allergyDetails: optionalText(2000),
  asthma: optionalBool,
  foodAllergies: optionalBool,
  foodAllergyDetails: optionalText(2000),
  heartConditions: optionalBool,
  epilepsy: optionalBool,
  diabetes: optionalBool,
  eczema: optionalBool,
  otherMedicalConditions: optionalText(2000),
  paracetamolConsent: optionalBool,
  dietaryRestrictions: optionalText(2000),
  // Consent flags + Pre-course / feedback workflow (parent-portal-side
  // workflow; mostly read-only from SIS perspective but included so the
  // round-trip schema covers them).
  socialMediaConsent: optionalBool,
  feedbackConsent: optionalBool,
  preCourseAnswer: optionalText(80),
  preCourseDate: optionalText(60),
  preCourseAcknowledgedAt: optionalText(60),
  feedbackRating: z.number().int().min(1).max(5).nullable().optional(),
  feedbackComments: optionalText(2000),
  feedbackSubmittedAt: optionalText(60),
  // VizSchool / STP track — also referenced from STP Application card per
  // KD #61. stpApplicationType is a free-text field (typical value
  // 'New Student Pass Application'; renewal types may differ).
  vizSchoolProgram: optionalText(120),
  stpApplicationType: optionalText(120),
  // Other extras
  enroleePhoto: optionalText(500),
  creatorUid: optionalText(60),
  // residenceHistory is jsonb in the DB; passes through as a string. Edits
  // go through the dedicated /api/sis/students/[enroleeNumber]/residence-history
  // route (KD #61) — included here for round-trip read coverage.
  residenceHistory: optionalText(4000),
});

export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Family — father / mother / guardian. One schema per parent slot.
// ──────────────────────────────────────────────────────────────────────────

export const PARENT_SLOTS = ['father', 'mother', 'guardian'] as const;
export type ParentSlot = (typeof PARENT_SLOTS)[number];

const optionalEmail = z
  .string()
  .trim()
  .transform((s) => (s.length === 0 ? null : s))
  .refine((s) => s === null || z.string().email().safeParse(s).success, {
    message: 'Enter a valid email',
  })
  .nullable();

// Father has the largest field set (also serves mother/guardian via re-use).
export const FatherUpdateSchema = z.object({
  fatherFullName: optionalText(240),
  fatherFirstName: optionalText(120),
  fatherMiddleName: optionalText(120),
  fatherLastName: optionalText(120),
  fatherPreferredName: optionalText(120),
  fatherNric: optionalNric,
  fatherBirthDay: optionalDate,
  fatherMobile: optionalPhone,
  fatherEmail: optionalEmail,
  fatherNationality: optionalNationality,
  fatherReligion: optionalText(80),
  fatherReligionOther: optionalText(120),
  fatherMarital: optionalText(60),
  fatherCompanyName: optionalText(240),
  fatherPosition: optionalText(120),
  fatherPassport: optionalText(40),
  fatherPassportExpiry: optionalDate,
  fatherPass: optionalText(60),
  fatherPassExpiry: optionalDate,
  fatherWhatsappTeamsConsent: optionalBool,
});

export const MotherUpdateSchema = z.object({
  motherFullName: optionalText(240),
  motherFirstName: optionalText(120),
  motherMiddleName: optionalText(120),
  motherLastName: optionalText(120),
  motherPreferredName: optionalText(120),
  motherNric: optionalNric,
  motherBirthDay: optionalDate,
  motherMobile: optionalPhone,
  motherEmail: optionalEmail,
  motherNationality: optionalNationality,
  motherReligion: optionalText(80),
  motherReligionOther: optionalText(120),
  motherMarital: optionalText(60),
  motherCompanyName: optionalText(240),
  motherPosition: optionalText(120),
  motherPassport: optionalText(40),
  motherPassportExpiry: optionalDate,
  motherPass: optionalText(60),
  motherPassExpiry: optionalDate,
  motherWhatsappTeamsConsent: optionalBool,
});

export const GuardianUpdateSchema = z.object({
  guardianFullName: optionalText(240),
  guardianFirstName: optionalText(120),
  guardianMiddleName: optionalText(120),
  guardianLastName: optionalText(120),
  guardianPreferredName: optionalText(120),
  guardianNric: optionalNric,
  guardianBirthDay: optionalDate,
  guardianMobile: optionalPhone,
  guardianEmail: optionalEmail,
  guardianNationality: optionalNationality,
  guardianReligion: optionalText(80),
  guardianReligionOther: optionalText(120),
  // No guardianMarital — unlike fatherMarital/motherMarital, guardian never
  // got a Marital column in the ay{YYYY}_enrolment_applications DDL
  // (create_ay_admissions_tables, migration 076).
  guardianCompanyName: optionalText(240),
  guardianPosition: optionalText(120),
  guardianPassport: optionalText(40),
  guardianPassportExpiry: optionalDate,
  guardianPass: optionalText(60),
  guardianPassExpiry: optionalDate,
  guardianWhatsappTeamsConsent: optionalBool,
});

export type FatherUpdateInput = z.infer<typeof FatherUpdateSchema>;
export type MotherUpdateInput = z.infer<typeof MotherUpdateSchema>;
export type GuardianUpdateInput = z.infer<typeof GuardianUpdateSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Changed-field-only schema builders
// ──────────────────────────────────────────────────────────────────────────
//
// The format rules on nric/phone/postal/nationality above must only bite on
// a NEW write of a bad value — an existing off-list/malformed value the
// registrar didn't touch must keep saving untouched, since both edit sheets
// submit the WHOLE form on every save, not a partial patch. These builders
// return a schema identical to the exported strict schema EXCEPT that any
// gated field NOT present in `changedFields` falls back to its pre-Task-6
// loose validator, so an untouched legacy value always round-trips
// regardless of format.

export const PROFILE_GATED_FIELDS = [
  'nric',
  'nationality',
  'homePhone',
  'contactPersonNumber',
  'referrerMobile',
  'postalCode',
] as const;

/**
 * The PATCH schema for a profile edit.
 *
 * ⚠ IT IS PARTIAL, AND THAT IS LOAD-BEARING IN BOTH DIRECTIONS.
 *
 * The edit sheet renders about 60 of this schema's ~85 fields; the medical
 * block (`allergies`, `asthma`, `allergyDetails`, …) is never drawn, because
 * parents supply it on the application form and it is not the school's to edit.
 * The sheet therefore submits only what it renders.
 *
 * Required keys made that impossible: `allergies` is `z.boolean().nullable()`,
 * which rejects `undefined`, so every save failed on ~24 fields nobody could
 * see. Reported 2026-08-14 as "Save changes does nothing" — validation was
 * failing silently, so the sheet had in fact never been able to save.
 *
 * And the obvious repair — default the missing fields to null — would have been
 * worse than the bug. `parsed.data` of a non-partial schema carries EVERY key,
 * and the route hands it straight to `.update()`, so the first successful save
 * would have written null over every medical field on that student. The
 * validation failure was the only thing protecting that data.
 *
 * Partial gives PATCH its ordinary meaning: send what you are changing, and
 * only that is written. Anything absent is left alone.
 */
export function buildProfileUpdateSchema(changedFields: ReadonlySet<string>) {
  return z
    .object({
      ...ProfileUpdateSchema.shape,
      nric: changedFields.has('nric') ? optionalNric : optionalText(40),
      nationality: changedFields.has('nationality')
        ? optionalNationality
        : optionalText(80),
      homePhone: changedFields.has('homePhone')
        ? optionalPhone
        : optionalNumberOrText,
      contactPersonNumber: changedFields.has('contactPersonNumber')
        ? optionalPhone
        : optionalNumberOrText,
      referrerMobile: changedFields.has('referrerMobile')
        ? optionalPhone
        : optionalNumberOrText,
      postalCode: changedFields.has('postalCode')
        ? optionalPostalCode
        : optionalNumberOrText,
    })
    .partial();
}

export const FATHER_GATED_FIELDS = [
  'fatherNric',
  'fatherMobile',
  'fatherNationality',
] as const;

export function buildFatherUpdateSchema(changedFields: ReadonlySet<string>) {
  return z.object({
    ...FatherUpdateSchema.shape,
    fatherNric: changedFields.has('fatherNric')
      ? optionalNric
      : optionalText(40),
    fatherMobile: changedFields.has('fatherMobile')
      ? optionalPhone
      : optionalNumberOrText,
    fatherNationality: changedFields.has('fatherNationality')
      ? optionalNationality
      : optionalText(80),
  });
}

export const MOTHER_GATED_FIELDS = [
  'motherNric',
  'motherMobile',
  'motherNationality',
] as const;

export function buildMotherUpdateSchema(changedFields: ReadonlySet<string>) {
  return z.object({
    ...MotherUpdateSchema.shape,
    motherNric: changedFields.has('motherNric')
      ? optionalNric
      : optionalText(40),
    motherMobile: changedFields.has('motherMobile')
      ? optionalPhone
      : optionalNumberOrText,
    motherNationality: changedFields.has('motherNationality')
      ? optionalNationality
      : optionalText(80),
  });
}

export const GUARDIAN_GATED_FIELDS = [
  'guardianNric',
  'guardianMobile',
  'guardianNationality',
] as const;

export function buildGuardianUpdateSchema(changedFields: ReadonlySet<string>) {
  return z.object({
    ...GuardianUpdateSchema.shape,
    guardianNric: changedFields.has('guardianNric')
      ? optionalNric
      : optionalText(40),
    guardianMobile: changedFields.has('guardianMobile')
      ? optionalPhone
      : optionalNumberOrText,
    guardianNationality: changedFields.has('guardianNationality')
      ? optionalNationality
      : optionalText(80),
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Status pipeline — one stage at a time. Each stage owns a status, remarks,
// and stage-specific extras (invoice, schedule, etc).
// ──────────────────────────────────────────────────────────────────────────

export const STAGE_KEYS = [
  'application',
  'registration',
  'documents',
  'assessment',
  'contract',
  'fees',
  'class',
  'supplies',
  'orientation',
] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

// Per-stage canonical status options. These came out of the Directus
// vocabulary the user pasted (Enrolled/Conditional/Finished/Incomplete/Signed
// /Invoiced/Rejected/Uploaded/Pending) plus the application pipeline statuses
// already defined in PIPELINE_STATUSES (lib/admissions/dashboard.ts).
//
// "Other / type your own" → free text via Other input. Admissions can request
// new canonical values during UAT.
// Canonical Directus dropdown values per stage, confirmed by the admissions
// team 2026-04-24. First value in each list is the initial state for a
// newly-submitted application. Legacy values that existed in earlier
// revisions (e.g. `Rejected` on contract, `Assigned` on class) are removed;
// EditStageDialog's "Other…" free-text escape hatch preserves the ability
// to edit rows holding those legacy values without losing them on save.
export const STAGE_STATUS_OPTIONS: Record<StageKey, readonly string[]> = {
  application: [
    'Submitted',
    'Ongoing Verification',
    'Processing',
    'Enrolled',
    'Enrolled (Conditional)',
    'Cancelled',
    'Withdrawn',
  ],
  registration: ['Pending', 'Unpaid', 'Finished', 'Cancelled'],
  documents: ['Pending', 'Verified', 'Incomplete', 'Finished', 'Cancelled'],
  assessment: ['Pending', 'Ongoing Assessment', 'Finished', 'Cancelled'],
  contract: ['Generated', 'Sent', 'Signed'],
  fees: ['Pending', 'Invoiced', 'Re-invoiced', 'Paid', 'Cancelled'],
  class: ['Pending', 'Incomplete', 'Finished', 'Cancelled'],
  supplies: ['Pending', 'Claimed', 'Cancelled'],
  orientation: ['Pending', 'Finished', 'Cancelled'],
} as const;

// ── What a stage needs before it can hold a given status ──────────────────
//
// WHY THIS KEYS ON (STAGE, STATUS) AND NOT ON STAGE ALONE. The fields a stage
// needs depend on where that stage has got to — Mr Ace: "the required fields
// are depending on the status selected" (Wynne, admin training session #1
// @24:43). Fees at 'Invoiced' needs an invoice number and nothing else; the
// same stage at 'Paid' needs the payment date too. A per-stage list could not
// express that without demanding a payment date the moment an invoice is sent.
//
// ENFORCED ON EVERY SAVE, NOT ONLY WHEN THE STATUS CHANGES. Many records
// already sit at a finished status with the fields behind it blank. Checking
// the row as it will stand AFTER the save — rather than only when someone
// moves the status — is what clears that backlog: each record gets completed
// the next time anyone touches it. This is the school's ask, not our
// invention. Mr Ace, explicit: "they requested the enforcement not us".
//
// PRESENCE ONLY. A field counts as filled when it is non-empty after trimming.
// No format checks, no ranges, no "is this date in the past" — those are a
// different job and belong wherever that job lives, not here.
//
// `class` IS DELIBERATELY ABSENT AND MUST STAY ABSENT. The class stage has no
// edit dialog, so no human could ever satisfy a rule on it. Its columns are
// written by the Enrolled flip and by the assign-section route, and enforcing
// classAY / classLevel / classSection against write paths that never set them
// would risk breaking section assignment in order to fix a blank field. Do not
// add a `class` rule.
//
// `documents`, `contract` and `orientation` carry no extra fields at all
// (STAGE_COLUMN_MAP[...].extras is []), so there is nothing to require on
// them. `documents` only becomes enforceable once the P-Files slots work
// lands and gives it something to point at.
//
// The `application` → terminalReason rule is ALSO enforced, more strictly, by
// validateTerminalReason below — which additionally checks the reason is one
// of the known values and demands notes when it is 'other'. The rule is
// restated here so this map is a complete statement of "what a status
// requires" and the UI can drive off one source. It does not replace
// validateTerminalReason, and neither one is redundant.
//
// Following isAdmissionsStageFrozen's precedent, this map is SHARED by the
// stage PATCH route (server enforcement) and the stage edit dialog (which
// disables save), so the two cannot drift.
//
// Outer key: the stage. Inner key: the status value. Value: the fieldKeys from
// STAGE_COLUMN_MAP[stage].extras that must be filled in at that status, in the
// order they should be read out to a person.
export type StageRequiredFieldsByStatus = Readonly<
  Record<string, readonly string[]>
>;

export const STAGE_STATUS_REQUIRED_FIELDS: Partial<
  Record<StageKey, StageRequiredFieldsByStatus>
> = {
  registration: {
    Finished: ['invoice', 'paymentDate'],
  },
  fees: {
    Invoiced: ['invoice'],
    'Re-invoiced': ['invoice'],
    Paid: ['invoice', 'paymentDate'],
  },
  assessment: {
    Finished: ['math', 'english'],
  },
  supplies: {
    Claimed: ['claimedDate'],
  },
  application: {
    Cancelled: ['terminalReason'],
    Withdrawn: ['terminalReason'],
  },
} as const;

/** One field a stage is missing before it may hold the status it is being
 *  saved with. */
export type StageCompletionBlocker = {
  /** fieldKey from STAGE_COLUMN_MAP[stage].extras */
  fieldKey: string;
  /** Human label from the same entry, e.g. 'Payment date' */
  label: string;
};

/**
 * Which required fields is this stage still missing? Pure — no I/O, no dates,
 * no randomness, and it never throws.
 *
 * The check is on the row as it will stand AFTER the save, so the caller has
 * to merge the incoming payload over the stored row and pass the result in as
 * `effectiveExtras`. This function does not read the database.
 *
 * An unrecognised status — including the edit dialog's free-text "Other…"
 * escape hatch — is not gated: we only know what the canonical statuses
 * require.
 */
export function findStageCompletionBlockers(
  stageKey: StageKey,
  /** The status the row will hold AFTER this save. */
  status: string | null | undefined,
  /** The extras the row will hold AFTER this save, keyed by fieldKey — the
   *  incoming payload merged over the stored row. Callers must merge; this
   *  function does not read the database. */
  effectiveExtras: Record<string, string | null | undefined>
): StageCompletionBlocker[] {
  const trimmed = (status ?? '').trim();
  if (!trimmed) return [];

  const required = STAGE_STATUS_REQUIRED_FIELDS[stageKey]?.[trimmed];
  if (!required || required.length === 0) return [];

  const extras = STAGE_COLUMN_MAP[stageKey]?.extras ?? [];
  const blockers: StageCompletionBlocker[] = [];

  for (const fieldKey of required) {
    const value = effectiveExtras?.[fieldKey];
    const filled = value != null && String(value).trim() !== '';
    if (filled) continue;
    // Fall back to the raw key rather than throwing if the map ever names a
    // field the column map doesn't carry — the guard test catches that case,
    // and a save is not the place to blow up over it.
    const label =
      extras.find((e) => e.fieldKey === fieldKey)?.label ?? fieldKey;
    blockers.push({ fieldKey, label });
  }

  return blockers;
}

/**
 * The refusal, in plain English, for both the server response and the dialog.
 * School admins are not IT, so this says what is missing and nothing about
 * validation, payloads or fields being required.
 *
 * Because the gate looks at the row as it will stand after the save, someone
 * editing only the Remarks on a record that was already incomplete sees this
 * too. The wording holds there: it describes the state of the record, not the
 * edit that was attempted.
 */
export function stageCompletionMessage(
  stageKey: StageKey,
  status: string,
  blockers: StageCompletionBlocker[]
): string {
  if (blockers.length === 0) return '';

  const names = blockers.map((b) => b.label);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? 'has' : 'have';

  return `${STAGE_LABELS[stageKey]} is set to ${status.trim()}, so ${list} ${verb} to be filled in first.`;
}

// The pre-enrolment, actively-in-flight subset of the application stage
// vocabulary above (STAGE_STATUS_OPTIONS.application minus the post-funnel
// values Enrolled / Enrolled (Conditional) and the terminals Cancelled /
// Withdrawn). This is the SINGLE definition of "in the applications funnel":
// the /admissions/applications list (and its early-bird sibling) server-
// filters to it, and the dashboard's "needs follow-up" count
// (getOutdatedApplications) + its 'outdated' drill scope to it — so the
// insight's number equals what its deep-link shows (count == drill, KD #124).
// Don't redeclare these strings locally; import this set.
export const ACTIVE_FUNNEL_STAGES = new Set<string>([
  'Submitted',
  'Ongoing Verification',
  'Processing',
]);

/** The exact funnel-membership predicate the applications list applies
 *  (trimmed; NULL/empty status → not in the funnel). Share it — every
 *  count/list pair that must agree on "in-flight application" reads this. */
export function isActiveFunnelStatus(
  status: string | null | undefined
): boolean {
  return ACTIVE_FUNNEL_STAGES.has((status ?? '').trim());
}

// Stages that must reach a "done" status before `applicationStatus` can be
// flipped to `Enrolled`. Enforced server-side in the stage PATCH route.
// `Enrolled (Conditional)` bypasses this gate (registrar override).
// `class` is deliberately excluded — it's auto-assigned as part of the
// Enrolled flip itself. `supplies` + `orientation` are post-enrollment
// activities, not prereqs.
export const ENROLLED_PREREQ_STAGES = [
  'registration',
  'documents',
  'assessment',
  'contract',
  'fees',
] as const satisfies readonly StageKey[];

// Terminal "done" value per prereq stage. Used by the Enrolled-flip gate.
export const STAGE_TERMINAL_STATUS: Partial<Record<StageKey, string>> = {
  registration: 'Finished',
  documents: 'Finished',
  assessment: 'Finished',
  contract: 'Signed',
  fees: 'Paid',
  // class gets 'Finished' set by the auto-assign algorithm, not a prereq.
};

// Module-ownership rule (KD #147): once a student is FULLY 'Enrolled', the
// admissions stage editor freezes — the funnel is historical. EXCEPTION:
// `supplies` + `orientation` legitimately happen AFTER enrolment (kit pickup,
// orientation day), so they stay editable post-Enrolled until they reach a
// FINALIZED status, after which they lock too (forward-only — a finalized step
// is never rewritten).
export const POST_ENROLMENT_EDITABLE_STAGES = [
  'supplies',
  'orientation',
] as const satisfies readonly StageKey[];

// The terminal/finalized statuses that lock a post-enrolment stage.
export const STAGE_FINALIZED_STATUSES: Partial<
  Record<StageKey, readonly string[]>
> = {
  supplies: ['Claimed', 'Cancelled'],
  orientation: ['Finished', 'Cancelled'],
};

// Is this admissions stage frozen for editing right now? SHARED by the stage
// PATCH route (server enforcement) and the enrollment-tab UI so they can't
// drift. Rules:
//   • not fully 'Enrolled' → nothing frozen (the funnel is still in progress;
//     'Enrolled (Conditional)' stays fully editable until it resolves);
//   • fully 'Enrolled' → every stage freezes EXCEPT supplies/orientation, which
//     stay editable until their OWN status is finalized.
export function isAdmissionsStageFrozen(
  stageKey: StageKey,
  currentStageStatus: string | null,
  applicationStatus: string | null
): boolean {
  if ((applicationStatus ?? '').trim() !== 'Enrolled') return false;
  if (
    !(POST_ENROLMENT_EDITABLE_STAGES as readonly StageKey[]).includes(stageKey)
  ) {
    return true;
  }
  return (STAGE_FINALIZED_STATUSES[stageKey] ?? []).includes(
    (currentStageStatus ?? '').trim()
  );
}

export const APPLICATION_TERMINAL_REASON_VALUES = [
  'chose_another_school',
  'visa_denied',
  'lost_interest',
  'financial',
  'family_relocation',
  'health',
  'other',
] as const;
export type ApplicationTerminalReason =
  (typeof APPLICATION_TERMINAL_REASON_VALUES)[number];

export const APPLICATION_TERMINAL_REASON_LABELS: Record<
  ApplicationTerminalReason,
  string
> = {
  chose_another_school: 'Chose another school',
  visa_denied: 'Pass / visa application denied',
  lost_interest: 'Lost interest / no response',
  financial: 'Financial reasons',
  family_relocation: 'Family relocating overseas',
  health: 'Health / personal',
  other: 'Other',
};

// Statuses on the application stage that require a terminal reason.
export const APPLICATION_TERMINAL_STATUSES = [
  'Cancelled',
  'Withdrawn',
] as const;

// Reason gate for cancelling / withdrawing an application. A terminal flip
// (Cancelled / Withdrawn) MUST carry a valid reason, and when the reason is
// 'other' it MUST carry notes. Shared by the stage PATCH route (server
// enforcement) and unit-tested directly, so the contract can't drift.
//   - ok: the gate passes
//   - { code: 'reason_required' }: missing/invalid reason
//   - { code: 'notes_required' }:  reason is 'other' but notes are blank
export type TerminalReasonGateResult =
  | { ok: true }
  | { ok: false; code: 'reason_required' | 'notes_required'; error: string };

export function validateTerminalReason(
  reason: string | null | undefined,
  notes: string | null | undefined
): TerminalReasonGateResult {
  if (
    !reason ||
    !(APPLICATION_TERMINAL_REASON_VALUES as readonly string[]).includes(reason)
  ) {
    return {
      ok: false,
      code: 'reason_required',
      error:
        'Reason is required when cancelling or withdrawing an application.',
    };
  }
  if (reason === 'other' && !notes?.trim()) {
    return {
      ok: false,
      code: 'notes_required',
      error: 'Notes are required when reason is "Other".',
    };
  }
  return { ok: true };
}

// ── The Enrolled flip (step 10) ──────────────────────────────────────────
//
// HFSE's admission process has Enrolment as step 10 and Class Assignment as
// step 11 — separate steps, done by different people (Student Affairs assign
// the class, "subject to a deliberation by Academics Team"). So a class is
// NOT required to enrol. See docs/context/admission-process.md.
//
// What IS required is that the five preceding stages are finished. That gate
// is unchanged and must stay that way: it is the definition of step 10.
//
// If the caller does supply a class — a convenience for a coordinator doing
// both jobs in one sitting — they must be allowed to assign classes. The
// `admissions` role may enrol but never places (KD #51), so it is refused
// here rather than silently accepted, which is what made the old code
// contradict its own role model.
//
// Note `Enrolled (Conditional)` never reaches this function — the route only
// calls it for plain 'Enrolled', so Conditional skips the prereq gate outright.
// Read the Disclaimer in docs/context/admission-process.md before touching
// that: conditional enrolment is an ASSESSMENT OUTCOME (step 8) — "did not
// pass the examination and/or with declaration" — not a paperwork override.
// The doc never equates it with ALN; ALN (step 8) is the trigger for Trial
// Classes, which the Disclaimer joins to conditional enrolment with "and/or",
// so the two overlap without being the same thing. Nothing in the process doc
// excuses a conditionally enrolled student from registration, documents,
// contract or fees, and the bypass currently does. See KD #180.
export type EnrolledFlipBlocker = {
  stage: string;
  current: string | null;
  expected: string;
};

export type EnrolledFlipGateResult =
  | { ok: true; assignsSection: boolean }
  | {
      ok: false;
      status: 403 | 422;
      code: 'prereqs_incomplete' | 'placement_forbidden' | 'no_student_number';
      error: string;
      blockers?: EnrolledFlipBlocker[];
    };

export function evaluateEnrolledFlip(input: {
  /** True when the actor's role may place students — `canAssignSection`. */
  canAssignSection: boolean;
  /** The registrar's chosen section, if they picked one. Optional by design. */
  sectionId: string | null | undefined;
  /** Current value of each prereq stage's status column, keyed by stage. */
  prereqStatuses: Record<string, string | null>;
  /**
   * The applicant's student number. Only consulted when a section is being
   * assigned: without it `syncOneStudent` silently skips, which would leave
   * an Enrolled row holding a class it never reached the roster with. With no
   * section there is nothing to guarantee — the student is legitimately
   * unplaced, and a missing number is already surfaced as the
   * `no_student_number` gap in the students-needing-setup queue.
   */
  studentNumber: string | null | undefined;
}): EnrolledFlipGateResult {
  const { canAssignSection, sectionId, prereqStatuses, studentNumber } = input;

  const blockers: EnrolledFlipBlocker[] = [];
  for (const stage of ENROLLED_PREREQ_STAGES) {
    const expected = STAGE_TERMINAL_STATUS[stage]!;
    const current = prereqStatuses[stage] ?? null;
    if (current !== expected) {
      blockers.push({ stage: STAGE_LABELS[stage], current, expected });
    }
  }
  if (blockers.length > 0) {
    return {
      ok: false,
      status: 422,
      code: 'prereqs_incomplete',
      error: 'Prerequisite stages incomplete',
      blockers,
    };
  }

  const wantsSection = !!sectionId;
  if (!wantsSection) return { ok: true, assignsSection: false };

  if (!canAssignSection) {
    return {
      ok: false,
      status: 403,
      code: 'placement_forbidden',
      error:
        'Class assignment is handled by Records. Enrol this student now and they will appear under Students awaiting class assignment.',
    };
  }

  if (!studentNumber) {
    return {
      ok: false,
      status: 422,
      code: 'no_student_number',
      error:
        'This applicant has no Student Number on file, so they cannot be added to a class roster yet. Student numbers are issued at parent-portal submission alongside the enrolee number — contact admissions support to assign one, or enrol without a class for now.',
    };
  }

  return { ok: true, assignsSection: true };
}

// Each stage maps to status / remarks / extras column names on enrolment_status.
// The route reads this map to know which columns to write.
export type StageColumns = {
  statusCol: string;
  remarksCol: string;
  updatedDateCol: string;
  updatedByCol: string;
  // Stage-specific columns (invoice / schedule / payment date / etc).
  // Each entry: { fieldKey, columnName, kind ('text' | 'date') }
  extras: Array<{
    fieldKey: string;
    columnName: string;
    kind: 'text' | 'date';
    label: string;
  }>;
};

export const STAGE_COLUMN_MAP: Record<StageKey, StageColumns> = {
  application: {
    statusCol: 'applicationStatus',
    remarksCol: 'applicationRemarks',
    updatedDateCol: 'applicationUpdatedDate',
    updatedByCol: 'applicationUpdatedBy',
    extras: [
      {
        fieldKey: 'terminalReason',
        columnName: 'applicationTerminalReason',
        kind: 'text' as const,
        label: 'Reason',
      },
      {
        fieldKey: 'terminalNotes',
        columnName: 'applicationTerminalNotes',
        kind: 'text' as const,
        label: 'Notes',
      },
    ],
  },
  // Non-camelCase oddities below are the ACTUAL production column names on
  // `ay{YYYY}_enrolment_status` (see docs/context/10a-parent-portal-ddl.md
  // and migrations 012/025/026). Do not "fix" these to look consistent —
  // they match the parent-portal schema as frozen. Notably:
  //   - `registrationUpdateDate` has no "d" in "Updated"
  //   - All stages except `application` have lowercase "by" on *UpdatedBy
  //   - `orientationUpdateby` drops BOTH the "d" and the capital "B"
  registration: {
    statusCol: 'registrationStatus',
    remarksCol: 'registrationRemarks',
    updatedDateCol: 'registrationUpdateDate',
    updatedByCol: 'registrationUpdatedby',
    extras: [
      {
        fieldKey: 'invoice',
        columnName: 'registrationInvoice',
        kind: 'text',
        label: 'Invoice',
      },
      {
        fieldKey: 'paymentDate',
        columnName: 'registrationPaymentDate',
        kind: 'date',
        label: 'Payment date',
      },
    ],
  },
  documents: {
    statusCol: 'documentStatus',
    remarksCol: 'documentRemarks',
    updatedDateCol: 'documentUpdatedDate',
    updatedByCol: 'documentUpdatedby',
    extras: [],
  },
  assessment: {
    statusCol: 'assessmentStatus',
    remarksCol: 'assessmentRemarks',
    updatedDateCol: 'assessmentUpdatedDate',
    updatedByCol: 'assessmentUpdatedby',
    extras: [
      {
        fieldKey: 'schedule',
        columnName: 'assessmentSchedule',
        kind: 'date',
        label: 'Schedule',
      },
      {
        fieldKey: 'math',
        columnName: 'assessmentGradeMath',
        kind: 'text',
        label: 'Math grade',
      },
      {
        fieldKey: 'english',
        columnName: 'assessmentGradeEnglish',
        kind: 'text',
        label: 'English grade',
      },
      {
        fieldKey: 'medical',
        columnName: 'assessmentMedical',
        kind: 'text',
        label: 'Medical',
      },
    ],
  },
  contract: {
    statusCol: 'contractStatus',
    remarksCol: 'contractRemarks',
    updatedDateCol: 'contractUpdatedDate',
    updatedByCol: 'contractUpdatedby',
    extras: [],
  },
  fees: {
    statusCol: 'feeStatus',
    remarksCol: 'feeRemarks',
    updatedDateCol: 'feeUpdatedDate',
    updatedByCol: 'feeUpdatedby',
    extras: [
      {
        fieldKey: 'invoice',
        columnName: 'feeInvoice',
        kind: 'text',
        label: 'Invoice',
      },
      {
        fieldKey: 'paymentDate',
        columnName: 'feePaymentDate',
        kind: 'date',
        label: 'Payment date',
      },
      {
        fieldKey: 'startDate',
        columnName: 'feeStartDate',
        kind: 'date',
        label: 'Start date',
      },
    ],
  },
  class: {
    statusCol: 'classStatus',
    remarksCol: 'classRemarks',
    updatedDateCol: 'classUpdatedDate',
    updatedByCol: 'classUpdatedby',
    extras: [
      {
        fieldKey: 'classAY',
        columnName: 'classAY',
        kind: 'text',
        label: 'Class AY',
      },
      {
        fieldKey: 'classLevel',
        columnName: 'classLevel',
        kind: 'text',
        label: 'Level',
      },
      {
        fieldKey: 'classSection',
        columnName: 'classSection',
        kind: 'text',
        label: 'Section',
      },
    ],
  },
  supplies: {
    statusCol: 'suppliesStatus',
    remarksCol: 'suppliesRemarks',
    updatedDateCol: 'suppliesUpdatedDate',
    updatedByCol: 'suppliesUpdatedby',
    extras: [
      {
        fieldKey: 'claimedDate',
        columnName: 'suppliesClaimedDate',
        kind: 'date',
        label: 'Claimed date',
      },
    ],
  },
  orientation: {
    statusCol: 'orientationStatus',
    remarksCol: 'orientationRemarks',
    updatedDateCol: 'orientationUpdatedDate',
    updatedByCol: 'orientationUpdateby',
    extras: [
      {
        fieldKey: 'scheduleDate',
        columnName: 'orientationScheduleDate',
        kind: 'date',
        label: 'Schedule date',
      },
    ],
  },
};

export const STAGE_LABELS: Record<StageKey, string> = {
  application: 'Application',
  registration: 'Registration',
  documents: 'Documents',
  assessment: 'Assessment',
  contract: 'Contract',
  fees: 'Fees',
  class: 'Class assignment',
  supplies: 'Supplies',
  orientation: 'Orientation',
};

// One stage update payload. `status` may be empty (clear back to null).
// `extras` keys must match the fieldKey list in STAGE_COLUMN_MAP for the
// stage; the route enforces this.
export const StageUpdateSchema = z.object({
  status: optionalText(120),
  remarks: optionalText(4000),
  extras: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  /** Registrar-chosen section id — required only when flipping the
   *  `application` stage to `Enrolled` (validated in the route, not here,
   *  since the requirement is conditional on stageKey + status). */
  section_id: z.string().uuid().optional(),
});

export type StageUpdateInput = z.infer<typeof StageUpdateSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Phase 3 — Discount code catalogue (ay{YY}_discount_codes)
// ──────────────────────────────────────────────────────────────────────────

// Eligibility filter used by the enrolment portal when matching a student
// to available codes. "New" = no prior enrolment record; "Current" = existing
// record re-enrolling to a new grade level; "Both" = either. VizSchool variants
// are the equivalents for the VizSchool admissions stream.
export const DISCOUNT_ENROLEE_TYPES = [
  'New',
  'Current',
  'Both',
  'VizSchool New',
  'VizSchool Current',
  'VizSchool Both',
] as const;

export type DiscountEnroleeType = (typeof DISCOUNT_ENROLEE_TYPES)[number];

// Required non-empty trimmed text. Distinct from optionalText, which allows
// empty→null.
const requiredText = (max = 120) =>
  z.string().trim().min(1, 'Required').max(max);

export const DiscountCodeSchema = z
  .object({
    discountCode: requiredText(60),
    enroleeType: z.enum(DISCOUNT_ENROLEE_TYPES),
    startDate: optionalDate,
    endDate: optionalDate,
    details: optionalText(2000),
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

export type DiscountCodeInput = z.infer<typeof DiscountCodeSchema>;

// Partial variant for PATCH — no refinement (re-validated in the route
// against the merged before+after row).
export const DiscountCodePatchSchema = z.object({
  discountCode: requiredText(60).optional(),
  enroleeType: z.enum(DISCOUNT_ENROLEE_TYPES).optional(),
  startDate: optionalDate.optional(),
  endDate: optionalDate.optional(),
  details: optionalText(2000).optional(),
});

export type DiscountCodePatchInput = z.infer<typeof DiscountCodePatchSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Phase 3 — Document validation (approve / reject)
// ──────────────────────────────────────────────────────────────────────────

// Discriminated on `status`. 'Valid' needs nothing else; 'Rejected' requires
// a 20-char-min reason so the parent gets actionable feedback on re-upload.
// Mirrors the justification rule on grade-change requests (Sprint 9).
export const DocumentValidationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('Valid') }),
  z.object({
    status: z.literal('Rejected'),
    rejectionReason: z
      .string()
      .trim()
      .min(20, 'Please explain in at least 20 characters')
      .max(2000, 'Keep this under 2000 characters'),
  }),
]);

export type DocumentValidationInput = z.infer<typeof DocumentValidationSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Compassionate-leave allowance override
// ──────────────────────────────────────────────────────────────────────────
//
// Edits students.urgent_compassionate_allowance (grading schema, keyed by
// studentNumber). Default 5 days/year per HFSE policy. Admin can bump for
// medical carve-outs. Upper bound 30 is sanity — no real HFSE policy.

export const AllowanceSchema = z.object({
  allowance: z.number().int().min(0).max(30),
});

export type AllowanceInput = z.infer<typeof AllowanceSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Vacation-leave allowance override (KD #94)
// ──────────────────────────────────────────────────────────────────────────
//
// Edits students.vacation_leave_allowance_per_term. NULL clears the override
// — the student falls back to school_config.default_vl_allowance_per_term
// (HFSE policy: 1 per term). Upper bound 10 is sanity.

export const VlAllowanceSchema = z.object({
  vlAllowance: z.number().int().min(0).max(10).nullable(),
});

export type VlAllowanceInput = z.infer<typeof VlAllowanceSchema>;

// ──────────────────────────────────────────────────────────────────────────
// House assignment (migration 110)
// ──────────────────────────────────────────────────────────────────────────
//
// Edits students.house_id. NULL clears the assignment ("not in a house yet"),
// which is a real state — a newly enrolled student has no house until someone
// puts them in one.

export const HouseAssignmentSchema = z.object({
  houseId: z.string().uuid().nullable(),
});

export type HouseAssignmentInput = z.infer<typeof HouseAssignmentSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Residence history (ICA STP requirement — past 5 years per applicant)
// ──────────────────────────────────────────────────────────────────────────
//
// Written to `ay{YY}_enrolment_applications.residenceHistory` (jsonb).
// PATCH /api/sis/students/[enroleeNumber]/residence-history accepts null
// (clear) or an array of up to 20 entries. Per KD #23 zod pattern.

export const ResidenceEntrySchema = z.object({
  fromYear: z.number().int().min(1900).max(2100),
  toYear: z.number().int().min(1900).max(2100),
  country: z.string().min(1).max(100),
  cityOrTown: z.string().min(1).max(100),
  purposeOfStay: z.string().max(200).optional(),
});

export const ResidenceHistorySchema = z
  .array(ResidenceEntrySchema)
  .max(20)
  .nullable();

export type ResidenceEntry = z.infer<typeof ResidenceEntrySchema>;
export type ResidenceHistory = z.infer<typeof ResidenceHistorySchema>;
