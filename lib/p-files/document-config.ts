// Static configuration for the 13 document slots tracked per student (post KD #96).
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

export type DocumentGroup = 'student' | 'student-expiring' | 'parent';

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

export type DocumentSlot = {
  key: string;
  label: string;
  expires: boolean;
  group: DocumentGroup;
  /** If set, this slot is only required when the named column is non-null in enrolment_applications */
  conditional: string | null;
  /** Metadata columns in enrolment_applications for expiring docs, null for non-expiring */
  meta: SlotMeta | null;
};

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
    conditional: 'fatherEmail',
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
    conditional: 'fatherEmail',
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
    conditional: 'guardianEmail',
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
    conditional: 'guardianEmail',
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
