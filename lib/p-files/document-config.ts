// Static configuration for the document slots tracked per student (post KD #96).
// Each slot maps to columns in `ay{YY}_enrolment_documents`:
//   {key}        — URL (text, nullable)
//   {key}Status  — status string (varchar, nullable)
//   {key}Expiry  — expiry date (date, nullable) — only for expiring docs
//
// The 3 ICA-side STP document slots (icaPhoto, financialSupportDocs,
// vaccinationInformation) were removed in KD #96 — parents upload those
// directly on the Singapore ICA website; the school never receives them.
// The STP *application* workflow (stpApplicationType / stpApplicationStatus)
// is still tracked; only the document slots are gone.

/**
 * Which family a document slot belongs to. Three of these are documents the
 * FAMILY supplies; `school` is the one the school produces and holds itself.
 *
 * That distinction is not presentational. Everything in P-Files that chases a
 * parent — the Action Queue, "N documents need attention", the reminder mail,
 * the promised-date flow — is a worklist of things to ask a family for. A
 * school form has no family to ask, so it belongs in none of them. Ask
 * `isChaseableGroup` rather than testing the group value inline.
 */
export type DocumentGroup =
  | 'student'
  | 'student-expiring'
  | 'parent'
  | 'school';

/**
 * Can a missing document in this group legitimately be chased from a parent?
 *
 * `school` documents are uploaded by staff who hold `documents_*.upload`, and
 * are
 * never offered by the parent portal, so a reminder about one is noise at
 * best. This is the ONE definition — the queue, the counts and the buttons all
 * read it, so a fifth group can never be added to a chase surface by accident.
 */
export function isChaseableGroup(group: DocumentGroup): boolean {
  return group !== 'school';
}

/**
 * For expiring document slots, describes which columns in
 * `enrolment_applications` hold the document number/type and expiry date.
 */
export type SlotMeta = {
  kind: 'passport' | 'pass';
  /** Column in enrolment_applications for passport number or pass type */
  numberCol: string;
  /** Column in enrolment_applications for the expiry date */
  expiryCol: string;
};

/**
 * When a slot only applies to *some* students, `conditional` says how to
 * decide. Every consumer must ask that question through `isSlotApplicable`
 * below rather than reading the shape inline — the whole point of the union
 * is that a new condition kind lands in one place instead of six.
 *
 *  - `filled`       — the named column on the applications row is non-empty
 *                     (the original behaviour: fatherEmail / guardianEmail).
 *  - `equals`       — the named column equals an exact value, e.g.
 *                     applicationStatus === 'Enrolled (Conditional)'.
 *  - `lateEnrollee` — the student joined after the year started. This does
 *                     NOT live on the applications row at all; it is
 *                     `section_students.enrollment_status === 'late_enrollee'`
 *                     (see `ENROLLED_STATUSES` in lib/schemas/enrolment.ts),
 *                     so it arrives as a separate fact, not a column read.
 *  - `category`     — the student's enrolee category is one of `values`.
 *                     See `resolveCategory` for which column that reads.
 */
export type SlotCondition =
  | { kind: 'filled'; column: string }
  | { kind: 'equals'; column: string; value: string }
  | { kind: 'lateEnrollee' }
  | { kind: 'category'; values: readonly string[] };

/**
 * The enrolee categories that mean "this child is new to the school", and
 * the ones that mean "this child was already here last year".
 *
 * These are the four values of `ENROLEE_CATEGORIES` in lib/schemas/sis.ts,
 * split in two. They are repeated as plain strings rather than imported so
 * that this module — which every P-Files and Records surface pulls in,
 * client bundles included — keeps no dependency on the schema layer.
 * `__tests__/p-files/document-slots.test.ts` asserts the two lists together
 * are exactly ENROLEE_CATEGORIES, so a typo or a fifth category cannot drift
 * past unnoticed.
 *
 * Mr Ace, 2026-09-16, confirming the VizSchool pair follow their namesakes:
 * "#1 yes, for now".
 */
export const NEW_CATEGORIES = ['New', 'VizSchool New'] as const;
export const CURRENT_CATEGORIES = ['Current', 'VizSchool Current'] as const;

/**
 * Everything `isSlotApplicable` is allowed to look at.
 *
 * `app` is whatever row-ish bag the caller has in hand — usually the
 * applications row, optionally with a column or two merged in from the
 * enrolment_status row. A column that isn't there simply reads as empty;
 * the evaluator never reaches back to the database.
 */
export type SlotFacts = {
  app: Record<string, unknown> | null | undefined;
  /**
   * Whether this student is a late enrollee. Deliberately optional and
   * deliberately tri-state: `undefined` means the caller could not tell,
   * and that resolves to NOT applicable. Hiding is the safe direction — a
   * slot that isn't shown is merely invisible, whereas a slot we falsely
   * require makes every ordinary student read as permanently incomplete on
   * every completeness figure in the app.
   */
  isLateEnrollee?: boolean;
};

export type DocumentSlot = {
  key: string;
  label: string;
  expires: boolean;
  group: DocumentGroup;
  /** null = always applicable. Otherwise see `SlotCondition` / `isSlotApplicable`. */
  conditional: SlotCondition | null;
  /** Metadata columns in enrolment_applications for expiring docs, null for non-expiring */
  meta: SlotMeta | null;
};

/** Read one column off the facts bag as a trimmed string. Total: a missing
 *  row, a missing column, null, or a non-scalar value all read as ''. */
function factColumn(
  app: Record<string, unknown> | null | undefined,
  column: string
): string {
  if (!app) return '';
  const v = app[column];
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  return '';
}

/**
 * The student's enrolee category, read from whichever of the two columns the
 * caller actually has.
 *
 * THE SAME FACT IS STORED TWICE and the copies do not agree. `category` lives
 * on the APPLICATIONS row; `enroleeType` lives on the enrolment STATUS row.
 * lib/schemas/sis.ts claims they "always agree" — measured against production
 * on 2026-09-16 (`scripts/audit-document-needs-by-category.ts`) they disagree
 * on 241 of 828 AY2025 rows, 4 of 495 AY2026 rows and 3 of 290 AY2027 rows,
 * and `category` is BLANK for 232 AY2025 students where `enroleeType` is
 * filled.
 *
 * ⚠ `category` IS READ FIRST BECAUSE IT IS THE ONLY ONE A HUMAN CAN CHANGE.
 * The Category field on the Records profile sheet writes `category`
 * (`components/sis/edit-profile-sheet.tsx`); NO screen in this app writes
 * `enroleeType`. Preferring the status copy — which is what the first version
 * of this did, by analogy with the enrolment-stage rule in CLAUDE.md — meant a
 * registrar could correct a mis-tagged child in Records and the five New-only
 * school forms would still not appear, with no way to fix it anywhere in the
 * product. A gate the office cannot correct is worse than one keyed on the
 * slightly-staler column.
 *
 * `enroleeType` is the fallback, which is what covers those 232 AY2025
 * students and any caller that loads only the status row.
 */
export function resolveCategory(
  app: Record<string, unknown> | null | undefined
): string {
  return factColumn(app, 'category') || factColumn(app, 'enroleeType');
}

/**
 * The one place that decides whether a document slot applies to a student.
 *
 * Pure, and never throws — callers feed it half-populated rows from six
 * different queries and a thrown error there would take out a dashboard.
 */
export function isSlotApplicable(
  slot: Pick<DocumentSlot, 'conditional'>,
  facts: SlotFacts
): boolean {
  const condition = slot.conditional;
  if (!condition) return true;

  switch (condition.kind) {
    case 'filled':
      return factColumn(facts.app, condition.column).length > 0;
    case 'equals':
      return factColumn(facts.app, condition.column) === condition.value;
    case 'lateEnrollee':
      // `undefined` (caller can't tell) => not applicable. See SlotFacts.
      return facts.isLateEnrollee === true;
    case 'category': {
      // A blank category reads as "cannot tell", and hides — same safe
      // direction as every other condition here. Production carries no blank
      // category at all in AY2026, and 9 of 828 in AY2025.
      const category = resolveCategory(facts.app);
      if (!category) return false;
      return condition.values.includes(category);
    }
  }
}

/** Fixed options for the pass-type dropdown. */
export const PASS_TYPES = [
  'Student Pass',
  "Dependant's Pass",
  'Employment Pass',
  'Long-Term Visit Pass',
  'Work Permit',
  'Permanent Resident',
] as const;

export const DOCUMENT_SLOTS: DocumentSlot[] = [
  // Non-expiring (student's own)
  {
    key: 'idPicture',
    label: 'ID Picture',
    expires: false,
    group: 'student',
    conditional: null,
    meta: null,
  },
  {
    key: 'birthCert',
    label: 'Birth Certificate',
    expires: false,
    group: 'student',
    conditional: null,
    meta: null,
  },
  {
    key: 'educCert',
    label: 'Education Certificate',
    expires: false,
    group: 'student',
    conditional: null,
    meta: null,
  },
  {
    key: 'medical',
    label: 'Medical Exam',
    expires: false,
    group: 'student',
    conditional: null,
    meta: null,
  },
  // ⚠ FORM 12 IS A SCHOOL FORM, NOT A FAMILY ONE — moved 2026-09-16.
  //
  // Mr Ace, confirming the measurement: "yes form 12 is not being collected on
  // the parent portal thats correct". AY2025 holds 515 of them; AY2026 and
  // AY2027 hold ZERO, because the portal stopped offering it. Left in the
  // `student` group it stayed chaseable, so every one of ~1,300 students had a
  // permanent "Remind parent about Form 12" row in the Action Queue that no
  // parent could ever clear — the exact failure the `school` group was created
  // to stop when the other eight were briefly misfiled. It is on BOTH of the
  // school's document lists, so it stays unconditional; only who supplies it
  // changed.
  {
    key: 'form12',
    label: 'Form 12',
    expires: false,
    group: 'school',
    conditional: null,
    meta: null,
  },
  // ── School forms (migration 135) ─────────────────────────────────────────
  // The eight below are `group: 'school'`, and that is load-bearing rather
  // than cosmetic. THE PARENT PORTAL OFFERS NONE OF THEM — Mr Ace, 2026-08-31:
  // "p-files officer and above will upload the extended documents list" and
  // "these files are not gonna be uploaded in the parent portal, this will be
  // uploaded in p-files module". They were briefly filed under 'student', and
  // the result was visible immediately: the student page listed six of them in
  // the parent-chase Action Queue, each offering to "Remind parent" about a
  // form no parent can produce, and the "N documents need attention" headline
  // became a backlog nobody could ever clear. See `isChaseableGroup` below.
  //
  // FIVE OF THE EIGHT ARE ASKED OF NEW STUDENTS ONLY. Mr Ace supplied the
  // school's two real lists on 2026-09-16 — a long one headed "New Students /
  // Additional", and a short one for "Current Student" that carries only Form
  // 12 and the Signed Student Contract. So those two stay unconditional and
  // the rest are gated on the enrolee category.
  //
  // ⚠ THE CATEGORY GATE IS DELIBERATELY NOT APPLIED TO THE FAMILY DOCUMENTS
  // above and below this block, even though the school's Current-student list
  // does not name them either. That list says what the office RE-COLLECTS, not
  // what the file should hold: measured on production, a returning student's
  // documents row already carries them — 367 of 381 hold an ID picture, 379 a
  // birth certificate. Gating them on category would mark real, uploaded
  // documents "not applicable" and hide them from the very repository that
  // exists to keep them. Re-collection is already expressed by the expiry
  // mechanic ("if previous copy are expired"), which needs no condition:
  // `resolveStatus` returns 'expired' off the stored date, and 246 of 501
  // AY2026 students carry at least one expired pass or passport today.
  {
    key: 'lastSchoolRecommendation',
    label: 'Last School Recommendation and Good Moral',
    expires: false,
    group: 'school',
    conditional: { kind: 'category', values: NEW_CATEGORIES },
    meta: null,
  },
  {
    key: 'assessmentResult',
    label: 'Assessment Result and Interview',
    expires: false,
    group: 'school',
    conditional: { kind: 'category', values: NEW_CATEGORIES },
    meta: null,
  },
  // On BOTH of the school's lists — every student signs a contract each year.
  {
    key: 'signedContract',
    label: 'Signed Student Contract',
    expires: false,
    group: 'school',
    conditional: null,
    meta: null,
  },
  {
    key: 'newStudentChecksheet',
    label: 'New Student Checksheet',
    expires: false,
    group: 'school',
    conditional: { kind: 'category', values: NEW_CATEGORIES },
    meta: null,
  },
  {
    key: 'pfilesChecklist',
    label: 'Student P-Files Checklist',
    expires: false,
    group: 'school',
    conditional: { kind: 'category', values: NEW_CATEGORIES },
    meta: null,
  },
  {
    key: 'preCounsellingAck',
    label: 'Pre-Counselling Acknowledgement Form',
    expires: false,
    group: 'school',
    conditional: { kind: 'category', values: NEW_CATEGORIES },
    meta: null,
  },
  // The last two only show for the students they actually apply to.
  {
    key: 'conditionalEnrolment',
    label: 'Conditional Enrolment',
    expires: false,
    group: 'school',
    // `applicationStatus` lives on the enrolment_STATUS row, not the
    // applications row — callers merge it into the facts bag. A caller that
    // doesn't have it reads '' and the slot stays hidden.
    conditional: {
      kind: 'equals',
      column: 'applicationStatus',
      value: 'Enrolled (Conditional)',
    },
    meta: null,
  },
  {
    key: 'lateEnrolmentForm',
    label: 'Late Enrolment Form',
    expires: false,
    group: 'school',
    conditional: { kind: 'lateEnrollee' },
    meta: null,
  },
  // Expiring (student)
  {
    key: 'passport',
    label: 'Student Passport',
    expires: true,
    group: 'student-expiring',
    conditional: null,
    meta: {
      kind: 'passport',
      numberCol: 'passportNumber',
      expiryCol: 'passportExpiry',
    },
  },
  {
    key: 'pass',
    label: 'Student Pass',
    expires: true,
    group: 'student-expiring',
    conditional: null,
    meta: { kind: 'pass', numberCol: 'pass', expiryCol: 'passExpiry' },
  },
  // Mother (always required)
  {
    key: 'motherPassport',
    label: 'Mother Passport',
    expires: true,
    group: 'parent',
    conditional: null,
    meta: {
      kind: 'passport',
      numberCol: 'motherPassport',
      expiryCol: 'motherPassportExpiry',
    },
  },
  {
    key: 'motherPass',
    label: 'Mother Pass',
    expires: true,
    group: 'parent',
    conditional: null,
    meta: {
      kind: 'pass',
      numberCol: 'motherPass',
      expiryCol: 'motherPassExpiry',
    },
  },
  // Father (conditional on fatherEmail)
  {
    key: 'fatherPassport',
    label: 'Father Passport',
    expires: true,
    group: 'parent',
    conditional: { kind: 'filled', column: 'fatherEmail' },
    meta: {
      kind: 'passport',
      numberCol: 'fatherPassport',
      expiryCol: 'fatherPassportExpiry',
    },
  },
  {
    key: 'fatherPass',
    label: 'Father Pass',
    expires: true,
    group: 'parent',
    conditional: { kind: 'filled', column: 'fatherEmail' },
    meta: {
      kind: 'pass',
      numberCol: 'fatherPass',
      expiryCol: 'fatherPassExpiry',
    },
  },
  // Guardian (conditional on guardianEmail)
  {
    key: 'guardianPassport',
    label: 'Guardian Passport',
    expires: true,
    group: 'parent',
    conditional: { kind: 'filled', column: 'guardianEmail' },
    meta: {
      kind: 'passport',
      numberCol: 'guardianPassport',
      expiryCol: 'guardianPassportExpiry',
    },
  },
  {
    key: 'guardianPass',
    label: 'Guardian Pass',
    expires: true,
    group: 'parent',
    conditional: { kind: 'filled', column: 'guardianEmail' },
    meta: {
      kind: 'pass',
      numberCol: 'guardianPass',
      expiryCol: 'guardianPassExpiry',
    },
  },
];

export const GROUP_LABELS: Record<DocumentGroup, string> = {
  student: 'Student Documents (Non-Expiring)',
  'student-expiring': 'Student Documents (Expiring)',
  parent: 'Parent / Guardian Documents',
  school: 'School Forms',
};

// P-Files is a repository, not a review queue — but it does render every
// status SIS writes. SIS is the sole writer of `'rejected'` per the
// cross-module contract (Phase 3). `uploaded` is "Pending review" for
// parent self-serve uploads awaiting SIS validation. `to-follow` is the
// parent-acknowledged-pending state per KD #60 — it's the operational
// focus of P-Files (active dialogue with the family), distinct from
// `missing` (no contact yet).
export type DocumentStatus =
  | 'valid'
  | 'uploaded'
  | 'expired'
  | 'missing'
  | 'na'
  | 'rejected'
  | 'to-follow';

/** Resolve the effective display status for a document slot.
 *
 * `<slot>Status` is the source of truth (KD #60). A `null` rawStatus is
 * always 'missing' regardless of whether a URL happens to be present —
 * legacy / partial-write rows that have a URL but no status need to read
 * as Missing so they surface in the chase + urgency-sort flow rather
 * than silently passing as Valid.
 */
export function resolveStatus(
  _url: string | null,
  rawStatus: string | null,
  expiryDate: string | null,
  expires: boolean
): DocumentStatus {
  if (!rawStatus) return 'missing';

  const s = rawStatus.toLowerCase().trim();

  // Rejection is a deliberate SIS call — trumps expiry. A parent needs
  // to replace the file regardless of whether it's also out of date.
  if (s === 'rejected') return 'rejected';

  // 'To follow' = parent has acknowledged the ask and committed to a
  // re-upload. Trumps expiry: even if the underlying doc is past expiry,
  // the operational signal is "we're already in dialogue." Surfaces as
  // its own filter on the dashboard (KD #60).
  if (s === 'to follow') return 'to-follow';

  // A stored 'Expired' status is authoritative — the auto-freshen job
  // (lib/p-files/freshen-document-statuses.ts) writes it when
  // `expiry <= today` (inclusive), while the date backstop below only
  // derives it at strict `<`. Without this branch, a stored 'Expired'
  // row falls through to 'missing' on the expiry day itself, or when
  // the expiry date was later cleared/corrected, or on a non-expiring
  // slot — landing the student in the wrong chase bucket.
  if (s === 'expired') return 'expired';

  // Date backstop for stale 'Valid' rows whose expiry has passed but
  // whose status hasn't been freshened yet.
  if (expires && expiryDate) {
    const expiry = new Date(expiryDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (expiry < today) return 'expired';
  }

  // 'Uploaded' is the canonical "parent uploaded, awaiting registrar
  // review" value per KD #60. 'Pending' is a non-canonical synonym that
  // surfaces in legacy / mis-seeded data — treat it the same so the
  // P-Files "Pending review" quick filter doesn't silently miss rows.
  if (s === 'uploaded' || s === 'pending') return 'uploaded';
  if (s === 'valid') return 'valid';

  return 'missing';
}

export type BacklogBucket =
  | 'valid'
  | 'pending'
  | 'rejected'
  | 'expired'
  | 'missing'
  | 'na';

/**
 * Maps a resolved `DocumentStatus` (from `resolveStatus` above) into the
 * backlog chart's bucket vocabulary — `na` is excluded from every count
 * (never a real backlog item); `uploaded`/`to-follow` both read as
 * "in progress" (`pending`).
 *
 * ⚠ `expired` USED TO ROLL INTO `missing`, on the reasoning that Records has
 * to re-collect it either way. That is true of the REMEDY and wrong for a
 * dashboard: a document never provided and one that lapsed are different jobs
 * — a first ask versus a renewal chase — and folding them hid the ratio
 * between them. The chart's own bar was labelled "Missing / expired", which is
 * the conflation admitting itself. Split since 2026-09-22.
 *
 * Shared by `lib/sis/dashboard.ts`'s backlog chart aggregator AND the
 * `backlog-by-document` drill enrichment (`lib/sis/drill.ts::enrichWithDocSlotBuckets`)
 * so a segment click on the chart always resolves to exactly the rows the
 * chart counted into that segment (KD #82/#124 count==drill). Lives here
 * (rather than in `lib/sis/dashboard.ts`, which transitively imports
 * `server-only` via `lib/dashboard/ay-id.ts`) so client-side drill-sheet
 * components can import it from `lib/sis/drill.ts` without pulling
 * `server-only` into the client bundle.
 */
export function resolveBacklogBucket(status: DocumentStatus): BacklogBucket {
  switch (status) {
    case 'valid':
      return 'valid';
    case 'uploaded':
    case 'to-follow':
      return 'pending';
    case 'rejected':
      return 'rejected';
    case 'expired':
      return 'expired';
    case 'missing':
      return 'missing';
    case 'na':
      return 'na';
  }
}
