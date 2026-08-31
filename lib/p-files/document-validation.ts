import 'server-only';

import { unstable_cache } from 'next/cache';

import { createServiceClient } from '@/lib/supabase/service';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';

// Loader for the P-Files document validation page.
// Scans enrolled students and fans across the 13 document slots to build two
// queues:
//   - Awaiting Verification: non-expiring slots with status='Uploaded'
//   - Expiring Soon: expiring slots with status='Valid' AND expiry ≤ windowDays
//
// Scope (KD #71 + KD #91): applicationStatus IN ('Enrolled', 'Enrolled (Conditional)').
// Cache tag: p-files-drill:${ayCode} — existing PATCH routes already invalidate this.

export type PFileValidationOwner = 'Student' | 'Mother' | 'Father' | 'Guardian';

export type PFileValidationRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  levelApplied: string | null;
  classSection: string | null;
  slotKey: string;
  slotLabel: string;
  /**
   * The file, when there is one. EMPTY STRING means no document has been
   * uploaded for this slot — the queue now lists every student and every slot,
   * not only the ones with something waiting, so a row can legitimately have
   * no file. Callers must check before offering a link.
   */
  fileUrl: string;
  /**
   * Raw `{slot}Status` as stored: 'Uploaded', 'Valid', 'Rejected', 'Expired',
   * 'To follow', or null for a slot nothing has ever been written to. This is
   * what decides whether the row can be approved or rejected — only 'Uploaded'
   * is awaiting a decision.
   */
  status: string | null;
  owner: PFileValidationOwner;
  /** Expiry date for the passport / pass slots; null for the rest. */
  expiryDateIso: string | null;
  // Days until expiry; negative = already expired (should not appear in Expiring Soon).
  daysUntilExpiry: number | null;
};

function deriveOwner(slotKey: string): PFileValidationOwner {
  if (slotKey.startsWith('mother')) return 'Mother';
  if (slotKey.startsWith('father')) return 'Father';
  if (slotKey.startsWith('guardian')) return 'Guardian';
  return 'Student';
}

const ENROLLED_STATUSES = ['Enrolled', 'Enrolled (Conditional)'] as const;

const NON_EXPIRING_SLOTS = DOCUMENT_SLOTS.filter((s) => !s.expiryCol);
const EXPIRING_SLOTS = DOCUMENT_SLOTS.filter((s) => !!s.expiryCol);

async function loadEnrolledDocs(ayCode: string): Promise<{
  apps: Array<{
    enroleeNumber: string;
    enroleeFullName: string | null;
    studentNumber: string | null;
    levelApplied: string | null;
    classSection: string | null;
  }>;
  statusByEnrolee: Map<string, string>;
  docsByEnrolee: Map<string, Record<string, string | null>>;
}> {
  const year = ayCode.replace(/^AY/i, '').toLowerCase();
  const appsTable = `ay${year}_enrolment_applications`;
  const statusTable = `ay${year}_enrolment_status`;
  const docsTable = `ay${year}_enrolment_documents`;

  const supabase = createServiceClient();

  const docsSelect = [
    'enroleeNumber',
    ...DOCUMENT_SLOTS.flatMap(
      (s) => [s.statusCol, s.urlCol, s.expiryCol].filter(Boolean) as string[]
    ),
  ].join(', ');

  const [appsRes, statusRes, docsRes] = await Promise.all([
    supabase
      .from(appsTable)
      .select('enroleeNumber, studentNumber, enroleeFullName, levelApplied'),
    supabase
      .from(statusTable)
      .select('enroleeNumber, applicationStatus, classSection'),
    supabase.from(docsTable).select(docsSelect),
  ]);

  if (appsRes.error || statusRes.error || docsRes.error) {
    console.error('[p-files doc-validation] fetch error', {
      apps: appsRes.error?.message,
      status: statusRes.error?.message,
      docs: docsRes.error?.message,
    });
    return { apps: [], statusByEnrolee: new Map(), docsByEnrolee: new Map() };
  }

  type AppRow = {
    enroleeNumber: string | null;
    studentNumber: string | null;
    enroleeFullName: string | null;
    levelApplied: string | null;
  };
  type StatusRow = {
    enroleeNumber: string | null;
    applicationStatus: string | null;
    classSection: string | null;
  };

  const rawApps = (appsRes.data ?? []) as AppRow[];
  const rawStatuses = (statusRes.data ?? []) as StatusRow[];
  const rawDocs = (docsRes.data ?? []) as unknown as Array<
    Record<string, string | null>
  >;

  const statusByEnrolee = new Map<string, string>();
  const classSectionByEnrolee = new Map<string, string | null>();
  for (const s of rawStatuses) {
    if (s.enroleeNumber) {
      if (s.applicationStatus)
        statusByEnrolee.set(s.enroleeNumber, s.applicationStatus);
      classSectionByEnrolee.set(s.enroleeNumber, s.classSection ?? null);
    }
  }

  const docsByEnrolee = new Map<string, Record<string, string | null>>();
  for (const d of rawDocs) {
    const num = d['enroleeNumber'];
    if (num) docsByEnrolee.set(num, d);
  }

  // Filter to enrolled-only.
  const enrolledSet = new Set(ENROLLED_STATUSES as readonly string[]);
  const apps = rawApps
    .filter((a) => {
      if (!a.enroleeNumber) return false;
      const status = statusByEnrolee.get(a.enroleeNumber);
      return status != null && enrolledSet.has(status);
    })
    .map((a) => ({
      enroleeNumber: a.enroleeNumber!,
      enroleeFullName: a.enroleeFullName,
      studentNumber: a.studentNumber,
      levelApplied: a.levelApplied,
      classSection: classSectionByEnrolee.get(a.enroleeNumber!) ?? null,
    }));

  return { apps, statusByEnrolee, docsByEnrolee };
}

async function loadAwaitingVerificationUncached(
  ayCode: string
): Promise<PFileValidationRow[]> {
  const { apps, docsByEnrolee } = await loadEnrolledDocs(ayCode);

  const rows: PFileValidationRow[] = [];

  for (const app of apps) {
    // A student with no documents row at all still belongs on the page — every
    // one of their slots is simply empty. Skipping them here is exactly what
    // hid the students who most need chasing.
    const docRow = docsByEnrolee.get(app.enroleeNumber) ?? {};

    const fullName = app.enroleeFullName?.trim() || app.enroleeNumber;

    // ONLY DOCUMENTS THAT NEED VALIDATING — status 'Uploaded'. This is a
    // review queue: a slot nobody has filled, and a document already decided,
    // are both things the reviewer cannot act on, and listing them buried the
    // handful that need a decision under every slot of every student (406
    // students x 21 slots = 8,526 rows, 2.9MB — over Next's 2MB cache ceiling,
    // so the page's cache never once stored and every request recomputed).
    //
    // Where a student STANDS is a different question, answered by their own
    // P-File and by the completeness table. This page answers "what is waiting
    // for me".
    //
    // Expiring slots are included: a passport a parent has just RE-UPLOADED
    // sits at 'Uploaded' like any other document, and skipping those was the
    // gap that hid 360 AY2025 / 122 AY2026 renewals from review (KD #63/#64).
    for (const slot of DOCUMENT_SLOTS) {
      const status = docRow[slot.statusCol] ?? null;
      if (status !== 'Uploaded') continue;
      const fileUrl = docRow[slot.urlCol] ?? '';

      // Carried for the expiring slots so the reviewer can see the date they
      // are actually being asked to accept. Null on the rest, which have none.
      const expiryDateIso = slot.expiryCol
        ? (docRow[slot.expiryCol] ?? null)
        : null;

      rows.push({
        enroleeNumber: app.enroleeNumber,
        studentNumber: app.studentNumber,
        fullName,
        levelApplied: app.levelApplied,
        classSection: app.classSection,
        slotKey: slot.key,
        slotLabel: slot.label,
        fileUrl,
        status,
        owner: deriveOwner(slot.key),
        expiryDateIso,
        daysUntilExpiry: null,
      });
    }
  }

  rows.sort((a, b) => {
    const nameCmp = a.fullName.localeCompare(b.fullName);
    return nameCmp !== 0 ? nameCmp : a.slotLabel.localeCompare(b.slotLabel);
  });
  return rows;
}

async function loadExpiringSoonUncached(
  ayCode: string,
  windowDays = 90
): Promise<PFileValidationRow[]> {
  const { apps, docsByEnrolee } = await loadEnrolledDocs(ayCode);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today.getTime() + windowDays * 86_400_000);

  const rows: PFileValidationRow[] = [];

  for (const app of apps) {
    const docRow = docsByEnrolee.get(app.enroleeNumber);
    if (!docRow) continue;

    const fullName = app.enroleeFullName?.trim() || app.enroleeNumber;

    for (const slot of EXPIRING_SLOTS) {
      if (!slot.expiryCol) continue;
      const status = docRow[slot.statusCol];
      if (status !== 'Valid') continue;
      const fileUrl = docRow[slot.urlCol];
      if (!fileUrl) continue;
      const expiryIso = docRow[slot.expiryCol];
      if (!expiryIso) continue;

      const expiryDate = new Date(expiryIso);
      expiryDate.setHours(0, 0, 0, 0);
      if (expiryDate > cutoff) continue; // outside window
      if (expiryDate < today) continue; // already expired (Expired status would cover those)

      const daysUntilExpiry = Math.round(
        (expiryDate.getTime() - today.getTime()) / 86_400_000
      );

      rows.push({
        enroleeNumber: app.enroleeNumber,
        studentNumber: app.studentNumber,
        fullName,
        levelApplied: app.levelApplied,
        classSection: app.classSection,
        slotKey: slot.key,
        slotLabel: slot.label,
        fileUrl,
        // This loader only ever selects rows already at 'Valid' (see the
        // filter above), so the status is known rather than read.
        status: 'Valid',
        owner: deriveOwner(slot.key),
        expiryDateIso: expiryIso,
        daysUntilExpiry,
      });
    }
  }

  // Default: most urgent first (soonest expiry).
  rows.sort((a, b) => {
    const dA = a.daysUntilExpiry ?? 9999;
    const dB = b.daysUntilExpiry ?? 9999;
    if (dA !== dB) return dA - dB;
    return a.fullName.localeCompare(b.fullName);
  });
  return rows;
}

export async function loadAwaitingVerification(
  ayCode: string
): Promise<PFileValidationRow[]> {
  return unstable_cache(
    () => loadAwaitingVerificationUncached(ayCode),
    ['p-files', 'doc-validation', 'awaiting', ayCode],
    { tags: [`p-files-drill:${ayCode}`], revalidate: 60 }
  )();
}

export async function loadExpiringSoon(
  ayCode: string,
  windowDays = 90
): Promise<PFileValidationRow[]> {
  return unstable_cache(
    () => loadExpiringSoonUncached(ayCode, windowDays),
    ['p-files', 'doc-validation', 'expiring', ayCode],
    { tags: [`p-files-drill:${ayCode}`], revalidate: 60 }
  )();
}

export async function countAwaitingVerification(
  ayCode: string
): Promise<number> {
  const rows = await loadAwaitingVerification(ayCode);
  // Documents AWAITING A DECISION, not rows on the page. The loader now emits
  // every student against every slot, so `rows.length` is the size of the
  // table (thousands) rather than the size of the job — which is what this
  // badge, and the sentence above the table, are both telling someone.
  return rows.filter((r) => r.status === 'Uploaded').length;
}
