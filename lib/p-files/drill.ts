import { unstable_cache } from 'next/cache';

import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

function tags(ayCode: string): string[] {
  return ['p-files-drill', `p-files-drill:${ayCode}`];
}

// ─── Targets ────────────────────────────────────────────────────────────────

export type PFilesDrillTarget =
  | 'all-docs'
  | 'complete-docs'
  | 'expired-docs'
  | 'missing-docs'
  | 'slot-by-status'
  | 'missing-by-slot'
  | 'level-applicants'
  | 'revisions-on-day';

export type DrillScope = 'range' | 'ay' | 'all';

// ─── Row shape ──────────────────────────────────────────────────────────────

export type PFilesDrillRow = {
  enroleeNumber: string;
  fullName: string;
  level: string | null;
  slotKey: string; // 'medical' | 'passport' | 'birth-cert' | 'educ-cert' | 'id-picture' | ...
  slotLabel: string;
  status: 'On file' | 'Pending review' | 'Expired' | 'Missing' | 'N/A';
  fileUrl: string | null;
  expiryDate: string | null;
  daysToExpiry: number | null;
  revisionCount: number;
  lastRevisionAt: string | null; // ISO
};

const CORE_SLOTS: Array<{ key: string; column: string; label: string }> = [
  { key: 'medical', column: 'medicalStatus', label: 'Medical' },
  { key: 'passport', column: 'passportStatus', label: 'Passport' },
  { key: 'birth-cert', column: 'birthCertStatus', label: 'Birth cert' },
  { key: 'educ-cert', column: 'educCertStatus', label: 'Educ cert' },
  { key: 'id-picture', column: 'idPictureStatus', label: 'ID picture' },
];

// ─── Loader ─────────────────────────────────────────────────────────────────

type AppLite = {
  enroleeNumber: string | null;
  enroleeFullName: string | null;
  firstName: string | null;
  lastName: string | null;
  levelApplied: string | null;
  classLevel: string | null;
};
type DocLite = Record<string, string | null>;
type RevisionLite = {
  enrolee_number: string | null;
  slot_key: string;
  ay_code: string;
  replaced_at: string;
};

function appName(a: AppLite): string {
  return (
    (a.enroleeFullName ?? '').trim() ||
    `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() ||
    a.enroleeNumber ||
    ''
  );
}

function normaliseStatus(raw: string | null): PFilesDrillRow['status'] {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === '' || s === 'missing') return 'Missing';
  if (s === 'pending' || s === 'pending review') return 'Pending review';
  if (s === 'expired') return 'Expired';
  if (s === 'n/a' || s === 'na' || s === 'not applicable') return 'N/A';
  return 'On file';
}

async function loadPFilesRowsUncached(ayCode: string): Promise<PFilesDrillRow[]> {
  const prefix = prefixFor(ayCode);
  const appsTable = `${prefix}_enrolment_applications`;
  const docsTable = `${prefix}_enrolment_documents`;
  const statusTable = `${prefix}_enrolment_status`;
  const admissions = createAdmissionsClient();
  const service = createServiceClient();

  const [appsRes, docsRes, statusRes, revRes] = await Promise.all([
    admissions
      .from(appsTable)
      .select('enroleeNumber, enroleeFullName, firstName, lastName, levelApplied'),
    admissions
      .from(docsTable)
      .select(`enroleeNumber, ${CORE_SLOTS.map((s) => s.column).join(', ')}, passportExpiryDate`),
    admissions
      .from(statusTable)
      .select('enroleeNumber, classLevel'),
    service
      .from('p_file_revisions')
      .select('enrolee_number, slot_key, ay_code, replaced_at')
      .eq('ay_code', ayCode),
  ]);

  const apps = (appsRes.data ?? []) as AppLite[];
  const appByEnrolee = new Map<string, AppLite>();
  for (const a of apps) {
    if (a.enroleeNumber) appByEnrolee.set(a.enroleeNumber, a);
  }

  const docs = (docsRes.data ?? []) as unknown as DocLite[];
  const docByEnrolee = new Map<string, DocLite>();
  for (const d of docs) {
    const en = d['enroleeNumber'];
    if (typeof en === 'string') docByEnrolee.set(en, d);
  }

  const statuses = (statusRes.data ?? []) as Array<{
    enroleeNumber: string | null;
    classLevel: string | null;
  }>;
  const classLevelByEnrolee = new Map<string, string>();
  for (const s of statuses) {
    if (s.enroleeNumber && s.classLevel) classLevelByEnrolee.set(s.enroleeNumber, s.classLevel);
  }

  // Revisions counted per (enrolee, slot)
  const revKey = (en: string, slot: string) => `${en}|${slot}`;
  const revCount = new Map<string, number>();
  const revLastAt = new Map<string, string>();
  for (const r of (revRes.data ?? []) as RevisionLite[]) {
    if (!r.enrolee_number) continue;
    const k = revKey(r.enrolee_number, r.slot_key);
    revCount.set(k, (revCount.get(k) ?? 0) + 1);
    const prev = revLastAt.get(k);
    if (!prev || r.replaced_at > prev) revLastAt.set(k, r.replaced_at);
  }

  const today = Date.now();
  const out: PFilesDrillRow[] = [];
  for (const app of apps) {
    if (!app.enroleeNumber) continue;
    const docRow = docByEnrolee.get(app.enroleeNumber);
    const level = classLevelByEnrolee.get(app.enroleeNumber) ?? app.levelApplied ?? null;
    const expiryDate = (docRow?.['passportExpiryDate'] as string | null | undefined) ?? null;
    const expiryMs = expiryDate ? Date.parse(expiryDate) : NaN;
    const daysToExpiry = !Number.isNaN(expiryMs)
      ? Math.floor((expiryMs - today) / 86_400_000)
      : null;

    for (const slot of CORE_SLOTS) {
      const raw = (docRow?.[slot.column] as string | null | undefined) ?? null;
      const status = normaliseStatus(raw);
      const k = revKey(app.enroleeNumber, slot.key);
      out.push({
        enroleeNumber: app.enroleeNumber,
        fullName: appName(app),
        level,
        slotKey: slot.key,
        slotLabel: slot.label,
        status,
        fileUrl: null, // not surfaced in drill rows; the detail page handles file urls
        expiryDate: slot.key === 'passport' ? expiryDate : null,
        daysToExpiry: slot.key === 'passport' ? daysToExpiry : null,
        revisionCount: revCount.get(k) ?? 0,
        lastRevisionAt: revLastAt.get(k) ?? null,
      });
    }
  }
  return out;
}

export async function buildPFilesDrillRows(input: {
  ayCode: string;
  scope: DrillScope;
  from?: string;
  to?: string;
}): Promise<PFilesDrillRow[]> {
  return unstable_cache(
    () => loadPFilesRowsUncached(input.ayCode),
    ['p-files-drill', 'rows', input.ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(input.ayCode) },
  )();
}

// ─── Per-target filter ──────────────────────────────────────────────────────

export function applyTargetFilter(
  rows: PFilesDrillRow[],
  target: PFilesDrillTarget,
  segment: string | null,
  range?: { from: string; to: string },
): PFilesDrillRow[] {
  switch (target) {
    case 'all-docs': return rows;
    case 'complete-docs': return rows.filter((r) => r.status === 'On file');
    case 'expired-docs': return rows.filter((r) => r.status === 'Expired');
    case 'missing-docs': return rows.filter((r) => r.status === 'Missing');
    case 'slot-by-status': {
      // segment = a status string ('Missing', 'Expired', etc.)
      if (!segment) return rows;
      return rows.filter((r) => r.status === segment);
    }
    case 'missing-by-slot': {
      // segment = slotKey
      if (!segment) return rows.filter((r) => r.status === 'Missing');
      return rows.filter((r) => r.slotKey === segment && r.status === 'Missing');
    }
    case 'level-applicants': {
      if (!segment) return rows;
      return rows.filter((r) => (r.level ?? 'Unknown') === segment);
    }
    case 'revisions-on-day': {
      // segment = ISO date 'YYYY-MM-DD'
      if (!segment) return rows.filter((r) => r.lastRevisionAt !== null);
      return rows.filter((r) => r.lastRevisionAt?.slice(0, 10) === segment);
    }
    default: {
      const _exhaustive: never = target;
      throw new Error(`unreachable target: ${String(_exhaustive)}`);
    }
  }
}

// ─── Per-target columns ─────────────────────────────────────────────────────

export type DrillColumnKey =
  | 'fullName'
  | 'enroleeNumber'
  | 'level'
  | 'slotLabel'
  | 'status'
  | 'expiryDate'
  | 'daysToExpiry'
  | 'revisionCount'
  | 'lastRevisionAt';

export const ALL_DRILL_COLUMNS: DrillColumnKey[] = [
  'fullName',
  'enroleeNumber',
  'level',
  'slotLabel',
  'status',
  'expiryDate',
  'daysToExpiry',
  'revisionCount',
  'lastRevisionAt',
];

export const DRILL_COLUMN_LABELS: Record<DrillColumnKey, string> = {
  fullName: 'Applicant',
  enroleeNumber: 'Enrolee #',
  level: 'Level',
  slotLabel: 'Slot',
  status: 'Status',
  expiryDate: 'Expires',
  daysToExpiry: 'Days to expiry',
  revisionCount: 'Revisions',
  lastRevisionAt: 'Last revision',
};

export function defaultColumnsForTarget(target: PFilesDrillTarget): DrillColumnKey[] {
  switch (target) {
    case 'all-docs': return ['fullName', 'level', 'slotLabel', 'status'];
    case 'complete-docs':
    case 'expired-docs':
    case 'missing-docs':
    case 'slot-by-status':
    case 'missing-by-slot':
      return ['fullName', 'level', 'slotLabel', 'status', 'lastRevisionAt'];
    case 'level-applicants':
      return ['fullName', 'level', 'slotLabel', 'status'];
    case 'revisions-on-day':
      return ['fullName', 'level', 'slotLabel', 'status', 'revisionCount', 'lastRevisionAt'];
  }
}

export function drillHeaderForTarget(
  target: PFilesDrillTarget,
  segment: string | null,
): { eyebrow: string; title: string } {
  switch (target) {
    case 'all-docs': return { eyebrow: 'Drill · All', title: 'All document slots' };
    case 'complete-docs': return { eyebrow: 'Drill · Complete', title: 'On-file documents' };
    case 'expired-docs': return { eyebrow: 'Drill · Expired', title: 'Expired documents' };
    case 'missing-docs': return { eyebrow: 'Drill · Missing', title: 'Missing documents' };
    case 'slot-by-status':
      return { eyebrow: 'Drill · Status', title: segment ? `Status: ${segment}` : 'By status' };
    case 'missing-by-slot':
      return { eyebrow: 'Drill · Slot', title: segment ? `Missing: ${segment}` : 'Missing by slot' };
    case 'level-applicants':
      return { eyebrow: 'Drill · Level', title: segment ? `Level: ${segment}` : 'By level' };
    case 'revisions-on-day':
      return { eyebrow: 'Drill · Revisions', title: segment ? `Revisions on ${segment}` : 'Revisions' };
  }
}
