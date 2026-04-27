import { z } from 'zod';

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
export type EnroleeCategory = (typeof ENROLEE_CATEGORIES)[number];

export const ProfileUpdateSchema = z.object({
  // Names — all optional (some students have only a first/last)
  firstName:      optionalText(120),
  middleName:     optionalText(120),
  lastName:       optionalText(120),
  preferredName:  optionalText(120),
  enroleeFullName: optionalText(240),
  // Identity
  category:       z.enum(ENROLEE_CATEGORIES).nullable().optional(),
  nric:           optionalText(40),
  birthDay:       optionalDate,
  gender:         optionalText(40),
  nationality:    optionalText(80),
  primaryLanguage: optionalText(80),
  religion:       optionalText(80),
  religionOther:  optionalText(120),
  // Travel docs (also editable in P-Files for non-staff workflows; SIS keeps
  // them in sync via the same column writes — Key Decision #34 still applies.)
  passportNumber: optionalText(40),
  passportExpiry: optionalDate,
  pass:           optionalText(60),
  passExpiry:     optionalDate,
  // Contact
  homePhone:           optionalText(60),
  homeAddress:         optionalText(500),
  postalCode:          optionalText(20),
  livingWithWhom:      optionalText(120),
  contactPerson:       optionalText(120),
  contactPersonNumber: optionalText(60),
  parentMaritalStatus: optionalText(60),
  // Application preferences
  levelApplied:             optionalText(80),
  preferredSchedule:        optionalText(80),
  classType:                optionalText(80),
  paymentOption:            optionalText(80),
  availSchoolBus:           optionalBool,
  availStudentCare:         optionalBool,
  studentCareProgram:       optionalText(120),
  availUniform:             optionalBool,
  additionalLearningNeeds:  optionalText(2000),
  otherLearningNeeds:       optionalText(2000),
  previousSchool:           optionalText(240),
  howDidYouKnowAboutHFSEIS: optionalText(120),
  otherSource:              optionalText(240),
  referrerName:             optionalText(120),
  referrerMobile:           optionalText(60),
  contractSignatory:        optionalText(120),
  // Discount slots — these are codes; the future enrolment_discounts table
  // (Phase 3) is the per-student grant ledger
  discount1: optionalText(60),
  discount2: optionalText(60),
  discount3: optionalText(60),
});

export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;

// Field labels for the audit log "changes" diff. Keep in sync with the
// schema — anything missing here renders the raw column name in the audit.
export const PROFILE_FIELD_LABELS: Partial<Record<keyof ProfileUpdateInput, string>> = {
  firstName: 'First name',
  middleName: 'Middle name',
  lastName: 'Last name',
  preferredName: 'Preferred name',
  enroleeFullName: 'Full name',
  category: 'Category',
  nric: 'NRIC / FIN',
  birthDay: 'Date of birth',
  gender: 'Gender',
  nationality: 'Nationality',
  primaryLanguage: 'Primary language',
  religion: 'Religion',
  religionOther: 'Religion (other)',
  passportNumber: 'Passport number',
  passportExpiry: 'Passport expiry',
  pass: 'Pass type',
  passExpiry: 'Pass expiry',
  homePhone: 'Home phone',
  homeAddress: 'Home address',
  postalCode: 'Postal code',
  livingWithWhom: 'Living with',
  contactPerson: 'Contact person',
  contactPersonNumber: 'Contact number',
  parentMaritalStatus: 'Parent marital status',
  levelApplied: 'Level applied',
  preferredSchedule: 'Preferred schedule',
  classType: 'Class type',
  paymentOption: 'Payment option',
  availSchoolBus: 'School bus',
  availStudentCare: 'Student care',
  studentCareProgram: 'Student care program',
  availUniform: 'Uniform',
  additionalLearningNeeds: 'Additional learning needs',
  otherLearningNeeds: 'Other learning needs',
  previousSchool: 'Previous school',
  howDidYouKnowAboutHFSEIS: 'Referral source',
  otherSource: 'Other source',
  referrerName: 'Referrer name',
  referrerMobile: 'Referrer mobile',
  contractSignatory: 'Contract signatory',
  discount1: 'Discount 1',
  discount2: 'Discount 2',
  discount3: 'Discount 3',
};

// ──────────────────────────────────────────────────────────────────────────
// Family — father / mother / guardian. One schema per parent slot.
// ──────────────────────────────────────────────────────────────────────────

export const PARENT_SLOTS = ['father', 'mother', 'guardian'] as const;
export type ParentSlot = (typeof PARENT_SLOTS)[number];

const optionalEmail = z
  .string()
  .trim()
  .transform((s) => (s.length === 0 ? null : s))
  .refine((s) => s === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), {
    message: 'Enter a valid email',
  })
  .nullable();

// Father has the largest field set (also serves mother/guardian via re-use).
export const FatherUpdateSchema = z.object({
  fatherFullName:           optionalText(240),
  fatherFirstName:          optionalText(120),
  fatherLastName:           optionalText(120),
  fatherNric:               optionalText(40),
  fatherBirthDay:           optionalDate,
  fatherMobile:             optionalText(60),
  fatherEmail:              optionalEmail,
  fatherNationality:        optionalText(80),
  fatherCompanyName:        optionalText(240),
  fatherPosition:           optionalText(120),
  fatherPassport:           optionalText(40),
  fatherPassportExpiry:     optionalDate,
  fatherPass:               optionalText(60),
  fatherPassExpiry:         optionalDate,
  fatherWhatsappTeamsConsent: optionalBool,
});

export const MotherUpdateSchema = z.object({
  motherFullName:           optionalText(240),
  motherFirstName:          optionalText(120),
  motherLastName:           optionalText(120),
  motherNric:               optionalText(40),
  motherBirthDay:           optionalDate,
  motherMobile:             optionalText(60),
  motherEmail:              optionalEmail,
  motherNationality:        optionalText(80),
  motherCompanyName:        optionalText(240),
  motherPosition:           optionalText(120),
  motherPassport:           optionalText(40),
  motherPassportExpiry:     optionalDate,
  motherPass:               optionalText(60),
  motherPassExpiry:         optionalDate,
  motherWhatsappTeamsConsent: optionalBool,
});

export const GuardianUpdateSchema = z.object({
  guardianFullName:           optionalText(240),
  guardianMobile:             optionalText(60),
  guardianEmail:              optionalEmail,
  guardianNationality:        optionalText(80),
  guardianPassport:           optionalText(40),
  guardianPassportExpiry:     optionalDate,
  guardianPass:               optionalText(60),
  guardianPassExpiry:         optionalDate,
  guardianWhatsappTeamsConsent: optionalBool,
});

export type FatherUpdateInput   = z.infer<typeof FatherUpdateSchema>;
export type MotherUpdateInput   = z.infer<typeof MotherUpdateSchema>;
export type GuardianUpdateInput = z.infer<typeof GuardianUpdateSchema>;

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
  application:  ['Submitted', 'Ongoing Verification', 'Processing', 'Enrolled', 'Enrolled (Conditional)', 'Cancelled', 'Withdrawn'],
  registration: ['Pending', 'Unpaid', 'Finished', 'Cancelled'],
  documents:    ['Pending', 'Verified', 'Incomplete', 'Finished', 'Cancelled'],
  assessment:   ['Pending', 'Ongoing Assessment', 'Finished', 'Cancelled'],
  contract:     ['Generated', 'Sent', 'Signed'],
  fees:         ['Pending', 'Invoiced', 'Re-invoiced', 'Paid', 'Cancelled'],
  class:        ['Pending', 'Incomplete', 'Finished', 'Cancelled'],
  supplies:     ['Pending', 'Claimed', 'Cancelled'],
  orientation:  ['Pending', 'Finished', 'Cancelled'],
} as const;

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
  documents:    'Finished',
  assessment:   'Finished',
  contract:     'Signed',
  fees:         'Paid',
  // class gets 'Finished' set by the auto-assign algorithm, not a prereq.
};

// Each stage maps to status / remarks / extras column names on enrolment_status.
// The route reads this map to know which columns to write.
export type StageColumns = {
  statusCol: string;
  remarksCol: string;
  updatedDateCol: string;
  updatedByCol: string;
  // Stage-specific columns (invoice / schedule / payment date / etc).
  // Each entry: { fieldKey, columnName, kind ('text' | 'date') }
  extras: Array<{ fieldKey: string; columnName: string; kind: 'text' | 'date'; label: string }>;
};

export const STAGE_COLUMN_MAP: Record<StageKey, StageColumns> = {
  application: {
    statusCol: 'applicationStatus', remarksCol: 'applicationRemarks',
    updatedDateCol: 'applicationUpdatedDate', updatedByCol: 'applicationUpdatedBy',
    extras: [],
  },
  // Non-camelCase oddities below are the ACTUAL production column names on
  // `ay{YYYY}_enrolment_status` (see docs/context/10a-parent-portal-ddl.md
  // and migrations 012/025/026). Do not "fix" these to look consistent —
  // they match the parent-portal schema as frozen. Notably:
  //   - `registrationUpdateDate` has no "d" in "Updated"
  //   - All stages except `application` have lowercase "by" on *UpdatedBy
  //   - `orientationUpdateby` drops BOTH the "d" and the capital "B"
  registration: {
    statusCol: 'registrationStatus', remarksCol: 'registrationRemarks',
    updatedDateCol: 'registrationUpdateDate', updatedByCol: 'registrationUpdatedby',
    extras: [
      { fieldKey: 'invoice',     columnName: 'registrationInvoice',     kind: 'text', label: 'Invoice' },
      { fieldKey: 'paymentDate', columnName: 'registrationPaymentDate', kind: 'date', label: 'Payment date' },
    ],
  },
  documents: {
    statusCol: 'documentStatus', remarksCol: 'documentRemarks',
    updatedDateCol: 'documentUpdatedDate', updatedByCol: 'documentUpdatedby',
    extras: [],
  },
  assessment: {
    statusCol: 'assessmentStatus', remarksCol: 'assessmentRemarks',
    updatedDateCol: 'assessmentUpdatedDate', updatedByCol: 'assessmentUpdatedby',
    extras: [
      { fieldKey: 'schedule', columnName: 'assessmentSchedule',      kind: 'date', label: 'Schedule' },
      { fieldKey: 'math',     columnName: 'assessmentGradeMath',     kind: 'text', label: 'Math grade' },
      { fieldKey: 'english',  columnName: 'assessmentGradeEnglish',  kind: 'text', label: 'English grade' },
      { fieldKey: 'medical',  columnName: 'assessmentMedical',       kind: 'text', label: 'Medical' },
    ],
  },
  contract: {
    statusCol: 'contractStatus', remarksCol: 'contractRemarks',
    updatedDateCol: 'contractUpdatedDate', updatedByCol: 'contractUpdatedby',
    extras: [],
  },
  fees: {
    statusCol: 'feeStatus', remarksCol: 'feeRemarks',
    updatedDateCol: 'feeUpdatedDate', updatedByCol: 'feeUpdatedby',
    extras: [
      { fieldKey: 'invoice',     columnName: 'feeInvoice',     kind: 'text', label: 'Invoice' },
      { fieldKey: 'paymentDate', columnName: 'feePaymentDate', kind: 'date', label: 'Payment date' },
      { fieldKey: 'startDate',   columnName: 'feeStartDate',   kind: 'date', label: 'Start date' },
    ],
  },
  class: {
    statusCol: 'classStatus', remarksCol: 'classRemarks',
    updatedDateCol: 'classUpdatedDate', updatedByCol: 'classUpdatedby',
    extras: [
      { fieldKey: 'classAY',      columnName: 'classAY',      kind: 'text', label: 'Class AY' },
      { fieldKey: 'classLevel',   columnName: 'classLevel',   kind: 'text', label: 'Level' },
      { fieldKey: 'classSection', columnName: 'classSection', kind: 'text', label: 'Section' },
    ],
  },
  supplies: {
    statusCol: 'suppliesStatus', remarksCol: 'suppliesRemarks',
    updatedDateCol: 'suppliesUpdatedDate', updatedByCol: 'suppliesUpdatedby',
    extras: [
      { fieldKey: 'claimedDate', columnName: 'suppliesClaimedDate', kind: 'date', label: 'Claimed date' },
    ],
  },
  orientation: {
    statusCol: 'orientationStatus', remarksCol: 'orientationRemarks',
    updatedDateCol: 'orientationUpdatedDate', updatedByCol: 'orientationUpdateby',
    extras: [
      { fieldKey: 'scheduleDate', columnName: 'orientationScheduleDate', kind: 'date', label: 'Schedule date' },
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
  .refine(
    (v) => !v.startDate || !v.endDate || v.startDate <= v.endDate,
    { message: 'End date must be on or after start date', path: ['endDate'] },
  );

export type DiscountCodeInput = z.infer<typeof DiscountCodeSchema>;

// Partial variant for PATCH — no refinement (re-validated in the route
// against the merged before+after row).
export const DiscountCodePatchSchema = z
  .object({
    discountCode: requiredText(60).optional(),
    enroleeType: z.enum(DISCOUNT_ENROLEE_TYPES).optional(),
    startDate: optionalDate.optional(),
    endDate: optionalDate.optional(),
    details: optionalText(2000).optional(),
  });

export type DiscountCodePatchInput = z.infer<typeof DiscountCodePatchSchema>;

export const DISCOUNT_CODE_FIELD_LABELS: Partial<Record<keyof DiscountCodeInput, string>> = {
  discountCode: 'Code',
  enroleeType: 'Eligibility',
  startDate: 'Start date',
  endDate: 'End date',
  details: 'Details',
};

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
