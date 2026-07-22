import { unstable_cache } from 'next/cache';

import { parseLocalDate } from '@/lib/dashboard/range';
import {
  DOCUMENT_SLOTS,
  resolveStatus,
  type DocumentStatus,
} from '@/lib/p-files/document-config';
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
  /**
   * True when this slot is conditionally gated (fatherEmail / guardianEmail)
   * AND the gate field is empty on the applicant — i.e. the slot isn't
   * actually required for this student. Mirrors
   * `lib/p-files/dashboard.ts::getCompletionByLevel`'s per-slot gate check.
   * Only the `level-applicants` target excludes gated rows (KD #82
   * count==drill parity with the completion-by-level chart) — every other
   * target intentionally leaves gated rows in (their dashboard counterparts
   * don't gate either).
   */
  gated: boolean;
};

// ─── Loader ─────────────────────────────────────────────────────────────────

type AppLite = {
  enroleeNumber: string | null;
  enroleeFullName: string | null;
  firstName: string | null;
  lastName: string | null;
  levelApplied: string | null;
  fatherEmail: string | null;
  guardianEmail: string | null;
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

/** Resolve a slot's `conditional` gate column value off the applicant row.
 *  Mirrors `getCompletionByLevel`'s gate lookup — only fatherEmail /
 *  guardianEmail are real conditional values in DOCUMENT_SLOTS today. */
function gateValueFor(app: AppLite, column: string): string | null {
  if (column === 'fatherEmail') return app.fatherEmail;
  if (column === 'guardianEmail') return app.guardianEmail;
  return null;
}

// Map the canonical `resolveStatus` result (the same classifier every
// dashboard chart/KPI in lib/p-files/dashboard.ts uses) to the discrete
// display enum the P-Files drill UI expects. This REPLACES the drill's old,
// independently-written `normaliseStatus` — that copy read raw `<slot>Status`
// strings directly and never applied the expiry backstop (a stale 'Valid'
// row whose expiry had passed rendered as 'On file' in the drill while every
// chart already counted it as expired).
//   - 'valid'     → 'On file'
//   - 'uploaded'  → 'Awaiting validation'
//   - 'to-follow' → 'Promised'
//   - 'rejected'  → 'Rejected'
//   - 'expired'   → 'Expired'
//   - 'missing'   → 'Missing'
//   - 'na'        → 'Missing' (resolveStatus never actually returns 'na'
//                    today — no DOCUMENT_SLOTS conditional path emits it —
//                    kept for exhaustiveness / future-proofing, conservative
//                    fallback matching the old normaliseStatus behaviour)
export function documentStatusToDisplay(
  status: DocumentStatus
): PFilesDrillRow['status'] {
  switch (status) {
    case 'valid':
      return 'On file';
    case 'uploaded':
      return 'Awaiting validation';
    case 'to-follow':
      return 'Promised';
    case 'rejected':
      return 'Rejected';
    case 'expired':
      return 'Expired';
    case 'missing':
      return 'Missing';
    case 'na':
      return 'Missing';
    default: {
      const _exhaustive: never = status;
      throw new Error(`unreachable document status: ${String(_exhaustive)}`);
    }
  }
}

export type PFilesDrillLoadResult = {
  rows: PFilesDrillRow[];
  /**
   * One row per `p_file_revisions` event (not deduped to the latest per
   * (enrolee, slot) — that's what `rows` carries). Feeds the
   * `revisions-on-day` target only, so a slot revised twice on different
   * days produces 2 rows here — matching how the dashboard's weekly trend /
   * heatmap / velocity charts count `p_file_revisions` table rows, not
   * unique slots.
   */
  revisionEvents: PFilesDrillRow[];
};

async function loadPFilesRowsUncached(
  ayCode: string
): Promise<PFilesDrillLoadResult> {
  const prefix = prefixFor(ayCode);
  const appsTable = `${prefix}_enrolment_applications`;
  const docsTable = `${prefix}_enrolment_documents`;
  const statusTable = `${prefix}_enrolment_status`;
  const admissions = createAdmissionsClient();
  const service = createServiceClient();

  // Build the docs SELECT from the full DOCUMENT_SLOTS (canonical 13-slot
  // list, KD #96) — pull every slot's status column plus the expiry column
  // for the 8 expiring slots so each drill row carries its own per-slot
  // expiry. Column names follow the `${key}Status` / `${key}Expiry`
  // convention (same one lib/p-files/dashboard.ts's aggregators use).
  const docColumns = Array.from(
    new Set(
      DOCUMENT_SLOTS.flatMap((s) =>
        s.expires ? [`${s.key}Status`, `${s.key}Expiry`] : [`${s.key}Status`]
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
            'enroleeNumber, enroleeFullName, firstName, lastName, levelApplied, fatherEmail, guardianEmail'
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

  // Revisions counted per (enrolee, slot) — aggregate for `rows`, and the
  // full per-event list (grouped the same way) for `revisionEvents`.
  const revKey = (en: string, slot: string) => `${en}|${slot}`;
  const revCount = new Map<string, number>();
  const revLastAt = new Map<string, string>();
  const revEventsByKey = new Map<string, RevisionLite[]>();
  for (const r of revisions) {
    if (!r.enrolee_number) continue;
    const k = revKey(r.enrolee_number, r.slot_key);
    revCount.set(k, (revCount.get(k) ?? 0) + 1);
    const prev = revLastAt.get(k);
    if (!prev || r.replaced_at > prev) revLastAt.set(k, r.replaced_at);
    const list = revEventsByKey.get(k);
    if (list) list.push(r);
    else revEventsByKey.set(k, [r]);
  }

  const today = Date.now();
  const out: PFilesDrillRow[] = [];
  const revisionEvents: PFilesDrillRow[] = [];
  for (const app of apps) {
    if (!app.enroleeNumber) continue;
    // Enrollment gate: skip funnel applicants. The status query above
    // already filters to enrolled at SQL; this Set check makes the
    // intent explicit at the iteration site too.
    if (!enrolledEnrolees.has(app.enroleeNumber)) continue;
    const docRow = docByEnrolee.get(app.enroleeNumber);
    const level =
      classLevelByEnrolee.get(app.enroleeNumber) ?? app.levelApplied ?? null;

    for (const slot of DOCUMENT_SLOTS) {
      const statusCol = `${slot.key}Status`;
      const rawStatus =
        (docRow?.[statusCol] as string | null | undefined) ?? null;

      // Per-slot expiry — every expiring slot carries its own date. Parsed
      // via the shared local-midnight `parseLocalDate` (same one
      // lib/p-files/dashboard.ts's `expiringSoon`/`expiringSoon30` KPIs use)
      // instead of raw `Date.parse`, which interprets a bare `YYYY-MM-DD`
      // string as UTC midnight and could skew the day count depending on
      // the server's local timezone offset.
      let expiryDate: string | null = null;
      let daysToExpiry: number | null = null;
      if (slot.expires) {
        const expiryCol = `${slot.key}Expiry`;
        const rawExpiry =
          (docRow?.[expiryCol] as string | null | undefined) ?? null;
        expiryDate = rawExpiry;
        const parsedExpiry = rawExpiry ? parseLocalDate(rawExpiry) : null;
        daysToExpiry = parsedExpiry
          ? Math.floor((parsedExpiry.getTime() - today) / 86_400_000)
          : null;
      }

      // Canonical classifier — the same one every dashboard chart/KPI uses
      // (lib/p-files/dashboard.ts::getCompletionByLevel/getSlotStatusMix).
      const docStatus = resolveStatus(
        null,
        rawStatus,
        expiryDate,
        slot.expires
      );
      const status = documentStatusToDisplay(docStatus);

      const gated = slot.conditional
        ? !(gateValueFor(app, slot.conditional)?.trim() ?? '')
        : false;

      const k = revKey(app.enroleeNumber, slot.key);
      const row: PFilesDrillRow = {
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
        gated,
      };
      out.push(row);

      const events = revEventsByKey.get(k);
      if (events) {
        for (const ev of events) {
          revisionEvents.push({
            ...row,
            revisionCount: 1,
            lastRevisionAt: ev.replaced_at,
          });
        }
      }
    }
  }
  return { rows: out, revisionEvents };
}

export async function buildPFilesDrillRows(input: {
  ayCode: string;
  from?: string;
  to?: string;
}): Promise<PFilesDrillLoadResult> {
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
  data: PFilesDrillLoadResult,
  target: PFilesDrillTarget,
  segment: string | null,
  range?: { from: string; to: string }
): PFilesDrillRow[] {
  const rows = data.rows;
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
      // documentStatusToDisplay maps resolved 'valid' → 'On file', so gate
      // on that.
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
      // documentStatusToDisplay mapping. Donut slices use the discrete labels:
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
      // Excludes gated slots (a conditional slot the applicant doesn't
      // actually need, e.g. fatherPassport when fatherEmail is empty) —
      // matches getCompletionByLevel's per-slot gate (KD #82 count==drill).
      // No other target applies this gate.
      const base = rows.filter((r) => !r.gated);
      if (!segment) return base;
      return base.filter((r) => (r.level ?? 'Unknown') === segment);
    }
    case 'revisions-on-day': {
      // Event-based rows (one per p_file_revisions row), not the
      // per-(enrolee,slot)-latest-only `rows` set — matches how the
      // dashboard's weekly trend / heatmap / velocity charts + the
      // "Revisions (range)" KPI all count table rows, not unique slots.
      //
      // segment = ISO date 'YYYY-MM-DD' for a specific-day click on the
      // revisions trend chart. Without segment, use the range (matches
      // the "Revisions (range)" KPI card scope) — only events whose
      // timestamp lands inside the active picker window. No range either
      // → every revision event.
      const events = data.revisionEvents;
      if (segment) {
        return events.filter((r) => r.lastRevisionAt?.slice(0, 10) === segment);
      }
      if (range?.from && range?.to) {
        const from = range.from;
        const to = range.to;
        return events.filter((r) => {
          if (!r.lastRevisionAt) return false;
          const day = r.lastRevisionAt.slice(0, 10);
          return day >= from && day <= to;
        });
      }
      return events;
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
      // Per-event rows (KD fix) — one row per revision, so `revisionCount`
      // (always 1) is dropped from the default set in favour of the
      // revision date, applicant, and which slot was revised.
      return ['fullName', 'level', 'slotLabel', 'lastRevisionAt'];
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
