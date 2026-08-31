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
 * `school` documents are uploaded by the P-Files officer and above and are
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
 */
export type SlotCondition =
  | { kind: 'filled'; column: string }
  | { kind: 'equals'; column: string; value: string }
  | { kind: 'lateEnrollee' };

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
  {
    key: 'form12',
    label: 'Form 12',
    expires: false,
    group: 'student',
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
  {
    key: 'lastSchoolRecommendation',
    label: 'Last School Recommendation and Good Moral',
    expires: false,
    group: 'school',
    conditional: null,
    meta: null,
  },
  {
    key: 'assessmentResult',
    label: 'Assessment Result and Interview',
    expires: false,
    group: 'school',
    conditional: null,
    meta: null,
  },
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
    conditional: null,
    meta: null,
  },
  {
    key: 'pfilesChecklist',
    label: 'Student P-Files Checklist',
    expires: false,
    group: 'school',
    conditional: null,
    meta: null,
  },
  {
    key: 'preCounsellingAck',
    label: 'Pre-Counselling Acknowledgement Form',
    expires: false,
    group: 'school',
    conditional: null,
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

export type BacklogBucket = 'valid' | 'pending' | 'rejected' | 'missing' | 'na';

/**
 * Maps a resolved `DocumentStatus` (from `resolveStatus` above) into the
 * backlog chart's 4-bucket vocabulary — `na` is excluded from every count
 * (never a real backlog item); `expired` rolls into `missing` (Records needs
 * to re-collect it either way); `uploaded`/`to-follow` both read as
 * "in progress" (`pending`).
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
    case 'missing':
      return 'missing';
    case 'na':
      return 'na';
  }
}
