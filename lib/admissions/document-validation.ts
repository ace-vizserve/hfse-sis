// Loader for the admissions document validation triage page.
//
// Scans every un-enrolled applicant in a given AY, fans across the 16
// document slots in JS, and returns one ValidationQueueRow per slot whose
// status is 'Uploaded' (the awaiting-validation queue per KD #70).
//
// Scope (KD #70 + KD #71): admissions-side only — applicationStatus IN
// ('Submitted', 'Ongoing Verification', 'Processing'). Enrolled +
// post-Enrolled applicants are out of scope (P-Files handles those).
//
// STP-conditional slots (KD #61): icaPhoto / financialSupportDocs /
// vaccinationInformation are skipped when the applicant's
// stpApplicationType is null. Mirrors the existing pattern in
// loadAdmissionsCompletenessForChaseUncached.
//
// No per-slot timestamp is emitted in v1 — the schema lacks one
// (documentUpdatedDate is stage-level, not slot-level). A future
// migration adding ${slot}UploadedAt would unlock days-waiting.
//
// Cache: tagged `sis:${ayCode}` so the existing PATCH at
// /api/sis/students/[enroleeNumber]/document/[slotKey] auto-invalidates
// this loader via its `revalidateTag(\`sis:${ayCode}\`, 'max')` call.

import { unstable_cache } from 'next/cache';

import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';

export type ValidationQueueCategory = 'general' | 'stp';

export type ValidationQueueOwner = 'Student' | 'Mother' | 'Father' | 'Guardian';

export type ValidationQueueRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  applicationStatus: string;
  levelApplied: string | null;
  slotKey: string;
  slotLabel: string;
  /** Empty string when nothing has been uploaded for this slot. */
  fileUrl: string;
  /**
   * Raw `{slot}Status`: 'Uploaded', 'Valid', 'Rejected', 'Expired', or null
   * for a slot nothing has been written to. Only 'Uploaded' awaits a decision.
   */
  status: string | null;
  /** Expiry for the passport / pass slots; null for the rest. */
  expiryDateIso: string | null;
  isExpirable: boolean;
  // Who the document belongs to, derived from slotKey prefix. Lets the
  // validation page facet on "Student" vs "Mother / Father / Guardian"
  // so registrars can batch through parent-side docs vs student-side docs.
  owner: ValidationQueueOwner;
  // 'general' = the 13 always-applicable slots. 'stp' was the 3 STP-
  // conditional slots before migration 050 retired them — kept on the
  // type for back-compat with consumers; new rows always emit 'general'.
  category: ValidationQueueCategory;
};

function deriveOwner(slotKey: string): ValidationQueueOwner {
  if (slotKey.startsWith('mother')) return 'Mother';
  if (slotKey.startsWith('father')) return 'Father';
  if (slotKey.startsWith('guardian')) return 'Guardian';
  return 'Student';
}

const PENDING_APP_STATUSES = [
  'Submitted',
  'Ongoing Verification',
  'Processing',
] as const;
type PendingAppStatus = (typeof PENDING_APP_STATUSES)[number];

async function loadPendingDocValidationUncached(
  ayCode: string
): Promise<ValidationQueueRow[]> {
  const year = ayCode.replace(/^AY/i, '').toLowerCase();
  const appsTable = `ay${year}_enrolment_applications`;
  const statusTable = `ay${year}_enrolment_status`;
  const docsTable = `ay${year}_enrolment_documents`;

  const admissions = createAdmissionsClient();

  // Fetch all three tables in parallel. Admissions tables have no FK between
  // them so we join in JS by enroleeNumber, mirroring the rest of
  // lib/admissions/dashboard.ts.
  const [appsRes, statusRes, docsRes] = await Promise.all([
    admissions
      .from(appsTable)
      .select(
        'enroleeNumber, studentNumber, firstName, lastName, middleName, enroleeFullName, levelApplied, stpApplicationType'
      ),
    admissions.from(statusTable).select('enroleeNumber, applicationStatus'),
    // Build the docs SELECT from DOCUMENT_SLOTS so we always read every
    // statusCol + urlCol column. urlCol is required on every slot; no fallback.
    admissions.from(docsTable).select(
      [
        'enroleeNumber',
        // Expiry included so the table can show the date a reviewer is
        // being asked to accept on a renewed passport or pass.
        ...DOCUMENT_SLOTS.flatMap(
          (s) =>
            [s.statusCol, s.urlCol, s.expiryCol].filter(Boolean) as string[]
        ),
      ].join(', ')
    ),
  ]);

  if (appsRes.error || statusRes.error || docsRes.error) {
    console.error('[doc-validation] fetch error', {
      apps: appsRes.error?.message,
      status: statusRes.error?.message,
      docs: docsRes.error?.message,
    });
    return [];
  }

  type AppRow = {
    enroleeNumber: string | null;
    studentNumber: string | null;
    firstName: string | null;
    lastName: string | null;
    middleName: string | null;
    enroleeFullName: string | null;
    levelApplied: string | null;
    stpApplicationType: string | null;
  };
  type StatusRow = {
    enroleeNumber: string | null;
    applicationStatus: string | null;
  };
  type DocsRow = Record<string, string | null> & {
    enroleeNumber: string | null;
  };

  const apps = (appsRes.data ?? []) as AppRow[];
  const statuses = (statusRes.data ?? []) as StatusRow[];
  // Dynamic SELECT string makes Supabase's typed client widen to
  // GenericStringError[]; cast through unknown so TS accepts the runtime shape.
  const docs = (docsRes.data ?? []) as unknown as DocsRow[];

  const statusByEnrolee = new Map<string, string | null>();
  for (const s of statuses) {
    if (s.enroleeNumber)
      statusByEnrolee.set(s.enroleeNumber, s.applicationStatus);
  }
  const appByEnrolee = new Map<string, AppRow>();
  for (const a of apps) {
    if (a.enroleeNumber) appByEnrolee.set(a.enroleeNumber, a);
  }

  const docsByEnrolee = new Map<string, DocsRow>();
  for (const d of docs) {
    if (d.enroleeNumber) docsByEnrolee.set(d.enroleeNumber, d);
  }

  const rows: ValidationQueueRow[] = [];

  // ONLY DOCUMENTS THAT NEED VALIDATING — status 'Uploaded'. Same rule as the
  // enrolled-students queue beside it (lib/p-files/document-validation.ts):
  // an empty slot and an already-decided document are both things the reviewer
  // cannot act on, and listing every slot of every applicant buried the few
  // that need a decision.
  //
  // Where an applicant STANDS is a different question, answered by their
  // application detail page. This page answers "what is waiting for me".
  for (const [enroleeNumber, app] of appByEnrolee) {
    const appStatus = statusByEnrolee.get(enroleeNumber) ?? null;
    if (!appStatus) continue;
    if (!PENDING_APP_STATUSES.includes(appStatus as PendingAppStatus)) continue;

    const docRow = docsByEnrolee.get(enroleeNumber) ?? ({} as DocsRow);

    for (const slot of DOCUMENT_SLOTS) {
      const status = docRow[slot.statusCol] ?? null;
      if (status !== 'Uploaded') continue;
      const fileUrl = docRow[slot.urlCol] ?? '';
      const expiryDateIso = slot.expiryCol
        ? (docRow[slot.expiryCol] ?? null)
        : null;

      const fullName =
        app.enroleeFullName?.trim() ||
        [app.firstName, app.middleName, app.lastName]
          .map((p) => (p ?? '').trim())
          .filter(Boolean)
          .join(' ') ||
        '(unnamed)';

      rows.push({
        enroleeNumber,
        studentNumber: app.studentNumber,
        fullName,
        applicationStatus: appStatus,
        levelApplied: app.levelApplied,
        slotKey: slot.key,
        slotLabel: slot.label,
        fileUrl,
        status,
        expiryDateIso,
        isExpirable: slot.expiryCol != null,
        owner: deriveOwner(slot.key),
        category: 'general',
      });
    }
  }

  // Stable sort: by full name then slot label so the page re-renders
  // deterministically across cache hits.
  rows.sort((a, b) => {
    const nameCmp = a.fullName.localeCompare(b.fullName);
    if (nameCmp !== 0) return nameCmp;
    return a.slotLabel.localeCompare(b.slotLabel);
  });

  return rows;
}

export async function loadPendingDocValidation(
  ayCode: string
): Promise<ValidationQueueRow[]> {
  return unstable_cache(
    () => loadPendingDocValidationUncached(ayCode),
    ['admissions', 'doc-validation', ayCode],
    { tags: [`sis:${ayCode}`], revalidate: 60 }
  )();
}

export async function countPendingDocValidation(
  ayCode: string
): Promise<number> {
  const rows = await loadPendingDocValidation(ayCode);
  return rows.length;
}
