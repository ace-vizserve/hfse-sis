import { unstable_cache } from 'next/cache';

import { DOCUMENT_SLOTS } from '@/lib/sis/queries';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPages } from '@/lib/supabase/paginate';

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
  | 'expiring-soon'
  | 'missing-docs'
  | 'slot-by-status'
  | 'missing-by-slot'
  | 'level-applicants'
  | 'revisions-on-day';

// ─── Row shape ──────────────────────────────────────────────────────────────

export type PFilesDrillRow = {
  enroleeNumber: string;
  fullName: string;
  level: string | null;
  slotKey: string; // 'medical' | 'passport' | 'birth-cert' | 'educ-cert' | 'id-picture' | ...
  slotLabel: string;
  status:
    | 'On file'
    | 'Awaiting validation'
    | 'Promised'
    | 'Rejected'
    | 'Expired'
    | 'Missing';
  fileUrl: string | null;
  expiryDate: string | null;
  daysToExpiry: number | null;
  revisionCount: number;
  lastRevisionAt: string | null; // ISO
};

// Slots the P-Files drill iterates per enrolled student. All 13
// `DOCUMENT_SLOTS` (canonical post-KD-#96 list) minus `form12`
// (deliberately excluded — not part of the per-student chase queue).
const ELIGIBLE_SLOTS = DOCUMENT_SLOTS.filter((s) => s.key !== 'form12');

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

// Map raw `<slot>Status` values (KD #60: 'Valid' / 'Uploaded' / 'To follow' /
// 'Rejected' / 'Expired') to the discrete display enum the P-Files drill UI expects.
//   - 'Valid'      → 'On file'
//   - 'Uploaded'   → 'Awaiting validation'
//   - 'To follow'  → 'Promised'
//   - 'Rejected'   → 'Rejected'
//   - 'Expired'    → 'Expired'
//   - null / '' / 'Missing' → 'Missing'
//   - unknown      → 'Missing' (conservative, matches resolveStatus fallback)
function normaliseStatus(raw: string | null): PFilesDrillRow['status'] {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === '' || s === 'missing') return 'Missing';
  if (s === 'valid') return 'On file';
  if (s === 'uploaded' || s === 'pending' || s === 'pending review')
    return 'Awaiting validation';
  if (s === 'to follow') return 'Promised';
  if (s === 'rejected') return 'Rejected';
  if (s === 'expired') return 'Expired';
  return 'Missing';
}

async function loadPFilesRowsUncached(
  ayCode: string
): Promise<PFilesDrillRow[]> {
  const prefix = prefixFor(ayCode);
  const appsTable = `${prefix}_enrolment_applications`;
  const docsTable = `${prefix}_enrolment_documents`;
  const statusTable = `${prefix}_enrolment_status`;
  const admissions = createAdmissionsClient();
  const service = createServiceClient();

  // Build the docs SELECT from ELIGIBLE_SLOTS — pull every slot's status
  // column plus the expiry column for the 8 expiring slots so each drill
  // row carries its own per-slot expiry.
  const docColumns = Array.from(
    new Set(
      ELIGIBLE_SLOTS.flatMap((s) =>
        s.expiryCol ? [s.statusCol, s.expiryCol] : [s.statusCol]
      )
    )
  ).join(', ');

  type P<T> = PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;
  type StatusLite = {
    enroleeNumber: string | null;
    classLevel: string | null;
    applicationStatus: string | null;
  };

  const [apps, docs, statuses, revisions] = await Promise.all([
    fetchAllPages<AppLite>(
      (from, to) =>
        admissions
          .from(appsTable)
          .select(
            'enroleeNumber, enroleeFullName, firstName, lastName, levelApplied'
          )
          .range(from, to) as unknown as P<AppLite>
    ),
    fetchAllPages<DocLite>(
      (from, to) =>
        admissions
          .from(docsTable)
          .select(`enroleeNumber, ${docColumns}`)
          .range(from, to) as unknown as P<DocLite>
    ),
    // Enrollment gate: status-only per KD #91 — classSection IS NOT NULL
    // was relaxed so legacy/imported Enrolled rows without a section appear.
    fetchAllPages<StatusLite>(
      (from, to) =>
        admissions
          .from(statusTable)
          .select('enroleeNumber, classLevel, applicationStatus')
          .in('applicationStatus', ['Enrolled', 'Enrolled (Conditional)'])
          .range(from, to) as unknown as P<StatusLite>
    ),
    fetchAllPages<RevisionLite>(
      (from, to) =>
        service
          .from('p_file_revisions')
          .select('enrolee_number, slot_key, ay_code, replaced_at')
          .eq('ay_code', ayCode)
          .range(from, to) as unknown as P<RevisionLite>
    ),
  ]);

  const appByEnrolee = new Map<string, AppLite>();
  for (const a of apps) {
    if (a.enroleeNumber) appByEnrolee.set(a.enroleeNumber, a);
  }

  const docByEnrolee = new Map<string, DocLite>();
  for (const d of docs) {
    const en = d['enroleeNumber'];
    if (typeof en === 'string') docByEnrolee.set(en, d);
  }

  const classLevelByEnrolee = new Map<string, string>();
  // Set of enrolled enroleeNumbers — only these emit drill rows below.
  // The status fetch already filtered at SQL but we materialize the Set
  // for the iteration filter (`apps` is not pre-filtered).
  const enrolledEnrolees = new Set<string>();
  for (const s of statuses) {
    if (!s.enroleeNumber) continue;
    enrolledEnrolees.add(s.enroleeNumber);
    if (s.classLevel) classLevelByEnrolee.set(s.enroleeNumber, s.classLevel);
  }

  // Revisions counted per (enrolee, slot)
  const revKey = (en: string, slot: string) => `${en}|${slot}`;
  const revCount = new Map<string, number>();
  const revLastAt = new Map<string, string>();
  for (const r of revisions) {
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
    // Enrollment gate: skip funnel applicants. The status query above
    // already filters to enrolled at SQL; this Set check makes the
    // intent explicit at the iteration site too.
    if (!enrolledEnrolees.has(app.enroleeNumber)) continue;
    const docRow = docByEnrolee.get(app.enroleeNumber);
    const level =
      classLevelByEnrolee.get(app.enroleeNumber) ?? app.levelApplied ?? null;

    for (const slot of ELIGIBLE_SLOTS) {
      const raw =
        (docRow?.[slot.statusCol] as string | null | undefined) ?? null;
      const status = normaliseStatus(raw);

      // Per-slot expiry — every expiring slot carries its own date.
      let expiryDate: string | null = null;
      let daysToExpiry: number | null = null;
      if (slot.expiryCol) {
        const raw =
          (docRow?.[slot.expiryCol] as string | null | undefined) ?? null;
        expiryDate = raw;
        const expiryMs = raw ? Date.parse(raw) : NaN;
        daysToExpiry = !Number.isNaN(expiryMs)
          ? Math.floor((expiryMs - today) / 86_400_000)
          : null;
      }

      const k = revKey(app.enroleeNumber, slot.key);
      out.push({
        enroleeNumber: app.enroleeNumber,
        fullName: appName(app),
        level,
        slotKey: slot.key,
        slotLabel: slot.label,
        status,
        fileUrl: null, // not surfaced in drill rows; the detail page handles file urls
        expiryDate,
        daysToExpiry,
        revisionCount: revCount.get(k) ?? 0,
        lastRevisionAt: revLastAt.get(k) ?? null,
      });
    }
  }
  return out;
}

export async function buildPFilesDrillRows(input: {
  ayCode: string;
  from?: string;
  to?: string;
}): Promise<PFilesDrillRow[]> {
  // Loader is AY-scoped; range filtering is target-specific (revisions /
  // expiry dates) and applied by `applyTargetFilter` in the API route via
  // the `range` parameter. The `from` / `to` props on this builder are
  // accepted for API consistency with sibling builders, but intentionally
  // not applied at load time — P-Files renders all enrolled students every
  // render so the slot-status mix and completion-by-level are full-AY
  // views regardless of the user's selected range.
  return unstable_cache(
    () => loadPFilesRowsUncached(input.ayCode),
    ['p-files-drill', 'rows', input.ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(input.ayCode) }
  )();
}

// ─── Per-target filter ──────────────────────────────────────────────────────

export function applyTargetFilter(
  rows: PFilesDrillRow[],
  target: PFilesDrillTarget,
  segment: string | null,
  range?: { from: string; to: string }
): PFilesDrillRow[] {
  switch (target) {
    case 'all-docs':
      return rows;
    case 'complete-docs':
      return rows.filter((r) => r.status === 'On file');
    case 'expired-docs':
      return rows.filter((r) => r.status === 'Expired');
    case 'expiring-soon': {
      // Future expiry within `segment` days. Default 60 if no segment.
      // Excludes already-expired (daysToExpiry < 0) — that's the
      // 'expired-docs' target's job. Only expiring slots have a
      // non-null `daysToExpiry` so non-expiring slots are naturally
      // filtered out.
      //
      // Status gate (matches lib/p-files/dashboard.ts count, which only
      // counts a slot when its raw status === 'Valid'): "expiring soon" =
      // a currently-valid document nearing expiry (renewal signal), not an
      // Uploaded/Rejected slot that happens to carry a future expiry.
      // normaliseStatus maps raw 'Valid' → 'On file', so gate on that.
      const days = segment ? Number(segment) : 60;
      const window = Number.isFinite(days) && days > 0 ? days : 60;
      return rows.filter(
        (r) =>
          r.status === 'On file' &&
          r.daysToExpiry !== null &&
          r.daysToExpiry >= 0 &&
          r.daysToExpiry <= window
      );
    }
    case 'missing-docs':
      return rows.filter((r) => r.status === 'Missing');
    case 'slot-by-status': {
      // segment = a status string emitted by <SlotStatusDrillCard> after the
      // normaliseStatus change. Donut slices now use the discrete labels:
      //   'On file'           → r.status === 'On file'
      //   'Awaiting validation' → r.status === 'Awaiting validation'
      //   'Promised'          → r.status === 'Promised'
      //   'Rejected'          → r.status === 'Rejected'
      //   'Expired'           → r.status ∈ {'Expired', 'Missing'}
      //                         (slotMix.missing lumps both; clicking the
      //                          Expired slice must surface both — KD #82)
      if (!segment) return rows;
      if (segment === 'On file')
        return rows.filter((r) => r.status === 'On file');
      if (segment === 'Expired') {
        return rows.filter(
          (r) => r.status === 'Expired' || r.status === 'Missing'
        );
      }
      if (segment === 'Awaiting validation')
        return rows.filter((r) => r.status === 'Awaiting validation');
      if (segment === 'Promised')
        return rows.filter((r) => r.status === 'Promised');
      if (segment === 'Rejected')
        return rows.filter((r) => r.status === 'Rejected');
      return rows.filter((r) => r.status === segment);
    }
    case 'missing-by-slot': {
      // segment = slotKey
      if (!segment) return rows.filter((r) => r.status === 'Missing');
      return rows.filter(
        (r) => r.slotKey === segment && r.status === 'Missing'
      );
    }
    case 'level-applicants': {
      if (!segment) return rows;
      return rows.filter((r) => (r.level ?? 'Unknown') === segment);
    }
    case 'revisions-on-day': {
      // segment = ISO date 'YYYY-MM-DD' for a specific-day click on the
      // revisions trend chart. Without segment, use the range (matches
      // the "Revisions (range)" KPI card scope) — only rows whose
      // most-recent revision lands inside the active picker window.
      // No range either → return all rows that have any revision.
      if (segment) {
        return rows.filter((r) => r.lastRevisionAt?.slice(0, 10) === segment);
      }
      if (range?.from && range?.to) {
        const from = range.from;
        const to = range.to;
        return rows.filter((r) => {
          if (!r.lastRevisionAt) return false;
          const day = r.lastRevisionAt.slice(0, 10);
          return day >= from && day <= to;
        });
      }
      return rows.filter((r) => r.lastRevisionAt !== null);
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
  enroleeNumber: 'Enrolee number',
  level: 'Level',
  slotLabel: 'Slot',
  status: 'Status',
  expiryDate: 'Expires',
  daysToExpiry: 'Days to expiry',
  revisionCount: 'Revisions',
  lastRevisionAt: 'Last revision',
};

export function defaultColumnsForTarget(
  target: PFilesDrillTarget
): DrillColumnKey[] {
  switch (target) {
    case 'all-docs':
      return ['fullName', 'level', 'slotLabel', 'status'];
    case 'complete-docs':
    case 'missing-docs':
    case 'slot-by-status':
    case 'missing-by-slot':
      return ['fullName', 'level', 'slotLabel', 'status', 'lastRevisionAt'];
    case 'expired-docs':
    case 'expiring-soon':
      return [
        'fullName',
        'level',
        'slotLabel',
        'status',
        'expiryDate',
        'daysToExpiry',
      ];
    case 'level-applicants':
      return ['fullName', 'level', 'slotLabel', 'status'];
    case 'revisions-on-day':
      return [
        'fullName',
        'level',
        'slotLabel',
        'revisionCount',
        'lastRevisionAt',
      ];
  }
}

export function drillHeaderForTarget(
  target: PFilesDrillTarget,
  segment: string | null
): { eyebrow: string; title: string } {
  switch (target) {
    case 'all-docs':
      return {
        eyebrow: 'P-Files',
        title: 'Every tracked document slot, per student',
      };
    case 'complete-docs':
      return { eyebrow: 'P-Files', title: 'Documents validated and on file' };
    case 'expired-docs':
      return { eyebrow: 'P-Files', title: 'Documents that have expired' };
    case 'expiring-soon':
      return {
        eyebrow: 'P-Files',
        title: segment
          ? `Documents expiring within ${segment} days`
          : 'Documents expiring soon',
      };
    case 'missing-docs':
      return { eyebrow: 'P-Files', title: 'Documents not yet uploaded' };
    case 'slot-by-status':
      return {
        eyebrow: 'P-Files',
        title: segment
          ? `Documents with status: ${segment}`
          : 'Documents grouped by status',
      };
    case 'missing-by-slot':
      return {
        eyebrow: 'P-Files',
        title: segment
          ? `Students missing their ${segment} document`
          : 'Students missing documents (grouped by slot)',
      };
    case 'level-applicants':
      return {
        eyebrow: 'P-Files',
        title: segment
          ? `Documents for ${segment} students`
          : 'Documents grouped by grade level',
      };
    case 'revisions-on-day':
      return {
        eyebrow: 'P-Files',
        title: segment
          ? `Documents revised on ${segment}`
          : 'Documents revised in this date range',
      };
  }
}
