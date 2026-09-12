import { unstable_cache } from 'next/cache';

import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';
import {
  EXPIRING_SOON_THRESHOLD_DAYS,
  scanDocStatusForActionFlags,
} from '@/lib/sis/process';
import {
  ADMISSIONS_FUNNEL_STATUSES,
  CHASE_ENROLLED_STATUSES,
  inChaseLensScope,
  type ChaseQueueLens,
} from '@/lib/sis/chase-lens';
import type { LifecycleDrillTarget } from '@/lib/sis/drill';

// ──────────────────────────────────────────────────────────────────────────
// Document chase queue — top-of-fold counts for /p-files + /admissions
// dashboards. Counts students (not slots) with at least one slot in the
// per-module action states. Per-module split:
//
//   admissions  → Pre-enrolment chase (KD #51 + KD #70). Populates promised
//                 (To follow), validation (Uploaded), revalidation
//                 (Rejected + Expired per KD #70 — both signal parent re-upload
//                 needed). expiringSoon zeroed — admissions doesn't chase renewals.
//   p-files     → Post-enrolment renewal lifecycle (KD #31 + KD #64).
//                 Populates revalidation (Rejected + Expired — both kinds) +
//                 expiringSoon. promised + validation zeroed.
//
// KD #70: chase = {To follow, Rejected, Expired} for BOTH modules.
// The distinction between modules is enrollment-status scope + which buckets
// are zeroed out, not which revalidation kind is counted.
//
// Filtering by enrollment status keeps the two surfaces non-overlapping:
//   admissions  → applicationStatus IN ('Submitted', 'Ongoing Verification', 'Processing')
//   p-files     → applicationStatus IN ('Enrolled', 'Enrolled (Conditional)')
//
// p-files used to also require classSection IS NOT NULL. It no longer does:
// class assignment is step 11 of the admission process and trails enrolment,
// so that filter silently dropped enrolled students from document chasing for
// as long as they went unplaced. KD #91 had already relaxed the same rule on
// the P-Files roster and detail page; the counts were the last holdout.
// Membership now lives in one shared predicate — see `lib/sis/chase-lens.ts`.
//
// Cached per-(AY, module) with the existing `sis:${ayCode}` tag (KD #46),
// so any existing write that already invalidates that tag (PATCH on
// /api/sis/students/[enroleeNumber]/documents, residence-history editor,
// etc.) automatically refreshes these counts.
// ──────────────────────────────────────────────────────────────────────────

// Re-exported from its original home so existing importers (the dashboard
// strip components) don't all have to move at once.
export type { ChaseQueueLens };

export type DocumentChaseQueueCounts = {
  promised: number; // any slot at 'To follow' (admissions only — zero for p-files)
  validation: number; // any slot at 'Uploaded' (admissions only — zero for p-files)
  revalidation: number; // Rejected + Expired for both modules per KD #70
  expiringSoon: number; // any Valid slot expiring within 30 days (p-files only — zero for admissions)
};

// ──────────────────────────────────────────────────────────────────────────
// Shared "which tiles are actually showing" selection rule. Originally lived
// inline inside <DocumentChaseQueueStrip> as a `TILES.filter(...)`; pulled
// out so the Admissions dashboard CSV export can mirror the exact same tile
// set (a chase count of 0 disappears from the strip, and admissions never
// shows the expiringSoon / p-files-only tiles) without re-implementing the
// selection rule a second time. The strip component calls this too — see
// components/sis/document-chase-queue-strip.tsx.
// ──────────────────────────────────────────────────────────────────────────

// Exported (not just used internally) so <DocumentChaseQueueStrip> can pull
// its tile labels from here too, keyed by `target` — the screen and the CSV
// export used to each hold their own copy of these four labels, which agreed
// only by coincidence. One list now, so a future copy edit can't desync them.
export const CHASE_TILE_ORDER: ReadonlyArray<{
  target: LifecycleDrillTarget;
  label: string;
}> = [
  { target: 'awaiting-document-revalidation', label: 'Awaiting revalidation' },
  { target: 'awaiting-document-validation', label: 'Awaiting validation' },
  { target: 'awaiting-promised-documents', label: 'Awaiting promised' },
  { target: 'awaiting-expiring-documents', label: 'Expiring soon' },
];

export type ChaseTileRow = {
  target: LifecycleDrillTarget;
  label: string;
  value: number;
};

/** Pure — exported for the dashboard-export builder + strip component. */
export function selectVisibleChaseTiles(
  counts: DocumentChaseQueueCounts,
  moduleKey: ChaseQueueLens
): ChaseTileRow[] {
  const valueByTarget: Record<string, number> = {
    'awaiting-document-revalidation': counts.revalidation,
    'awaiting-document-validation': counts.validation,
    'awaiting-promised-documents': counts.promised,
    'awaiting-expiring-documents': counts.expiringSoon,
  };
  return CHASE_TILE_ORDER.filter((tile) => {
    const value = valueByTarget[tile.target] ?? 0;
    if (value === 0) return false;
    if (
      moduleKey === 'admissions' &&
      tile.target === 'awaiting-expiring-documents'
    )
      return false;
    if (
      moduleKey === 'p-files' &&
      (tile.target === 'awaiting-document-validation' ||
        tile.target === 'awaiting-promised-documents')
    ) {
      return false;
    }
    return true;
  }).map((tile) => ({ ...tile, value: valueByTarget[tile.target] ?? 0 }));
}

const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

async function loadChaseQueueUncached(
  ayCode: string,
  moduleKey: ChaseQueueLens
): Promise<DocumentChaseQueueCounts> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  // Pull the matching enrolee scope first from the status table — gives
  // us the enrolee numbers for the docs filter + lets us enforce the
  // p-files classSection requirement (KD #31).
  const statusSelect = [
    'enroleeNumber',
    'applicationStatus',
    'classSection',
  ].join(', ');
  let statusQuery = supabase
    .from(`${prefix}_enrolment_status`)
    .select(statusSelect);
  if (moduleKey === 'admissions') {
    statusQuery = statusQuery.in('applicationStatus', [
      ...ADMISSIONS_FUNNEL_STATUSES,
    ]);
  } else {
    // No classSection filter: an enrolled student awaiting class assignment
    // still has documents worth chasing. See inChaseLensScope.
    statusQuery = statusQuery.in('applicationStatus', [
      ...CHASE_ENROLLED_STATUSES,
    ]);
  }
  const statusRes = await statusQuery;
  if (statusRes.error) {
    console.warn(
      '[sis/document-chase-queue] status fetch failed:',
      statusRes.error.message
    );
    return { promised: 0, validation: 0, revalidation: 0, expiringSoon: 0 };
  }
  type StatusRow = {
    enroleeNumber: string | null;
    applicationStatus: string | null;
    classSection: string | null;
  };
  const statusRows = ((statusRes.data ?? []) as unknown as StatusRow[]).filter(
    (r) => !!r.enroleeNumber
  );
  // The server-side `.in()` / `.not()` narrows the fetch; `inChaseLensScope`
  // is the authority on membership and is SHARED with the drill, so the count
  // and the row list can't drift (KD #124). It also catches what PostgREST
  // can't: `.not('classSection','is',null)` passes a blank string through.
  const enroleeSet = new Set(
    statusRows
      .filter((r) => inChaseLensScope(moduleKey, r.applicationStatus))
      .map((r) => r.enroleeNumber!)
  );
  if (enroleeSet.size === 0) {
    return { promised: 0, validation: 0, revalidation: 0, expiringSoon: 0 };
  }

  // Include both status columns and expiry columns so scanDocStatusForActionFlags
  // can evaluate hasExpiringSoon. Expiring-soon detection requires dates.
  const docColumns = [
    'enroleeNumber',
    ...DOCUMENT_SLOTS.map((s) => s.statusCol),
    ...DOCUMENT_SLOTS.filter((s) => s.expiryCol).map((s) => s.expiryCol!),
  ];

  const docsRes = await supabase
    .from(`${prefix}_enrolment_documents`)
    .select(docColumns.join(', '))
    .in('enroleeNumber', Array.from(enroleeSet));

  if (docsRes.error) {
    console.warn(
      '[sis/document-chase-queue] docs fetch failed:',
      docsRes.error.message
    );
    return { promised: 0, validation: 0, revalidation: 0, expiringSoon: 0 };
  }

  let promised = 0;
  let validation = 0;
  let revalidation = 0;
  let expiringSoon = 0;

  type DocRow = Record<string, string | null>;
  const rows = (docsRes.data ?? []) as unknown as DocRow[];

  // KD #70: chase = {To follow, Rejected, Expired} for both modules.
  // No kindFilter — the default 'both' in scanDocStatusForActionFlags counts
  // both Rejected and Expired as revalidation for all modules.
  for (const row of rows) {
    const flags = scanDocStatusForActionFlags(row, {
      expiringSoonThresholdDays: EXPIRING_SOON_THRESHOLD_DAYS,
    });
    if (flags.hasPromised) promised += 1;
    if (flags.hasValidation) validation += 1;
    if (flags.hasRevalidation) revalidation += 1;
    if (flags.hasExpiringSoon) expiringSoon += 1;
  }

  // Zero-out per-module buckets that aren't relevant to this surface.
  if (moduleKey === 'admissions') {
    expiringSoon = 0;
  } else {
    promised = 0;
    validation = 0;
  }

  return { promised, validation, revalidation, expiringSoon };
}

export async function getDocumentChaseQueueCounts(
  ayCode: string,
  moduleKey: ChaseQueueLens = 'admissions'
): Promise<DocumentChaseQueueCounts> {
  return unstable_cache(
    () => loadChaseQueueUncached(ayCode, moduleKey),
    ['sis', 'document-chase-queue', ayCode, moduleKey],
    {
      revalidate: CACHE_TTL_SECONDS,
      tags: ['sis', `sis:${ayCode}`],
    }
  )();
}
