// Static configuration for the 16 document slots tracked per student.
// Each slot maps to columns in `ay{YY}_enrolment_documents`:
//   {key}        — URL (text, nullable)
//   {key}Status  — status string (varchar, nullable)
//   {key}Expiry  — expiry date (date, nullable) — only for expiring docs
//
// 4 STP-conditional slots (icaPhoto, financialSupportDocs, vaccinationInformation +
// conceptually form12 if it's STP-only at HFSE — kept in 'student' group for now)
// are gated by `stpApplicationType` on the apps row per KD #61.

export type DocumentGroup = 'student' | 'student-expiring' | 'parent' | 'stp';

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
  { key: 'idPicture', label: 'ID Picture', expires: false, group: 'student', conditional: null, meta: null },
  { key: 'birthCert', label: 'Birth Certificate', expires: false, group: 'student', conditional: null, meta: null },
  { key: 'educCert', label: 'Education Certificate', expires: false, group: 'student', conditional: null, meta: null },
  { key: 'medical', label: 'Medical Exam', expires: false, group: 'student', conditional: null, meta: null },
  { key: 'form12', label: 'Form 12', expires: false, group: 'student', conditional: null, meta: null },
  // Expiring (student)
  { key: 'passport', label: 'Passport', expires: true, group: 'student-expiring', conditional: null, meta: { kind: 'passport', numberCol: 'passportNumber', expiryCol: 'passportExpiry' } },
  { key: 'pass', label: 'Student Pass', expires: true, group: 'student-expiring', conditional: null, meta: { kind: 'pass', numberCol: 'pass', expiryCol: 'passExpiry' } },
  // Mother (always required)
  { key: 'motherPassport', label: 'Mother Passport', expires: true, group: 'parent', conditional: null, meta: { kind: 'passport', numberCol: 'motherPassport', expiryCol: 'motherPassportExpiry' } },
  { key: 'motherPass', label: 'Mother Pass', expires: true, group: 'parent', conditional: null, meta: { kind: 'pass', numberCol: 'motherPass', expiryCol: 'motherPassExpiry' } },
  // Father (conditional on fatherEmail)
  { key: 'fatherPassport', label: 'Father Passport', expires: true, group: 'parent', conditional: 'fatherEmail', meta: { kind: 'passport', numberCol: 'fatherPassport', expiryCol: 'fatherPassportExpiry' } },
  { key: 'fatherPass', label: 'Father Pass', expires: true, group: 'parent', conditional: 'fatherEmail', meta: { kind: 'pass', numberCol: 'fatherPass', expiryCol: 'fatherPassExpiry' } },
  // Guardian (conditional on guardianEmail)
  { key: 'guardianPassport', label: 'Guardian Passport', expires: true, group: 'parent', conditional: 'guardianEmail', meta: { kind: 'passport', numberCol: 'guardianPassport', expiryCol: 'guardianPassportExpiry' } },
  { key: 'guardianPass', label: 'Guardian Pass', expires: true, group: 'parent', conditional: 'guardianEmail', meta: { kind: 'pass', numberCol: 'guardianPass', expiryCol: 'guardianPassExpiry' } },
  // STP (Singapore Student Pass) — gated on stpApplicationType being non-null on
  // the apps row. HFSE is Edutrust Certified and sponsors STP applications via ICA.
  // See KD #61 + docs/context/21-stp-application.md.
  { key: 'icaPhoto', label: 'ICA Photo (STP)', expires: false, group: 'stp', conditional: 'stpApplicationType', meta: null },
  { key: 'financialSupportDocs', label: 'Financial Support (STP)', expires: false, group: 'stp', conditional: 'stpApplicationType', meta: null },
  { key: 'vaccinationInformation', label: 'Vaccination Info (STP)', expires: false, group: 'stp', conditional: 'stpApplicationType', meta: null },
];

export const GROUP_LABELS: Record<DocumentGroup, string> = {
  student: 'Student Documents (Non-Expiring)',
  'student-expiring': 'Student Documents (Expiring)',
  parent: 'Parent / Guardian Documents',
  stp: 'Singapore Student Pass (STP)',
};

// P-Files is a repository, not a review queue — but it does render every
// status SIS writes. SIS is the sole writer of `'rejected'` per the
// cross-module contract (Phase 3). `uploaded` is "Pending review" for
// parent self-serve uploads awaiting SIS validation.
export type DocumentStatus = 'valid' | 'uploaded' | 'expired' | 'missing' | 'na' | 'rejected';

/** Resolve the effective display status for a document slot. */
export function resolveStatus(
  url: string | null,
  rawStatus: string | null,
  expiryDate: string | null,
  expires: boolean,
): DocumentStatus {
  if (!url && !rawStatus) return 'missing';

  const s = (rawStatus ?? '').toLowerCase().trim();

  // Rejection is a deliberate SIS call — trumps expiry. A parent needs
  // to replace the file regardless of whether it's also out of date.
  if (s === 'rejected') return 'rejected';

  // For expiring docs, check if expired
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
  if (url) return 'valid';

  return 'missing';
}
